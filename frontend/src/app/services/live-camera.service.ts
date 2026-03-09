import { Injectable, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { environment } from "../../environments/environment";
import { MediaStreamBindingState } from "../directives/media-stream.directive";
import { LiveCameraIceConfig, LiveCameraSessionRecord, LiveCameraSessionStatus } from "../models";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";

type WsMode = "SENDER" | "VIEWER";
type SenderPeerKey = `${string}:${string}`;
type ViewerDiagnosticsScope = "tile" | "main";

type SignalMessage = {
  type: string;
  [key: string]: unknown;
};

type ViewerPeerDiagnostics = {
  sessionId: string;
  socketConnected: boolean;
  connectionState: RTCPeerConnectionState | "unknown";
  iceConnectionState: RTCIceConnectionState | "unknown";
  signalingState: RTCSignalingState | "unknown";
  remoteStreamCreated: boolean;
  remoteVideoTrackPresent: boolean;
  srcObjectBound: boolean;
  playError: string | null;
  bytesReceived: number | null;
  selectedIceCandidateType: string | null;
  lastRebindCause: string | null;
  lastUpdatedAt: string;
};

type SenderSocketWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

@Injectable({ providedIn: "root" })
export class LiveCameraService {
  private readonly senderPeerConnections = new Map<SenderPeerKey, RTCPeerConnection>();
  private readonly viewerPeerConnections = new Map<string, RTCPeerConnection>();
  private readonly viewerTrackWaitTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly viewerReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly viewerStatsPollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly viewerSessionsById = new Map<string, LiveCameraSessionRecord>();
  private readonly senderRegisterWaiters = new Map<string, SenderSocketWaiter>();
  private rtcConfigurationPromise: Promise<RTCConfiguration> | null = null;

  private senderSocket: WebSocket | null = null;
  private viewerSocket: WebSocket | null = null;
  private senderSocketReady = false;
  private viewerSocketReady = false;

  private senderOpenResolver: (() => void) | null = null;
  private viewerOpenResolver: (() => void) | null = null;

  private senderHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private viewerHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private senderHeartbeatLastPongAt = 0;
  private viewerHeartbeatLastPongAt = 0;
  private senderHeartbeatPingCounter = 0;
  private viewerHeartbeatPingCounter = 0;

  private senderReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private viewerSocketReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private senderReconnectAttempts = 0;
  private viewerSocketReconnectAttempts = 0;

  private explicitSenderSocketClose = false;
  private explicitViewerSocketClose = false;

  private facingMode: "user" | "environment" = "environment";
  private readonly socketConnectTimeoutMs = 12_000;
  private readonly heartbeatIntervalMs = 10_000;
  private readonly heartbeatTimeoutMs = 35_000;

  readonly senderSession = signal<LiveCameraSessionRecord | null>(null);
  readonly senderLocalStream = signal<MediaStream | null>(null);
  readonly senderLoading = signal(false);
  readonly senderError = signal<string | null>(null);
  readonly senderMessage = signal<string | null>(null);
  readonly senderStatus = signal<LiveCameraSessionStatus | "IDLE">("IDLE");
  readonly microphoneEnabled = signal(true);
  readonly senderSocketConnected = signal(false);

  readonly viewerStreams = signal<Record<string, MediaStream | null>>({});
  readonly viewerSessionState = signal<Record<string, LiveCameraSessionStatus>>({});
  readonly viewerErrors = signal<Record<string, string>>({});
  readonly viewerConnected = signal(false);
  readonly viewerDiagnostics = signal<Record<string, ViewerPeerDiagnostics>>({});

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

    let session: LiveCameraSessionRecord | null = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API is unavailable in this browser.");
      }

      session = await firstValueFrom(
        this.api.startLiveCameraSession({
          microphoneEnabled: options?.audio !== false,
          emergency: options?.emergency ?? false
        })
      );

      this.senderSession.set(session);
      this.senderStatus.set("CONNECTING");
      this.diag("sender.start", "session-started", {
        sessionId: session.id,
        status: session.sessionStatus
      });

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

        const failedStatus: Exclude<LiveCameraSessionStatus, "OFFLINE" | "CONNECTING" | "LIVE" | "NETWORK_WEAK"> =
          denied ? "PERMISSION_DENIED" : "FAILED";
        await this.reconcileFailedStartup(session, failedStatus, message);
        this.senderError.set(message);
        this.senderLoading.set(false);
        return;
      }

      this.senderLocalStream.set(media);
      this.microphoneEnabled.set(this.streamMicEnabled(media));

      await this.ensureSenderSocket();
      await this.registerSenderSession(session.id);

      const updated = await firstValueFrom(
        this.api.updateLiveCameraSessionState(session.id, "LIVE", {
          microphoneEnabled: this.microphoneEnabled(),
          emergency: options?.emergency ?? false,
          senderReadyAt: new Date().toISOString()
        })
      );

      this.sendToSenderSocket({
        type: "SESSION_STATE",
        sessionId: session.id,
        targetUserId: session.userId,
        sessionStatus: "LIVE",
        isActive: true
      });

      this.senderSession.set(updated);
      this.senderStatus.set(updated.sessionStatus);
      this.senderMessage.set("Live camera broadcast started.");
      this.senderReconnectAttempts = 0;
    } catch (error) {
      const message = this.extractApiMessage(error, "Could not start live camera broadcast.");
      this.senderError.set(message);
      if (session) {
        await this.reconcileFailedStartup(session, "FAILED", message);
      } else {
        this.stopLocalSenderMedia();
        this.senderSession.set(null);
        this.senderStatus.set("IDLE");
      }
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
    } catch (error) {
      this.senderError.set(this.extractApiMessage(error, "Could not stop live camera broadcast."));
    } finally {
      this.clearSenderReconnectTimer();
      this.closeAllSenderPeers();
      this.closeSenderSocket(true);
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
    this.explicitViewerSocketClose = false;
    await this.ensureViewerSocket();
  }

  disconnectViewerSignaling() {
    this.explicitViewerSocketClose = true;
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
    this.viewerDiagnostics.set({});
    this.clearAllViewerTrackWaitTimers();
    this.clearAllViewerStatsPolling();
    this.clearViewerSocketReconnectTimer();
    this.closeViewerSocket(true);
  }

  prepareForLogout() {
    this.disconnectViewerSignaling();
    if (this.senderStatus() !== "IDLE") {
      void this.stopBroadcast("LOGOUT");
    } else {
      this.closeSenderSocket(true);
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
      this.viewerDiagnostics.set({});
      return;
    }

    try {
      await this.ensureViewerSocket();
    } catch {
      this.viewerErrors.update((rows) => ({
        ...rows,
        _global: "Viewer signaling disconnected. Reconnecting..."
      }));
      this.scheduleViewerSocketReconnect();
      return;
    }

    const nextSessionIds = new Set(sessions.map((session) => session.id));
    for (const existingId of this.viewerPeerConnections.keys()) {
      if (!nextSessionIds.has(existingId)) {
        this.removeViewerPeer(existingId);
      }
    }

    for (const session of sessions) {
      this.viewerSessionsById.set(session.id, session);
      this.ensureViewerDiagnostics(session.id);
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
        try {
          await this.openViewerPeer(session);
        } catch {
          this.viewerErrors.update((rows) => ({
            ...rows,
            [session.id]: "Failed to open viewer peer. Reconnecting..."
          }));
          this.scheduleViewerReconnect(session.id, 1_800);
        }
      }
    }
  }

  focusSessionOnViewer(session: LiveCameraSessionRecord, cause: "SELECT" | "SWITCH") {
    this.diag("viewer.select", "focus-session", {
      sessionId: session.id,
      userId: session.userId,
      cause,
      streamPresent: Boolean(this.viewerStreams()[session.id])
    });

    this.updateViewerDiagnostics(session.id, {
      lastRebindCause: cause
    });

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

  reportMediaStreamBindingState(state: MediaStreamBindingState, scope: ViewerDiagnosticsScope) {
    const sessionId = state.sessionId;
    if (!sessionId) {
      return;
    }

    const current = this.viewerDiagnostics()[sessionId] ?? this.createViewerDiagnostics(sessionId);
    const nextSrcObjectBound = state.hasStream ? state.srcObjectBound : current.srcObjectBound;
    const nextRemoteVideoTrackPresent = state.hasStream
      ? state.remoteVideoTrackPresent
      : current.remoteVideoTrackPresent;
    const nextPlayError = state.playAttempted
      ? state.playSucceeded
        ? null
        : state.playError
      : current.playError;

    this.updateViewerDiagnostics(sessionId, {
      srcObjectBound: nextSrcObjectBound,
      remoteVideoTrackPresent: nextRemoteVideoTrackPresent,
      playError: nextPlayError,
      lastRebindCause: scope.toUpperCase()
    });

    this.diag("viewer.media", "video-element-state", {
      sessionId,
      scope,
      srcObjectBound: nextSrcObjectBound,
      playSucceeded: state.playSucceeded,
      playError: state.playError
    });
  }

  private async openViewerPeer(session: LiveCameraSessionRecord) {
    const config = await this.getRtcConfiguration();
    const viewerPeerId = session.id;
    const peer = new RTCPeerConnection(config);
    this.viewerPeerConnections.set(session.id, peer);
    this.clearViewerTrackWaitTimer(session.id);
    this.startViewerStatsPolling(session.id, peer);

    this.updateViewerDiagnostics(session.id, {
      socketConnected: this.viewerConnected(),
      connectionState: peer.connectionState,
      iceConnectionState: peer.iceConnectionState,
      signalingState: peer.signalingState,
      remoteStreamCreated: false,
      remoteVideoTrackPresent: false,
      srcObjectBound: false,
      playError: null
    });

    this.diag("viewer.peer", "peer-created", {
      sessionId: session.id,
      userId: session.userId
    });

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

        this.updateViewerDiagnostics(session.id, {
          remoteStreamCreated: false,
          remoteVideoTrackPresent: false
        });
      }, 15_000)
    );

    peer.addTransceiver("video", { direction: "recvonly" });
    peer.addTransceiver("audio", { direction: "recvonly" });

    peer.ontrack = (event) => {
      const fallbackStream = new MediaStream([event.track]);
      const stream = event.streams[0] ?? fallbackStream;
      const hasVideoTrack = stream.getVideoTracks().length > 0 || event.track.kind === "video";
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

      this.updateViewerDiagnostics(session.id, {
        remoteStreamCreated: true,
        remoteVideoTrackPresent: hasVideoTrack
      });

      this.diag("viewer.peer", "remote-stream-created", {
        sessionId: session.id,
        hasVideoTrack,
        trackKind: event.track.kind,
        streamId: stream.id
      });
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
      this.updateViewerDiagnostics(session.id, {
        iceConnectionState: peer.iceConnectionState
      });

      this.diag("viewer.peer", "ice-connection-state", {
        sessionId: session.id,
        state: peer.iceConnectionState
      });

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

    peer.onsignalingstatechange = () => {
      this.updateViewerDiagnostics(session.id, {
        signalingState: peer.signalingState
      });

      this.diag("viewer.peer", "signaling-state", {
        sessionId: session.id,
        state: peer.signalingState
      });
    };

    peer.onconnectionstatechange = () => {
      this.updateViewerDiagnostics(session.id, {
        connectionState: peer.connectionState
      });

      this.diag("viewer.peer", "connection-state", {
        sessionId: session.id,
        state: peer.connectionState
      });

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
      peer.onsignalingstatechange = null;
      peer.close();
      this.viewerPeerConnections.delete(sessionId);
    }
    this.clearViewerTrackWaitTimer(sessionId);
    this.clearViewerReconnectTimer(sessionId);
    this.stopViewerStatsPolling(sessionId);

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

    this.viewerDiagnostics.update((rows) => {
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
          this.scheduleViewerSocketReconnect();
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

    this.closeSenderSocket(true);
    const wsUrl = this.buildWsUrl("SENDER");
    if (!wsUrl) {
      throw new Error("Not authenticated.");
    }

    this.explicitSenderSocketClose = false;
    const socket = new WebSocket(wsUrl);
    this.senderSocket = socket;

    await new Promise<void>((resolve, reject) => {
      this.senderOpenResolver = resolve;
      const timeout = setTimeout(() => {
        reject(new Error("Could not connect to signaling server."));
      }, this.socketConnectTimeoutMs);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.senderSocketReady = true;
        this.senderSocketConnected.set(true);
        this.senderHeartbeatLastPongAt = Date.now();
        this.startSenderHeartbeat();
        this.diag("sender.socket", "open", {});
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

    socket.onclose = (event) => {
      const wasExplicit = this.explicitSenderSocketClose;
      this.senderSocketReady = false;
      this.senderSocketConnected.set(false);
      this.senderSocket = null;
      this.stopSenderHeartbeat();
      this.closeAllSenderPeers();
      this.rejectAllSenderWaiters("Sender signaling socket closed before registration completed.");

      this.diag("sender.socket", "close", {
        code: event.code,
        reason: event.reason,
        explicit: wasExplicit
      });

      if (!wasExplicit && this.senderStatus() !== "IDLE" && this.senderSession()) {
        this.senderStatus.set("CONNECTING");
        this.senderError.set("Sender signaling disconnected. Reconnecting...");
        this.scheduleSenderReconnect();
      }
    };
  }

  private closeSenderSocket(explicit = false) {
    this.explicitSenderSocketClose = explicit;

    if (this.senderSocket) {
      try {
        this.senderSocket.close();
      } catch {
        // Ignore close errors.
      }
    }
    this.senderSocket = null;
    this.senderSocketReady = false;
    this.senderSocketConnected.set(false);
    this.senderOpenResolver = null;
    this.stopSenderHeartbeat();
    this.rejectAllSenderWaiters("Sender signaling socket was closed.");
  }

  private async ensureViewerSocket() {
    if (this.viewerSocket && this.viewerSocket.readyState === WebSocket.OPEN && this.viewerSocketReady) {
      return;
    }

    this.closeViewerSocket(true);
    const wsUrl = this.buildWsUrl("VIEWER");
    if (!wsUrl) {
      throw new Error("Not authenticated.");
    }

    this.explicitViewerSocketClose = false;
    const socket = new WebSocket(wsUrl);
    this.viewerSocket = socket;

    await new Promise<void>((resolve, reject) => {
      this.viewerOpenResolver = resolve;
      const timeout = setTimeout(() => {
        reject(new Error("Could not connect to viewer signaling."));
      }, this.socketConnectTimeoutMs);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.viewerSocketReady = true;
        this.viewerConnected.set(true);
        this.viewerHeartbeatLastPongAt = Date.now();
        this.startViewerHeartbeat();
        this.viewerSocketReconnectAttempts = 0;
        this.diag("viewer.socket", "open", {});

        this.viewerDiagnostics.update((rows) => {
          const next = { ...rows };
          for (const [sessionId, diagnostic] of Object.entries(next)) {
            next[sessionId] = {
              ...diagnostic,
              socketConnected: true,
              lastUpdatedAt: new Date().toISOString()
            };
          }
          return next;
        });

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

    socket.onclose = (event) => {
      const wasExplicit = this.explicitViewerSocketClose;
      this.viewerSocketReady = false;
      this.viewerConnected.set(false);
      this.viewerSocket = null;
      this.stopViewerHeartbeat();

      this.diag("viewer.socket", "close", {
        code: event.code,
        reason: event.reason,
        explicit: wasExplicit
      });

      this.viewerDiagnostics.update((rows) => {
        const next = { ...rows };
        for (const [sessionId, diagnostic] of Object.entries(next)) {
          next[sessionId] = {
            ...diagnostic,
            socketConnected: false,
            lastUpdatedAt: new Date().toISOString()
          };
        }
        return next;
      });

      for (const sessionId of this.viewerPeerConnections.keys()) {
        this.removeViewerPeer(sessionId);
      }

      if (!wasExplicit && this.viewerSessionsById.size) {
        this.viewerErrors.update((rows) => ({
          ...rows,
          _global: "Viewer signaling disconnected. Reconnecting..."
        }));
        this.scheduleViewerSocketReconnect();
      }
    };
  }

  private closeViewerSocket(explicit = false) {
    this.explicitViewerSocketClose = explicit;
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
    this.stopViewerHeartbeat();
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

    if (message["type"] === "PONG") {
      this.senderHeartbeatLastPongAt = Date.now();
      this.diag("sender.socket", "pong", {
        pingId: String(message["pingId"] ?? "")
      });
      return;
    }

    if (message["type"] === "SENDER_REGISTERED") {
      const sessionId = String(message["sessionId"] ?? "");
      if (sessionId) {
        this.resolveSenderRegisterWaiter(sessionId);
      }
      this.diag("sender.socket", "registered", {
        sessionId
      });
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

    if (message["type"] === "SESSION_ENDED") {
      const sessionId = String(message["sessionId"] ?? "");
      const activeSession = this.senderSession();
      if (activeSession?.id && sessionId === activeSession.id) {
        this.diag("sender.socket", "session-ended", {
          sessionId,
          reason: String(message["reason"] ?? "")
        });
        void this.stopBroadcast("SESSION_ENDED_BY_SERVER");
      }
      return;
    }

    if (message["type"] === "ERROR") {
      const text = String(message["message"] ?? "Camera signaling error.");
      this.senderError.set(text);

      const currentSessionId = this.senderSession()?.id;
      if (currentSessionId) {
        this.rejectSenderRegisterWaiter(currentSessionId, text);
      }

      this.diag("sender.socket", "error", {
        message: text,
        code: String(message["code"] ?? "")
      });
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

    peer.oniceconnectionstatechange = () => {
      this.diag("sender.peer", "ice-connection-state", {
        sessionId,
        viewerUserId,
        viewerPeerId,
        state: peer.iceConnectionState
      });
    };

    peer.onsignalingstatechange = () => {
      this.diag("sender.peer", "signaling-state", {
        sessionId,
        viewerUserId,
        viewerPeerId,
        state: peer.signalingState
      });
    };

    peer.onconnectionstatechange = () => {
      this.diag("sender.peer", "connection-state", {
        sessionId,
        viewerUserId,
        viewerPeerId,
        state: peer.connectionState
      });

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
    peer.oniceconnectionstatechange = null;
    peer.onsignalingstatechange = null;
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

    if (message["type"] === "PONG") {
      this.viewerHeartbeatLastPongAt = Date.now();
      this.diag("viewer.socket", "pong", {
        pingId: String(message["pingId"] ?? "")
      });
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
      this.diag("viewer.socket", "session-ended", {
        sessionId,
        reason: String(message["reason"] ?? "")
      });
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

      this.diag("viewer.socket", "error", {
        message: text,
        code: String(message["code"] ?? "")
      });
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

  private clearAllViewerTrackWaitTimers() {
    for (const timer of this.viewerTrackWaitTimers.values()) {
      clearTimeout(timer);
    }
    this.viewerTrackWaitTimers.clear();
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

  private async reconcileFailedStartup(
    session: LiveCameraSessionRecord,
    status: Exclude<LiveCameraSessionStatus, "OFFLINE" | "CONNECTING" | "LIVE" | "NETWORK_WEAK">,
    errorMessage: string
  ) {
    try {
      await firstValueFrom(
        this.api.updateLiveCameraSessionState(session.id, status, {
          error: errorMessage,
          failedAt: new Date().toISOString()
        })
      );
    } catch {
      // Fallback stop below keeps DB/session state reconciled.
    }

    try {
      await firstValueFrom(this.api.stopLiveCameraSession(session.id, "STARTUP_FAILED"));
    } catch {
      // If stop fails, sender cleanup still proceeds locally.
    }

    this.clearSenderReconnectTimer();
    this.closeAllSenderPeers();
    this.closeSenderSocket(true);
    this.stopLocalSenderMedia();
    this.senderSession.set(null);
    this.senderStatus.set("IDLE");
  }

  private async registerSenderSession(sessionId: string) {
    this.sendToSenderSocket({
      type: "REGISTER_SENDER",
      sessionId
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.senderRegisterWaiters.delete(sessionId);
        reject(new Error("Sender registration timed out."));
      }, 8_000);

      this.senderRegisterWaiters.set(sessionId, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer
      });
    });
  }

  private resolveSenderRegisterWaiter(sessionId: string) {
    const waiter = this.senderRegisterWaiters.get(sessionId);
    if (!waiter) {
      return;
    }

    this.senderRegisterWaiters.delete(sessionId);
    waiter.resolve();
  }

  private rejectSenderRegisterWaiter(sessionId: string, message: string) {
    const waiter = this.senderRegisterWaiters.get(sessionId);
    if (!waiter) {
      return;
    }

    this.senderRegisterWaiters.delete(sessionId);
    waiter.reject(new Error(message));
  }

  private rejectAllSenderWaiters(message: string) {
    for (const [sessionId, waiter] of this.senderRegisterWaiters.entries()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
      this.senderRegisterWaiters.delete(sessionId);
    }
  }

  private scheduleSenderReconnect() {
    if (this.senderReconnectTimer) {
      return;
    }

    const session = this.senderSession();
    if (!session || !this.senderLocalStream()) {
      return;
    }

    this.senderReconnectAttempts += 1;
    const delayMs = Math.min(1_000 * Math.pow(2, this.senderReconnectAttempts - 1), 10_000);

    this.senderReconnectTimer = setTimeout(() => {
      this.senderReconnectTimer = null;

      const currentSession = this.senderSession();
      if (!currentSession || currentSession.id !== session.id || this.senderStatus() === "IDLE") {
        return;
      }

      void this.ensureSenderSocket()
        .then(() => this.registerSenderSession(session.id))
        .then(() => {
          this.senderReconnectAttempts = 0;
          this.senderError.set(null);
          this.senderStatus.set("LIVE");

          this.sendToSenderSocket({
            type: "SESSION_STATE",
            sessionId: session.id,
            targetUserId: session.userId,
            sessionStatus: "LIVE",
            isActive: true
          });

          this.diag("sender.socket", "reconnected", {
            sessionId: session.id
          });
        })
        .catch(() => {
          if (this.senderReconnectAttempts >= 5) {
            this.senderError.set("Signaling reconnect failed. Please restart camera broadcast.");
            void this.reconcileLostSessionAfterReconnectFailure(session);
            return;
          }
          this.scheduleSenderReconnect();
        });
    }, delayMs);
  }

  private clearSenderReconnectTimer() {
    if (this.senderReconnectTimer) {
      clearTimeout(this.senderReconnectTimer);
      this.senderReconnectTimer = null;
    }
    this.senderReconnectAttempts = 0;
  }

  private async reconcileLostSessionAfterReconnectFailure(session: LiveCameraSessionRecord) {
    try {
      await firstValueFrom(
        this.api.updateLiveCameraSessionState(session.id, "FAILED", {
          error: "SIGNALING_RECONNECT_FAILED",
          failedAt: new Date().toISOString()
        })
      );
    } catch {
      // Best effort.
    }

    try {
      await firstValueFrom(this.api.stopLiveCameraSession(session.id, "SIGNALING_RECONNECT_FAILED"));
    } catch {
      // Best effort.
    }

    this.clearSenderReconnectTimer();
    this.closeAllSenderPeers();
    this.closeSenderSocket(true);
    this.stopLocalSenderMedia();
    this.senderSession.set(null);
    this.senderStatus.set("IDLE");
  }

  private scheduleViewerSocketReconnect() {
    if (this.viewerSocketReconnectTimer || this.explicitViewerSocketClose) {
      return;
    }

    this.viewerSocketReconnectAttempts += 1;
    const delayMs = Math.min(1_000 * Math.pow(2, this.viewerSocketReconnectAttempts - 1), 8_000);

    this.viewerSocketReconnectTimer = setTimeout(() => {
      this.viewerSocketReconnectTimer = null;

      if (this.explicitViewerSocketClose || !this.viewerSessionsById.size) {
        return;
      }

      void this.ensureViewerSocket()
        .then(async () => {
          for (const session of this.viewerSessionsById.values()) {
            if (
              !session.isActive ||
              session.sessionStatus === "OFFLINE" ||
              TERMINAL_STATES.has(session.sessionStatus) ||
              this.viewerPeerConnections.has(session.id)
            ) {
              continue;
            }
            await this.openViewerPeer(session);
          }
          this.viewerErrors.update((rows) => ({
            ...rows,
            _global: ""
          }));
        })
        .catch(() => {
          this.scheduleViewerSocketReconnect();
        });
    }, delayMs);
  }

  private clearViewerSocketReconnectTimer() {
    if (this.viewerSocketReconnectTimer) {
      clearTimeout(this.viewerSocketReconnectTimer);
      this.viewerSocketReconnectTimer = null;
    }
    this.viewerSocketReconnectAttempts = 0;
  }

  private startSenderHeartbeat() {
    this.stopSenderHeartbeat();

    this.senderHeartbeatTimer = setInterval(() => {
      const socket = this.senderSocket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const now = Date.now();
      if (now - this.senderHeartbeatLastPongAt > this.heartbeatTimeoutMs) {
        this.diag("sender.socket", "heartbeat-timeout", {
          ageMs: now - this.senderHeartbeatLastPongAt
        });
        this.closeSenderSocket(false);
        return;
      }

      this.senderHeartbeatPingCounter += 1;
      this.sendToSenderSocket({
        type: "PING",
        pingId: `sender-${this.senderHeartbeatPingCounter}`,
        clientAt: new Date().toISOString()
      });
    }, this.heartbeatIntervalMs);
  }

  private stopSenderHeartbeat() {
    if (this.senderHeartbeatTimer) {
      clearInterval(this.senderHeartbeatTimer);
      this.senderHeartbeatTimer = null;
    }
  }

  private startViewerHeartbeat() {
    this.stopViewerHeartbeat();

    this.viewerHeartbeatTimer = setInterval(() => {
      const socket = this.viewerSocket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const now = Date.now();
      if (now - this.viewerHeartbeatLastPongAt > this.heartbeatTimeoutMs) {
        this.diag("viewer.socket", "heartbeat-timeout", {
          ageMs: now - this.viewerHeartbeatLastPongAt
        });
        this.closeViewerSocket(false);
        this.scheduleViewerSocketReconnect();
        return;
      }

      this.viewerHeartbeatPingCounter += 1;
      this.sendToViewerSocket({
        type: "PING",
        pingId: `viewer-${this.viewerHeartbeatPingCounter}`,
        clientAt: new Date().toISOString()
      });
    }, this.heartbeatIntervalMs);
  }

  private stopViewerHeartbeat() {
    if (this.viewerHeartbeatTimer) {
      clearInterval(this.viewerHeartbeatTimer);
      this.viewerHeartbeatTimer = null;
    }
  }

  private ensureViewerDiagnostics(sessionId: string) {
    if (this.viewerDiagnostics()[sessionId]) {
      return;
    }

    this.viewerDiagnostics.update((rows) => ({
      ...rows,
      [sessionId]: this.createViewerDiagnostics(sessionId)
    }));
  }

  private createViewerDiagnostics(sessionId: string): ViewerPeerDiagnostics {
    return {
      sessionId,
      socketConnected: this.viewerConnected(),
      connectionState: "new",
      iceConnectionState: "new",
      signalingState: "stable",
      remoteStreamCreated: false,
      remoteVideoTrackPresent: false,
      srcObjectBound: false,
      playError: null,
      bytesReceived: null,
      selectedIceCandidateType: null,
      lastRebindCause: null,
      lastUpdatedAt: new Date().toISOString()
    };
  }

  private updateViewerDiagnostics(sessionId: string, patch: Partial<ViewerPeerDiagnostics>) {
    this.viewerDiagnostics.update((rows) => {
      const current = rows[sessionId] ?? this.createViewerDiagnostics(sessionId);
      return {
        ...rows,
        [sessionId]: {
          ...current,
          ...patch,
          lastUpdatedAt: new Date().toISOString()
        }
      };
    });
  }

  private startViewerStatsPolling(sessionId: string, peer: RTCPeerConnection) {
    this.stopViewerStatsPolling(sessionId);

    const timer = setInterval(() => {
      void this.collectViewerStats(sessionId, peer);
    }, 3_000);

    this.viewerStatsPollTimers.set(sessionId, timer);
  }

  private stopViewerStatsPolling(sessionId: string) {
    const timer = this.viewerStatsPollTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.viewerStatsPollTimers.delete(sessionId);
    }
  }

  private clearAllViewerStatsPolling() {
    for (const timer of this.viewerStatsPollTimers.values()) {
      clearInterval(timer);
    }
    this.viewerStatsPollTimers.clear();
  }

  private async collectViewerStats(sessionId: string, peer: RTCPeerConnection) {
    if (!this.viewerPeerConnections.has(sessionId)) {
      return;
    }

    try {
      const stats = await peer.getStats();
      const { bytesReceived, selectedIceCandidateType } = this.extractViewerStats(stats);
      this.updateViewerDiagnostics(sessionId, {
        bytesReceived,
        selectedIceCandidateType,
        connectionState: peer.connectionState,
        iceConnectionState: peer.iceConnectionState,
        signalingState: peer.signalingState
      });
    } catch {
      // Ignore polling errors for closed/transient peers.
    }
  }

  private extractViewerStats(stats: RTCStatsReport) {
    let bytesReceived: number | null = null;
    let selectedPairId: string | null = null;
    let selectedIceCandidateType: string | null = null;

    stats.forEach((row) => {
      const report = row as unknown as {
        type: string;
        selectedCandidatePairId?: string;
        kind?: string;
        isRemote?: boolean;
        bytesReceived?: number;
      };

      if (report.type === "transport" && typeof report.selectedCandidatePairId === "string") {
        selectedPairId = report.selectedCandidatePairId;
      }

      if (report.type === "inbound-rtp" && report.kind === "video" && report.isRemote !== true) {
        const nextBytes = typeof report.bytesReceived === "number" ? report.bytesReceived : null;
        if (nextBytes != null && (bytesReceived == null || nextBytes > bytesReceived)) {
          bytesReceived = nextBytes;
        }
      }
    });

    stats.forEach((row) => {
      const report = row as unknown as {
        type: string;
        id: string;
        selected?: boolean;
        localCandidateId?: string;
        remoteCandidateId?: string;
      };

      if (report.type !== "candidate-pair") {
        return;
      }

      const isSelected = report.selected === true || (selectedPairId != null && report.id === selectedPairId);
      if (!isSelected) {
        return;
      }

      const local = report.localCandidateId
        ? (stats.get(report.localCandidateId) as unknown as { candidateType?: string } | undefined)
        : undefined;
      const remote = report.remoteCandidateId
        ? (stats.get(report.remoteCandidateId) as unknown as { candidateType?: string } | undefined)
        : undefined;

      const localType = typeof local?.candidateType === "string" ? local.candidateType : null;
      const remoteType = typeof remote?.candidateType === "string" ? remote.candidateType : null;

      selectedIceCandidateType = localType && remoteType ? `${localType}->${remoteType}` : localType ?? remoteType;
    });

    return {
      bytesReceived,
      selectedIceCandidateType
    };
  }

  private diag(scope: string, event: string, payload: Record<string, unknown>) {
    console.info(`[live-camera][${scope}] ${event}`, {
      at: new Date().toISOString(),
      ...payload
    });
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

