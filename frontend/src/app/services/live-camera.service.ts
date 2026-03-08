import { Injectable, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { environment } from "../../environments/environment";
import { LiveCameraIceConfig, LiveCameraSessionRecord, LiveCameraSessionStatus } from "../models";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";

type WsMode = "SENDER" | "VIEWER";
type SenderPeerKey = `${string}:${string}`;

type SignalMessage = {
  type: string;
  [key: string]: unknown;
};

@Injectable({ providedIn: "root" })
export class LiveCameraService {
  private readonly senderPeerConnections = new Map<SenderPeerKey, RTCPeerConnection>();
  private readonly viewerPeerConnections = new Map<string, RTCPeerConnection>();
  private readonly viewerTrackWaitTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly viewerReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly viewerSessionsById = new Map<string, LiveCameraSessionRecord>();
  private rtcConfigurationPromise: Promise<RTCConfiguration> | null = null;

  private senderSocket: WebSocket | null = null;
  private viewerSocket: WebSocket | null = null;
  private senderSocketReady = false;
  private viewerSocketReady = false;

  private senderOpenResolver: (() => void) | null = null;
  private viewerOpenResolver: (() => void) | null = null;

  private facingMode: "user" | "environment" = "environment";

  readonly senderSession = signal<LiveCameraSessionRecord | null>(null);
  readonly senderLocalStream = signal<MediaStream | null>(null);
  readonly senderLoading = signal(false);
  readonly senderError = signal<string | null>(null);
  readonly senderMessage = signal<string | null>(null);
  readonly senderStatus = signal<LiveCameraSessionStatus | "IDLE">("IDLE");
  readonly microphoneEnabled = signal(true);

  readonly viewerStreams = signal<Record<string, MediaStream | null>>({});
  readonly viewerSessionState = signal<Record<string, LiveCameraSessionStatus>>({});
  readonly viewerErrors = signal<Record<string, string>>({});
  readonly viewerConnected = signal(false);

  constructor(
    private readonly api: ApiService,
    private readonly auth: AuthService
  ) {}

  async startBroadcast(options?: { audio?: boolean; emergency?: boolean }) {
    if (this.senderLoading()) {
      return;
    }

    this.senderLoading.set(true);
    this.senderError.set(null);
    this.senderMessage.set(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API is unavailable in this browser.");
      }

      const session = await firstValueFrom(
        this.api.startLiveCameraSession({
          microphoneEnabled: options?.audio !== false,
          emergency: options?.emergency ?? false
        })
      );

      this.senderSession.set(session);
      this.senderStatus.set("CONNECTING");

      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: this.facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: options?.audio !== false
        });
      } catch (error) {
        const message = this.mapMediaError(error);
        const denied = this.isPermissionDenied(error);

        const updated = await firstValueFrom(
          this.api.updateLiveCameraSessionState(
            session.id,
            denied ? "PERMISSION_DENIED" : "FAILED",
            {
              error: message
            }
          )
        );

        this.senderSession.set(updated);
        this.senderStatus.set(updated.sessionStatus);
        this.senderError.set(message);
        this.senderLoading.set(false);
        return;
      }

      this.senderLocalStream.set(media);
      this.microphoneEnabled.set(this.streamMicEnabled(media));

      await this.ensureSenderSocket();
      this.sendToSenderSocket({
        type: "REGISTER_SENDER",
        sessionId: session.id
      });

      const updated = await firstValueFrom(
        this.api.updateLiveCameraSessionState(session.id, "LIVE", {
          microphoneEnabled: this.microphoneEnabled(),
          emergency: options?.emergency ?? false
        })
      );

      this.senderSession.set(updated);
      this.senderStatus.set(updated.sessionStatus);
      this.senderMessage.set("Live camera broadcast started.");
    } catch (error) {
      this.senderError.set(this.extractApiMessage(error, "Could not start live camera broadcast."));
      this.stopLocalSenderMedia();
      this.senderSession.set(null);
      this.senderStatus.set("IDLE");
    } finally {
      this.senderLoading.set(false);
    }
  }

  async stopBroadcast(reason = "USER_STOPPED") {
    this.senderLoading.set(true);
    this.senderError.set(null);

    const currentSession = this.senderSession();
    try {
      if (currentSession) {
        await firstValueFrom(this.api.stopLiveCameraSession(currentSession.id, reason));
      }

      if (currentSession) {
        this.sendToSenderSocket({
          type: "SESSION_STATE",
          sessionId: currentSession.id,
          targetUserId: currentSession.userId,
          sessionStatus: "ENDED",
          isActive: false
        });
      }
    } catch (error) {
      this.senderError.set(this.extractApiMessage(error, "Could not stop live camera broadcast."));
    } finally {
      this.closeAllSenderPeers();
      this.closeSenderSocket();
      this.stopLocalSenderMedia();
      this.senderSession.set(null);
      this.senderStatus.set("IDLE");
      this.senderLoading.set(false);
      this.senderMessage.set("Live camera broadcast stopped.");
    }
  }

  async switchCameraFacing() {
    this.facingMode = this.facingMode === "environment" ? "user" : "environment";
    const currentStream = this.senderLocalStream();
    if (!currentStream) {
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API is unavailable in this browser.");
      }

      const replacement = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: this.facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      const nextVideoTrack = replacement.getVideoTracks()[0] ?? null;
      const currentVideoTrack = currentStream.getVideoTracks()[0] ?? null;
      if (!nextVideoTrack) {
        throw new Error("Could not access camera stream.");
      }

      for (const peer of this.senderPeerConnections.values()) {
        const sender = peer.getSenders().find((item) => item.track?.kind === "video");
        if (sender) {
          void sender.replaceTrack(nextVideoTrack);
        }
      }

      if (currentVideoTrack) {
        currentStream.removeTrack(currentVideoTrack);
        currentVideoTrack.stop();
      }
      currentStream.addTrack(nextVideoTrack);
      this.senderLocalStream.set(currentStream);
      this.senderMessage.set("Camera switched.");
    } catch (error) {
      this.senderError.set(this.mapMediaError(error));
    }
  }

  toggleMicrophone() {
    const stream = this.senderLocalStream();
    if (!stream) {
      return;
    }

    const next = !this.microphoneEnabled();
    for (const track of stream.getAudioTracks()) {
      track.enabled = next;
    }
    this.microphoneEnabled.set(next);

    const currentSession = this.senderSession();
    if (currentSession) {
      firstValueFrom(
        this.api.updateLiveCameraSessionState(currentSession.id, "LIVE", {
          microphoneEnabled: next
        })
      ).catch(() => {
        // Keep local state even if metadata update fails.
      });
    }
  }

  async connectViewerSignaling() {
    await this.ensureViewerSocket();
  }

  disconnectViewerSignaling() {
    for (const peer of this.viewerPeerConnections.values()) {
      peer.close();
    }
    this.viewerPeerConnections.clear();
    for (const timer of this.viewerReconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.viewerReconnectTimers.clear();
    this.viewerSessionsById.clear();
    this.viewerStreams.set({});
    this.viewerSessionState.set({});
    this.viewerErrors.set({});
    this.closeViewerSocket();
  }

  prepareForLogout() {
    this.disconnectViewerSignaling();
    if (this.senderStatus() !== "IDLE") {
      void this.stopBroadcast("LOGOUT");
    } else {
      this.closeSenderSocket();
      this.stopLocalSenderMedia();
      this.senderSession.set(null);
      this.senderStatus.set("IDLE");
      this.senderError.set(null);
      this.senderMessage.set(null);
    }
  }

  async syncViewerSessions(sessions: LiveCameraSessionRecord[]) {
    this.viewerSessionsById.clear();

    if (!sessions.length) {
      for (const sessionId of this.viewerPeerConnections.keys()) {
        this.removeViewerPeer(sessionId);
      }
      this.viewerStreams.set({});
      this.viewerSessionState.set({});
      return;
    }

    await this.ensureViewerSocket();

    const nextSessionIds = new Set(sessions.map((session) => session.id));
    for (const existingId of this.viewerPeerConnections.keys()) {
      if (!nextSessionIds.has(existingId)) {
        this.removeViewerPeer(existingId);
      }
    }

    for (const session of sessions) {
      this.viewerSessionsById.set(session.id, session);
      const currentState = this.viewerSessionState()[session.id];
      if (currentState !== session.sessionStatus) {
        this.viewerSessionState.update((state) => ({
          ...state,
          [session.id]: session.sessionStatus
        }));
      }

      if (!session.isActive || session.sessionStatus === "OFFLINE" || TERMINAL_STATES.has(session.sessionStatus)) {
        this.removeViewerPeer(session.id);
        continue;
      }

      if (!this.viewerPeerConnections.has(session.id)) {
        await this.openViewerPeer(session);
      }
    }
  }

  focusSessionOnViewer(session: LiveCameraSessionRecord, cause: "SELECT" | "SWITCH") {
    const eventType = cause === "SELECT" ? "STREAM_SELECTED_IN_CONTROL_ROOM" : "VIEWER_SWITCHED_STREAM";
    firstValueFrom(
      this.api.logLiveCameraViewerEvent({
        targetUserId: session.userId,
        liveCameraSessionId: session.id,
        eventType,
        metadata: {
          eventAt: new Date().toISOString()
        }
      })
    ).catch(() => {
      // Best-effort analytics event.
    });
  }

  private async openViewerPeer(session: LiveCameraSessionRecord) {
    const config = await this.getRtcConfiguration();
    const viewerPeerId = session.id;
    const peer = new RTCPeerConnection(config);
    this.viewerPeerConnections.set(session.id, peer);
    this.clearViewerTrackWaitTimer(session.id);

    let receivedMedia = false;
    this.viewerTrackWaitTimers.set(
      session.id,
      setTimeout(() => {
        if (receivedMedia || !this.viewerPeerConnections.has(session.id)) {
          return;
        }

        this.viewerErrors.update((rows) => ({
          ...rows,
          [session.id]:
            "No media received yet. If you are on hosted Wi-Fi/NAT, configure TURN relay in backend ICE settings."
        }));
      }, 15_000)
    );

    peer.addTransceiver("video", { direction: "recvonly" });
    peer.addTransceiver("audio", { direction: "recvonly" });

    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) {
        return;
      }
      receivedMedia = true;
      this.clearViewerTrackWaitTimer(session.id);

      this.viewerStreams.update((rows) => ({
        ...rows,
        [session.id]: stream
      }));
      this.viewerErrors.update((rows) => ({
        ...rows,
        [session.id]: ""
      }));
    };

    peer.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      this.sendToViewerSocket({
        type: "ICE_CANDIDATE",
        direction: "VIEWER_TO_SENDER",
        sessionId: session.id,
        targetUserId: session.userId,
        viewerUserId: this.auth.currentUser()?.id,
        viewerPeerId,
        candidate: event.candidate.toJSON()
      });
    };

    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === "failed" || peer.iceConnectionState === "disconnected") {
        this.viewerErrors.update((rows) => ({
          ...rows,
          [session.id]: "ICE connection failed. TURN relay is likely required for this network."
        }));
        this.removeViewerPeer(session.id);
        this.scheduleViewerReconnect(session.id, 1_500);
        return;
      }

      if (peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") {
        this.viewerErrors.update((rows) => ({
          ...rows,
          [session.id]: ""
        }));
      }
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
        this.viewerErrors.update((rows) => ({
          ...rows,
          [session.id]: "Connection lost. Reconnecting stream..."
        }));
        this.removeViewerPeer(session.id);
        this.scheduleViewerReconnect(session.id, 1_500);
      }
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    this.sendToViewerSocket({
      type: "VIEWER_OFFER",
      sessionId: session.id,
      targetUserId: session.userId,
      viewerPeerId,
      sdp: offer
    });

    firstValueFrom(
      this.api.logLiveCameraViewerEvent({
        targetUserId: session.userId,
        liveCameraSessionId: session.id,
        eventType: "VIEWER_OPENED_STREAM",
        metadata: {
          openedAt: new Date().toISOString()
        }
      })
    ).catch(() => {
      // Best-effort event log.
    });
  }

  private removeViewerPeer(sessionId: string) {
    const peer = this.viewerPeerConnections.get(sessionId);
    if (peer) {
      peer.ontrack = null;
      peer.onicecandidate = null;
      peer.oniceconnectionstatechange = null;
      peer.onconnectionstatechange = null;
      peer.close();
      this.viewerPeerConnections.delete(sessionId);
    }
    this.clearViewerTrackWaitTimer(sessionId);
    this.clearViewerReconnectTimer(sessionId);

    this.viewerStreams.update((rows) => {
      const next = { ...rows };
      delete next[sessionId];
      return next;
    });

    this.viewerSessionState.update((rows) => {
      const next = { ...rows };
      delete next[sessionId];
      return next;
    });

    this.viewerErrors.update((rows) => {
      const next = { ...rows };
      delete next[sessionId];
      return next;
    });
  }

  private scheduleViewerReconnect(sessionId: string, delayMs = 1_500) {
    if (this.viewerReconnectTimers.has(sessionId)) {
      return;
    }

    const timer = setTimeout(() => {
      this.viewerReconnectTimers.delete(sessionId);
      const session = this.viewerSessionsById.get(sessionId);
      if (!session) {
        return;
      }

      if (!session.isActive || session.sessionStatus === "OFFLINE" || TERMINAL_STATES.has(session.sessionStatus)) {
        return;
      }

      if (this.viewerPeerConnections.has(sessionId)) {
        return;
      }

      void this.ensureViewerSocket()
        .then(() => this.openViewerPeer(session))
        .catch(() => {
          this.viewerErrors.update((rows) => ({
            ...rows,
            [sessionId]: "Reconnect failed. Check TURN relay settings and sender network."
          }));
        });
    }, delayMs);

    this.viewerReconnectTimers.set(sessionId, timer);
  }

  private clearViewerReconnectTimer(sessionId: string) {
    const timer = this.viewerReconnectTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.viewerReconnectTimers.delete(sessionId);
    }
  }

  private async ensureSenderSocket() {
    if (this.senderSocket && this.senderSocket.readyState === WebSocket.OPEN && this.senderSocketReady) {
      return;
    }

    this.closeSenderSocket();
    const wsUrl = this.buildWsUrl("SENDER");
    if (!wsUrl) {
      throw new Error("Not authenticated.");
    }

    const socket = new WebSocket(wsUrl);
    this.senderSocket = socket;

    await new Promise<void>((resolve, reject) => {
      this.senderOpenResolver = resolve;
      const timeout = setTimeout(() => {
        reject(new Error("Could not connect to signaling server."));
      }, 12_000);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.senderSocketReady = true;
        this.senderOpenResolver?.();
        this.senderOpenResolver = null;
      };

      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Failed to connect to signaling server."));
      };
    });

    socket.onmessage = (event) => {
      this.handleSenderSignal(event.data);
    };

    socket.onclose = () => {
      this.senderSocketReady = false;
      this.senderSocket = null;
      this.closeAllSenderPeers();
    };
  }

  private closeSenderSocket() {
    if (this.senderSocket) {
      try {
        this.senderSocket.close();
      } catch {
        // Ignore close errors.
      }
    }
    this.senderSocket = null;
    this.senderSocketReady = false;
    this.senderOpenResolver = null;
  }

  private async ensureViewerSocket() {
    if (this.viewerSocket && this.viewerSocket.readyState === WebSocket.OPEN && this.viewerSocketReady) {
      return;
    }

    this.closeViewerSocket();
    const wsUrl = this.buildWsUrl("VIEWER");
    if (!wsUrl) {
      throw new Error("Not authenticated.");
    }

    const socket = new WebSocket(wsUrl);
    this.viewerSocket = socket;

    await new Promise<void>((resolve, reject) => {
      this.viewerOpenResolver = resolve;
      const timeout = setTimeout(() => {
        reject(new Error("Could not connect to viewer signaling."));
      }, 12_000);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.viewerSocketReady = true;
        this.viewerConnected.set(true);
        this.viewerOpenResolver?.();
        this.viewerOpenResolver = null;
      };

      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Failed to connect to viewer signaling."));
      };
    });

    socket.onmessage = (event) => {
      this.handleViewerSignal(event.data);
    };

    socket.onclose = () => {
      this.viewerSocketReady = false;
      this.viewerConnected.set(false);
      this.viewerSocket = null;
      for (const sessionId of this.viewerPeerConnections.keys()) {
        this.removeViewerPeer(sessionId);
      }
    };
  }

  private closeViewerSocket() {
    if (this.viewerSocket) {
      try {
        this.viewerSocket.close();
      } catch {
        // Ignore close errors.
      }
    }
    this.viewerSocket = null;
    this.viewerSocketReady = false;
    this.viewerConnected.set(false);
    this.viewerOpenResolver = null;
  }

  private sendToSenderSocket(payload: SignalMessage) {
    if (!this.senderSocket || this.senderSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.senderSocket.send(JSON.stringify(payload));
  }

  private sendToViewerSocket(payload: SignalMessage) {
    if (!this.viewerSocket || this.viewerSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.viewerSocket.send(JSON.stringify(payload));
  }

  private handleSenderSignal(raw: unknown) {
    const message = this.parseSignal(raw);
    if (!message) {
      return;
    }

    if (message["type"] === "VIEWER_OFFER") {
      void this.handleIncomingViewerOffer(message);
      return;
    }

    if (message["type"] === "ICE_CANDIDATE" && message["direction"] === "VIEWER_TO_SENDER") {
      const sessionId = String(message["sessionId"] ?? "");
      const viewerUserId = String(message["viewerUserId"] ?? "");
      const viewerPeerId = String(message["viewerPeerId"] ?? "");
      const key = `${viewerUserId}:${viewerPeerId}` as SenderPeerKey;
      const peer = this.senderPeerConnections.get(key);
      if (!peer || !sessionId) {
        return;
      }

      const candidate = message["candidate"] as RTCIceCandidateInit | undefined;
      if (!candidate) {
        return;
      }

      void peer.addIceCandidate(new RTCIceCandidate(candidate));
      return;
    }

    if (message["type"] === "ERROR") {
      this.senderError.set(String(message["message"] ?? "Camera signaling error."));
    }
  }

  private async handleIncomingViewerOffer(message: Record<string, unknown>) {
    const sessionId = String(message["sessionId"] ?? "");
    const targetUserId = String(message["targetUserId"] ?? "");
    const viewerUserId = String(message["viewerUserId"] ?? "");
    const viewerPeerId = String(message["viewerPeerId"] ?? "");
    const remoteSdp = message["sdp"] as RTCSessionDescriptionInit | undefined;

    const currentSession = this.senderSession();
    if (!currentSession || !sessionId || !viewerUserId || !viewerPeerId || !remoteSdp) {
      return;
    }

    if (currentSession.id !== sessionId || currentSession.userId !== targetUserId) {
      return;
    }

    const key = `${viewerUserId}:${viewerPeerId}` as SenderPeerKey;
    this.closeSenderPeer(key);

    const peer = new RTCPeerConnection(await this.getRtcConfiguration());
    this.senderPeerConnections.set(key, peer);

    const stream = this.senderLocalStream();
    if (stream) {
      for (const track of stream.getTracks()) {
        peer.addTrack(track, stream);
      }
    }

    peer.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      this.sendToSenderSocket({
        type: "ICE_CANDIDATE",
        direction: "SENDER_TO_VIEWER",
        sessionId,
        targetUserId,
        viewerUserId,
        viewerPeerId,
        candidate: event.candidate.toJSON()
      });
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
        this.closeSenderPeer(key);
      }
    };

    await peer.setRemoteDescription(new RTCSessionDescription(remoteSdp));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    this.sendToSenderSocket({
      type: "SENDER_ANSWER",
      sessionId,
      targetUserId,
      viewerUserId,
      viewerPeerId,
      sdp: answer
    });
  }

  private closeSenderPeer(key: SenderPeerKey) {
    const peer = this.senderPeerConnections.get(key);
    if (!peer) {
      return;
    }

    peer.onicecandidate = null;
    peer.onconnectionstatechange = null;
    peer.close();
    this.senderPeerConnections.delete(key);
  }

  private closeAllSenderPeers() {
    for (const key of this.senderPeerConnections.keys()) {
      this.closeSenderPeer(key);
    }
  }

  private handleViewerSignal(raw: unknown) {
    const message = this.parseSignal(raw);
    if (!message) {
      return;
    }

    if (message["type"] === "SENDER_ANSWER") {
      const sessionId = String(message["sessionId"] ?? "");
      const viewerPeerId = String(message["viewerPeerId"] ?? "");
      const sdp = message["sdp"] as RTCSessionDescriptionInit | undefined;
      if (!sessionId || !viewerPeerId || !sdp || viewerPeerId !== sessionId) {
        return;
      }

      const peer = this.viewerPeerConnections.get(sessionId);
      if (!peer) {
        return;
      }

      void peer.setRemoteDescription(new RTCSessionDescription(sdp));
      return;
    }

    if (message["type"] === "ICE_CANDIDATE" && message["direction"] === "SENDER_TO_VIEWER") {
      const sessionId = String(message["sessionId"] ?? "");
      const viewerPeerId = String(message["viewerPeerId"] ?? "");
      const candidate = message["candidate"] as RTCIceCandidateInit | undefined;
      if (!sessionId || viewerPeerId !== sessionId || !candidate) {
        return;
      }

      const peer = this.viewerPeerConnections.get(sessionId);
      if (!peer) {
        return;
      }

      void peer.addIceCandidate(new RTCIceCandidate(candidate));
      return;
    }

    if (message["type"] === "SESSION_STATE") {
      const sessionId = String(message["sessionId"] ?? "");
      const sessionStatus = String(message["sessionStatus"] ?? "") as LiveCameraSessionStatus;
      const isActive = message["isActive"] !== false;
      if (!sessionId) {
        return;
      }

      this.viewerSessionState.update((state) => ({
        ...state,
        [sessionId]: isActive ? sessionStatus : "OFFLINE"
      }));

      if (!isActive || TERMINAL_STATES.has(sessionStatus)) {
        this.viewerSessionsById.delete(sessionId);
        this.clearViewerReconnectTimer(sessionId);
        this.removeViewerPeer(sessionId);
      }
      return;
    }

    if (message["type"] === "SESSION_ENDED") {
      const sessionId = String(message["sessionId"] ?? "");
      if (!sessionId) {
        return;
      }
      this.viewerSessionsById.delete(sessionId);
      this.clearViewerReconnectTimer(sessionId);
      this.removeViewerPeer(sessionId);
      return;
    }

    if (message["type"] === "ERROR") {
      const text = String(message["message"] ?? "Viewer signaling error.");
      this.viewerErrors.update((rows) => ({
        ...rows,
        _global: text
      }));
    }
  }

  private parseSignal(raw: unknown) {
    try {
      const data = typeof raw === "string" ? raw : String(raw);
      const parsed = JSON.parse(data) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async getRtcConfiguration() {
    if (this.rtcConfigurationPromise) {
      return this.rtcConfigurationPromise;
    }

    this.rtcConfigurationPromise = firstValueFrom(this.api.getLiveCameraIceConfig())
      .then((config) => this.normalizeRtcConfiguration(config))
      .catch(() => this.defaultRtcConfiguration());

    return this.rtcConfigurationPromise;
  }

  private normalizeRtcConfiguration(config: LiveCameraIceConfig | null | undefined): RTCConfiguration {
    const servers = (config?.iceServers ?? [])
      .map((server): RTCIceServer | null => {
        const urlsList = Array.isArray(server.urls)
          ? server.urls.map((url) => String(url).trim()).filter((url) => url.length > 0)
          : [String(server.urls ?? "").trim()].filter((url) => url.length > 0);

        if (!urlsList.length) {
          return null;
        }

        return {
          urls: urlsList.length === 1 ? urlsList[0] : urlsList,
          username: server.username || undefined,
          credential: server.credential || undefined
        };
      })
      .filter((server): server is RTCIceServer => Boolean(server));

    if (!servers.length) {
      return this.defaultRtcConfiguration();
    }

    return {
      iceServers: servers,
      iceTransportPolicy: config?.iceTransportPolicy === "relay" ? "relay" : "all"
    };
  }

  private defaultRtcConfiguration(): RTCConfiguration {
    return {
      iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
      iceTransportPolicy: "all"
    };
  }

  private clearViewerTrackWaitTimer(sessionId: string) {
    const timer = this.viewerTrackWaitTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.viewerTrackWaitTimers.delete(sessionId);
    }
  }

  private buildWsUrl(mode: WsMode) {
    const token = this.auth.getToken();
    if (!token) {
      return null;
    }

    const parsed = new URL(environment.apiBaseUrl);
    const basePath = parsed.pathname.replace(/\/+$/, "");
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    parsed.pathname = `${basePath}/live-camera/ws`.replace(/\/{2,}/g, "/");
    parsed.searchParams.set("token", token);
    parsed.searchParams.set("mode", mode);
    return parsed.toString();
  }

  private stopLocalSenderMedia() {
    const stream = this.senderLocalStream();
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    this.senderLocalStream.set(null);
  }

  private streamMicEnabled(stream: MediaStream) {
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      return false;
    }
    return audioTracks.some((track) => track.enabled);
  }

  private mapMediaError(error: unknown) {
    const name = String((error as { name?: string })?.name ?? "");
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Camera permission denied. Allow camera access and try again.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No camera device was found.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "Camera is currently busy or unavailable.";
    }

    return String((error as { message?: string })?.message ?? "Could not access camera stream.");
  }

  private isPermissionDenied(error: unknown) {
    const name = String((error as { name?: string })?.name ?? "");
    return name === "NotAllowedError" || name === "SecurityError";
  }

  private extractApiMessage(error: unknown, fallback: string) {
    const err = error as { error?: { message?: string }; message?: string };
    return String(err?.error?.message ?? err?.message ?? fallback);
  }
}

const TERMINAL_STATES = new Set<LiveCameraSessionStatus>([
  "ENDED",
  "FAILED",
  "PERMISSION_DENIED",
  "CAMERA_OFF"
]);

