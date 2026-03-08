import { Server } from "http";
import { LiveCameraSessionStatus, Role } from "@prisma/client";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { URL } from "url";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { prisma } from "../lib/prisma";
import { authenticateBearerToken } from "../middleware/auth";
import { writeLiveCameraEvent } from "./liveCameraAudit";

type SocketMode = "SENDER" | "VIEWER";

type SignalClient = {
  socket: WebSocket;
  userId: string;
  role: Role;
  mode: SocketMode;
  registeredSessionId: string | null;
};

type WireMessage = Record<string, unknown>;

type SessionSignalStatus = {
  sessionId: string;
  targetUserId: string;
  sessionStatus: LiveCameraSessionStatus;
  isActive: boolean;
};

const CONTROL_ROOM_VIEW_ROLES = new Set<Role>([Role.ADMIN, Role.CASE_WORKER, Role.POLICE]);
const TERMINAL_SESSION_STATES = new Set<LiveCameraSessionStatus>([
  LiveCameraSessionStatus.ENDED,
  LiveCameraSessionStatus.FAILED,
  LiveCameraSessionStatus.PERMISSION_DENIED,
  LiveCameraSessionStatus.CAMERA_OFF
]);

const clients = new Set<SignalClient>();
const clientsByUserId = new Map<string, Set<SignalClient>>();
const sendersBySessionId = new Map<string, SignalClient>();
const viewerOpenDedup = new Map<string, number>();

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeSend(client: SignalClient, payload: Record<string, unknown>) {
  if (client.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  client.socket.send(JSON.stringify(payload));
}

function sendError(client: SignalClient, message: string, code?: string) {
  safeSend(client, { type: "ERROR", message, code: code ?? null });
}

function addClient(client: SignalClient) {
  clients.add(client);
  const bucket = clientsByUserId.get(client.userId) ?? new Set<SignalClient>();
  bucket.add(client);
  clientsByUserId.set(client.userId, bucket);
}

function removeClient(client: SignalClient) {
  clients.delete(client);

  const bucket = clientsByUserId.get(client.userId);
  if (bucket) {
    bucket.delete(client);
    if (!bucket.size) {
      clientsByUserId.delete(client.userId);
    }
  }

  const sessionId = client.registeredSessionId;
  if (!sessionId) {
    return;
  }

  const mapped = sendersBySessionId.get(sessionId);
  if (mapped === client) {
    sendersBySessionId.delete(sessionId);
    void markSessionEndedOnDisconnect(sessionId, client.userId);
  }
}

function forwardToViewers(viewerUserId: string, payload: Record<string, unknown>) {
  const bucket = clientsByUserId.get(viewerUserId);
  if (!bucket?.size) {
    return;
  }

  for (const client of bucket) {
    if (client.mode !== "VIEWER") {
      continue;
    }
    safeSend(client, payload);
  }
}

function broadcastToViewers(payload: Record<string, unknown>) {
  for (const client of clients) {
    if (client.mode !== "VIEWER") {
      continue;
    }
    safeSend(client, payload);
  }
}

function parseMessage(data: RawData): WireMessage | null {
  try {
    const parsed = JSON.parse(String(data)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as WireMessage;
  } catch {
    return null;
  }
}

function coerceMode(value: string) {
  const upper = value.toUpperCase();
  if (upper === "SENDER" || upper === "VIEWER") {
    return upper as SocketMode;
  }
  return null;
}

function buildUpgradeUrl(req: IncomingMessage) {
  const host = req.headers.host || "localhost";
  return new URL(req.url || "", `http://${host}`);
}

async function markSessionEndedOnDisconnect(sessionId: string, userId: string) {
  const now = new Date();
  const update = await prisma.liveCameraSession.updateMany({
    where: {
      id: sessionId,
      userId,
      isActive: true
    },
    data: {
      isActive: false,
      endedAt: now,
      sessionStatus: LiveCameraSessionStatus.ENDED
    }
  });

  if (!update.count) {
    return;
  }

  await writeLiveCameraEvent({
    userId,
    actorUserId: userId,
    eventType: "CAMERA_STREAM_ENDED_UNEXPECTEDLY",
    eventSummary: "Camera sender disconnected unexpectedly.",
    liveCameraSessionId: sessionId,
    metadata: {
      reason: "WS_DISCONNECT",
      endedAt: now.toISOString()
    }
  });

  broadcastToViewers({
    type: "SESSION_ENDED",
    sessionId,
    targetUserId: userId,
    reason: "SENDER_DISCONNECTED"
  });
}

async function setSessionStateAndBroadcast(payload: SessionSignalStatus, actorUserId: string) {
  const now = new Date();
  const terminal = TERMINAL_SESSION_STATES.has(payload.sessionStatus);

  await prisma.liveCameraSession.updateMany({
    where: {
      id: payload.sessionId,
      userId: payload.targetUserId
    },
    data: {
      sessionStatus: payload.sessionStatus,
      isActive: terminal ? false : payload.isActive,
      endedAt: terminal ? now : null
    }
  });

  if (payload.sessionStatus === LiveCameraSessionStatus.PERMISSION_DENIED) {
    await writeLiveCameraEvent({
      userId: payload.targetUserId,
      actorUserId,
      eventType: "CAMERA_PERMISSION_DENIED",
      liveCameraSessionId: payload.sessionId,
      metadata: {
        updatedAt: now.toISOString()
      }
    });
  } else if (terminal) {
    await writeLiveCameraEvent({
      userId: payload.targetUserId,
      actorUserId,
      eventType: "CAMERA_SESSION_STOPPED",
      liveCameraSessionId: payload.sessionId,
      metadata: {
        status: payload.sessionStatus,
        updatedAt: now.toISOString()
      }
    });
  } else {
    await writeLiveCameraEvent({
      userId: payload.targetUserId,
      actorUserId,
      eventType: "CAMERA_STATE_UPDATED",
      liveCameraSessionId: payload.sessionId,
      metadata: {
        status: payload.sessionStatus,
        updatedAt: now.toISOString()
      }
    });
  }

  const statusPayload = {
    type: "SESSION_STATE",
    sessionId: payload.sessionId,
    targetUserId: payload.targetUserId,
    sessionStatus: payload.sessionStatus,
    isActive: terminal ? false : payload.isActive
  };
  broadcastToViewers(statusPayload);

  if (terminal) {
    broadcastToViewers({
      type: "SESSION_ENDED",
      sessionId: payload.sessionId,
      targetUserId: payload.targetUserId,
      reason: payload.sessionStatus
    });
  }
}

async function handleRegisterSender(client: SignalClient, message: WireMessage) {
  if (client.mode !== "SENDER") {
    sendError(client, "Only sender sockets can register a sender session.", "BAD_MODE");
    return;
  }

  const sessionId = asText(message.sessionId);
  if (!sessionId) {
    sendError(client, "sessionId is required.", "INVALID_PAYLOAD");
    return;
  }

  const session = await prisma.liveCameraSession.findFirst({
    where: {
      id: sessionId,
      userId: client.userId,
      isActive: true
    },
    select: {
      id: true,
      userId: true,
      sessionStatus: true
    }
  });

  if (!session) {
    sendError(client, "Active camera session not found.", "SESSION_NOT_FOUND");
    return;
  }

  const existing = sendersBySessionId.get(session.id);
  if (existing && existing !== client) {
    try {
      existing.socket.close(4000, "Sender replaced by a new connection");
    } catch {
      // Ignore close failures.
    }
  }

  client.registeredSessionId = session.id;
  sendersBySessionId.set(session.id, client);

  if (session.sessionStatus !== LiveCameraSessionStatus.LIVE) {
    await setSessionStateAndBroadcast(
      {
        sessionId: session.id,
        targetUserId: session.userId,
        sessionStatus: LiveCameraSessionStatus.LIVE,
        isActive: true
      },
      client.userId
    );
  } else {
    broadcastToViewers({
      type: "SESSION_STATE",
      sessionId: session.id,
      targetUserId: session.userId,
      sessionStatus: session.sessionStatus,
      isActive: true
    });
  }

  safeSend(client, {
    type: "SENDER_REGISTERED",
    sessionId: session.id,
    targetUserId: session.userId
  });
}

async function handleViewerOffer(client: SignalClient, message: WireMessage) {
  if (client.mode !== "VIEWER") {
    sendError(client, "Only viewer sockets can send viewer offers.", "BAD_MODE");
    return;
  }

  const sessionId = asText(message.sessionId);
  const targetUserId = asText(message.targetUserId);
  const viewerPeerId = asText(message.viewerPeerId);
  const sdp = message.sdp;

  if (!sessionId || !targetUserId || !viewerPeerId || !sdp) {
    sendError(client, "sessionId, targetUserId, viewerPeerId and sdp are required.", "INVALID_PAYLOAD");
    return;
  }

  const sender = sendersBySessionId.get(sessionId);
  if (!sender || sender.userId !== targetUserId) {
    sendError(client, "Sender is not online for this session.", "SENDER_OFFLINE");
    return;
  }

  const dedupeKey = `${client.userId}:${sessionId}`;
  const nowMs = Date.now();
  const lastLoggedAt = viewerOpenDedup.get(dedupeKey) ?? 0;
  if (nowMs - lastLoggedAt > 45_000) {
    viewerOpenDedup.set(dedupeKey, nowMs);
    await writeLiveCameraEvent({
      userId: targetUserId,
      actorUserId: client.userId,
      eventType: "VIEWER_OPENED_STREAM",
      eventSummary: "Viewer opened stream from Control Room.",
      liveCameraSessionId: sessionId,
      metadata: {
        viewerPeerId,
        openedAt: new Date(nowMs).toISOString()
      }
    });
  }

  safeSend(sender, {
    type: "VIEWER_OFFER",
    sessionId,
    targetUserId,
    viewerUserId: client.userId,
    viewerPeerId,
    sdp
  });
}

function handleSenderAnswer(client: SignalClient, message: WireMessage) {
  if (client.mode !== "SENDER") {
    sendError(client, "Only sender sockets can send answers.", "BAD_MODE");
    return;
  }

  const sessionId = asText(message.sessionId);
  const targetUserId = asText(message.targetUserId);
  const viewerUserId = asText(message.viewerUserId);
  const viewerPeerId = asText(message.viewerPeerId);
  const sdp = message.sdp;

  if (!sessionId || !targetUserId || !viewerUserId || !viewerPeerId || !sdp) {
    sendError(client, "sessionId, targetUserId, viewerUserId, viewerPeerId and sdp are required.", "INVALID_PAYLOAD");
    return;
  }

  if (client.userId !== targetUserId || client.registeredSessionId !== sessionId) {
    sendError(client, "Sender is not authorized for this session.", "UNAUTHORIZED");
    return;
  }

  forwardToViewers(viewerUserId, {
    type: "SENDER_ANSWER",
    sessionId,
    targetUserId,
    viewerUserId,
    viewerPeerId,
    sdp
  });
}

function handleIceCandidate(client: SignalClient, message: WireMessage) {
  const sessionId = asText(message.sessionId);
  const targetUserId = asText(message.targetUserId);
  const viewerUserId = asText(message.viewerUserId);
  const viewerPeerId = asText(message.viewerPeerId);
  const direction = asText(message.direction);
  const candidate = message.candidate;

  if (!sessionId || !targetUserId || !viewerUserId || !viewerPeerId || !direction || !candidate) {
    sendError(client, "Invalid ICE candidate payload.", "INVALID_PAYLOAD");
    return;
  }

  if (direction === "VIEWER_TO_SENDER") {
    if (client.mode !== "VIEWER") {
      sendError(client, "Only viewers can send VIEWER_TO_SENDER candidates.", "BAD_MODE");
      return;
    }

    const sender = sendersBySessionId.get(sessionId);
    if (!sender || sender.userId !== targetUserId) {
      sendError(client, "Sender is not online for this session.", "SENDER_OFFLINE");
      return;
    }

    safeSend(sender, {
      type: "ICE_CANDIDATE",
      sessionId,
      targetUserId,
      viewerUserId,
      viewerPeerId,
      direction,
      candidate
    });
    return;
  }

  if (direction === "SENDER_TO_VIEWER") {
    if (client.mode !== "SENDER") {
      sendError(client, "Only senders can send SENDER_TO_VIEWER candidates.", "BAD_MODE");
      return;
    }

    if (client.userId !== targetUserId || client.registeredSessionId !== sessionId) {
      sendError(client, "Sender is not authorized for this session.", "UNAUTHORIZED");
      return;
    }

    forwardToViewers(viewerUserId, {
      type: "ICE_CANDIDATE",
      sessionId,
      targetUserId,
      viewerUserId,
      viewerPeerId,
      direction,
      candidate
    });
    return;
  }

  sendError(client, "Unsupported ICE direction.", "INVALID_DIRECTION");
}

async function handleSessionState(client: SignalClient, message: WireMessage) {
  if (client.mode !== "SENDER") {
    sendError(client, "Only sender sockets can update session state.", "BAD_MODE");
    return;
  }

  const sessionId = asText(message.sessionId);
  const targetUserId = asText(message.targetUserId);
  const statusRaw = asText(message.sessionStatus);
  const isActive = message.isActive !== false;

  if (!sessionId || !targetUserId || !statusRaw) {
    sendError(client, "sessionId, targetUserId and sessionStatus are required.", "INVALID_PAYLOAD");
    return;
  }

  if (client.userId !== targetUserId || client.registeredSessionId !== sessionId) {
    sendError(client, "Sender is not authorized for this session.", "UNAUTHORIZED");
    return;
  }

  if (!(statusRaw in LiveCameraSessionStatus)) {
    sendError(client, "Invalid camera session status.", "INVALID_STATUS");
    return;
  }

  const sessionStatus = statusRaw as LiveCameraSessionStatus;
  await setSessionStateAndBroadcast({
    sessionId,
    targetUserId,
    sessionStatus,
    isActive
  }, client.userId);

  if (TERMINAL_SESSION_STATES.has(sessionStatus)) {
    sendersBySessionId.delete(sessionId);
    client.registeredSessionId = null;
  }
}

async function handleIncomingMessage(client: SignalClient, raw: RawData) {
  const message = parseMessage(raw);
  if (!message) {
    sendError(client, "Invalid signaling payload.", "BAD_JSON");
    return;
  }

  const type = asText(message.type);
  if (!type) {
    sendError(client, "Message type is required.", "MISSING_TYPE");
    return;
  }

  switch (type) {
    case "PING": {
      safeSend(client, { type: "PONG", at: new Date().toISOString() });
      return;
    }
    case "REGISTER_SENDER": {
      await handleRegisterSender(client, message);
      return;
    }
    case "VIEWER_OFFER": {
      await handleViewerOffer(client, message);
      return;
    }
    case "SENDER_ANSWER": {
      handleSenderAnswer(client, message);
      return;
    }
    case "ICE_CANDIDATE": {
      handleIceCandidate(client, message);
      return;
    }
    case "SESSION_STATE": {
      await handleSessionState(client, message);
      return;
    }
    default: {
      sendError(client, `Unsupported signal type: ${type}`, "UNSUPPORTED_TYPE");
    }
  }
}

async function resolveClientFromRequest(req: IncomingMessage) {
  const url = buildUpgradeUrl(req);
  if (url.pathname !== "/live-camera/ws") {
    return { ok: false as const, status: 404, reason: "Not found" };
  }

  const token = asText(url.searchParams.get("token"));
  const mode = coerceMode(asText(url.searchParams.get("mode") || ""));

  if (!token || !mode) {
    return { ok: false as const, status: 400, reason: "Missing token or mode" };
  }

  const authUser = await authenticateBearerToken(token);
  if (!authUser) {
    return { ok: false as const, status: 401, reason: "Unauthorized" };
  }

  if (mode === "VIEWER" && !CONTROL_ROOM_VIEW_ROLES.has(authUser.role)) {
    return { ok: false as const, status: 403, reason: "Role is not allowed to view Control Room streams" };
  }

  return {
    ok: true as const,
    mode,
    userId: authUser.id,
    role: authUser.role
  };
}

function rejectUpgrade(socket: Duplex, status: number, reason: string) {
  const message = reason || "Bad Request";
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function setupLiveCameraSignaling(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const resolved = await resolveClientFromRequest(req);
    if (!resolved.ok) {
      rejectUpgrade(socket, resolved.status, resolved.reason);
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: SignalClient = {
        socket: ws,
        userId: resolved.userId,
        role: resolved.role,
        mode: resolved.mode,
        registeredSessionId: null
      };

      addClient(client);
      safeSend(client, {
        type: "REGISTERED",
        mode: client.mode,
        userId: client.userId,
        role: client.role
      });

      ws.on("message", (raw) => {
        void handleIncomingMessage(client, raw);
      });

      ws.on("close", () => {
        removeClient(client);
      });

      ws.on("error", () => {
        removeClient(client);
      });
    });
  });

  return {
    close: () => wss.close()
  };
}

