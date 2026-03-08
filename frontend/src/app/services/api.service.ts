import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { environment } from "../../environments/environment";
import {
  ControlRoomOverviewResponse,
  LiveCameraEventType,
  LiveCameraIceConfig,
  LiveCameraLogsResponse,
  LiveCameraSessionRecord,
  LiveCameraSessionStatus,
  PushPublicKeyResponse,
  PushSubscriptionRecord,
  LiveLocationShareStatus,
  LivePersonLocation,
  LocationHistoryResponse,
  TrackingLogsResponse,
  TrackingOverviewResponse,
  TrackingPingRequest,
  LocationUpdateSource,
  User
} from "../models";

export type LocationUpdateInput = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: string;
  source?: LocationUpdateSource;
  batteryLevel?: number | null;
};

@Injectable({ providedIn: "root" })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  get<T>(path: string, params?: Record<string, string>) {
    return this.http.get<T>(`${environment.apiBaseUrl}${path}`, { params });
  }

  getBlob(path: string) {
    return this.http.get(`${environment.apiBaseUrl}${path}`, { responseType: "blob" });
  }

  post<T>(path: string, payload: unknown): Observable<T> {
    return this.http.post<T>(`${environment.apiBaseUrl}${path}`, payload);
  }

  postForm<T>(path: string, formData: FormData): Observable<T> {
    return this.http.post<T>(`${environment.apiBaseUrl}${path}`, formData);
  }

  patch<T>(path: string, payload: unknown): Observable<T> {
    return this.http.patch<T>(`${environment.apiBaseUrl}${path}`, payload);
  }

  put<T>(path: string, payload: unknown): Observable<T> {
    return this.http.put<T>(`${environment.apiBaseUrl}${path}`, payload);
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${environment.apiBaseUrl}${path}`);
  }

  startLiveTracking() {
    return this.http.post<{ isSharing: boolean; sessionId: string; startedAt: string }>(
      `${environment.apiBaseUrl}/location/start`,
      {}
    );
  }

  stopLiveTracking() {
    return this.http.post<{ isSharing: boolean; stoppedAt: string }>(`${environment.apiBaseUrl}/location/stop`, {});
  }

  sendLiveTrackingUpdate(payload: LocationUpdateInput) {
    return this.http.post<{ accepted: boolean; receivedAt: string; recordedAt: string }>(
      `${environment.apiBaseUrl}/location/update`,
      payload
    );
  }

  getLiveTrackingStatus() {
    return this.http.get<LiveLocationShareStatus>(`${environment.apiBaseUrl}/location/status`);
  }

  getLatestLiveTrackedUsers(activeOnly = false, staleAfterSeconds = 120) {
    const params = new HttpParams()
      .set("activeOnly", String(activeOnly))
      .set("staleAfterSeconds", String(staleAfterSeconds));

    return this.http.get<LivePersonLocation[]>(`${environment.apiBaseUrl}/locations/latest`, { params });
  }

  getLiveTrackingHistory(personId: string, options?: { since?: string; until?: string; limit?: number }) {
    let params = new HttpParams();
    if (options?.since) {
      params = params.set("since", options.since);
    }
    if (options?.until) {
      params = params.set("until", options.until);
    }
    if (typeof options?.limit === "number") {
      params = params.set("limit", String(options.limit));
    }

    return this.http.get<LocationHistoryResponse>(`${environment.apiBaseUrl}/locations/history/${personId}`, {
      params
    });
  }

  updateUser(userId: string, payload: Partial<User> & { password?: string }) {
    return this.http.patch<User>(`${environment.apiBaseUrl}/users/${userId}`, payload);
  }

  createTrackingPing(targetUserId: string, requestMessage?: string, expiresInSeconds?: number) {
    return this.http.post<TrackingPingRequest>(`${environment.apiBaseUrl}/tracking-pings`, {
      targetUserId,
      requestMessage,
      expiresInSeconds
    });
  }

  getTrackingPings(filters?: {
    targetUserId?: string;
    requestedByUserId?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) {
    let params = new HttpParams();
    if (filters?.targetUserId) {
      params = params.set("targetUserId", filters.targetUserId);
    }
    if (filters?.requestedByUserId) {
      params = params.set("requestedByUserId", filters.requestedByUserId);
    }
    if (filters?.status) {
      params = params.set("status", filters.status);
    }
    if (filters?.from) {
      params = params.set("from", filters.from);
    }
    if (filters?.to) {
      params = params.set("to", filters.to);
    }
    if (typeof filters?.limit === "number") {
      params = params.set("limit", String(filters.limit));
    }

    return this.http.get<TrackingPingRequest[]>(`${environment.apiBaseUrl}/tracking-pings`, { params });
  }

  getTrackingPing(id: string) {
    return this.http.get<TrackingPingRequest>(`${environment.apiBaseUrl}/tracking-pings/${id}`);
  }

  getPendingMyTrackingPings() {
    return this.http.get<TrackingPingRequest[]>(`${environment.apiBaseUrl}/tracking-pings/my-pending`);
  }

  openTrackingPing(pingId: string) {
    return this.http.post<TrackingPingRequest>(`${environment.apiBaseUrl}/tracking-pings/${pingId}/open`, {});
  }

  respondToTrackingPing(
    pingId: string,
    payload:
      | {
          latitude: number;
          longitude: number;
          accuracy: number;
          timestamp?: string | number | null;
          batteryLevel?: number | null;
        }
      | {
          failureReason: "PERMISSION_DENIED" | "UNAVAILABLE" | "TIMEOUT" | "UNKNOWN";
          errorMessage?: string | null;
        }
  ) {
    return this.http.post<{
      accepted: boolean;
      lateResponse?: boolean;
      locationPointId?: string;
      reason?: string;
      ping: TrackingPingRequest;
    }>(`${environment.apiBaseUrl}/tracking-pings/${pingId}/respond`, payload);
  }

  cancelTrackingPing(pingId: string) {
    return this.http.post<TrackingPingRequest>(`${environment.apiBaseUrl}/tracking-pings/${pingId}/cancel`, {});
  }

  getTrackingUsersOverview(params?: {
    search?: string;
    health?: string;
    staleAfterSeconds?: number;
    offlineAfterSeconds?: number;
    limit?: number;
  }) {
    let query = new HttpParams();
    if (params?.search) {
      query = query.set("search", params.search);
    }
    if (params?.health) {
      query = query.set("health", params.health);
    }
    if (typeof params?.staleAfterSeconds === "number") {
      query = query.set("staleAfterSeconds", String(params.staleAfterSeconds));
    }
    if (typeof params?.offlineAfterSeconds === "number") {
      query = query.set("offlineAfterSeconds", String(params.offlineAfterSeconds));
    }
    if (typeof params?.limit === "number") {
      query = query.set("limit", String(params.limit));
    }

    return this.http.get<TrackingOverviewResponse>(`${environment.apiBaseUrl}/tracking-users/overview`, {
      params: query
    });
  }

  stopTrackingSession(userId: string) {
    return this.http.post<{ userId: string; fullName: string; stoppedAt: string; sessionCount: number }>(
      `${environment.apiBaseUrl}/tracking-users/${userId}/stop-session`,
      {}
    );
  }

  getTrackingLogs(filters?: {
    userId?: string;
    actorUserId?: string;
    eventType?: string;
    pingStatus?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) {
    let params = new HttpParams();
    if (filters?.userId) {
      params = params.set("userId", filters.userId);
    }
    if (filters?.actorUserId) {
      params = params.set("actorUserId", filters.actorUserId);
    }
    if (filters?.eventType) {
      params = params.set("eventType", filters.eventType);
    }
    if (filters?.pingStatus) {
      params = params.set("pingStatus", filters.pingStatus);
    }
    if (filters?.from) {
      params = params.set("from", filters.from);
    }
    if (filters?.to) {
      params = params.set("to", filters.to);
    }
    if (typeof filters?.page === "number") {
      params = params.set("page", String(filters.page));
    }
    if (typeof filters?.pageSize === "number") {
      params = params.set("pageSize", String(filters.pageSize));
    }

    return this.http.get<TrackingLogsResponse>(`${environment.apiBaseUrl}/tracking-logs`, { params });
  }

  getPushPublicKey() {
    return this.http.get<PushPublicKeyResponse>(`${environment.apiBaseUrl}/push-subscriptions/public-key`);
  }

  registerPushSubscription(subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    expirationTime?: number | null;
  }) {
    return this.http.post<PushSubscriptionRecord>(`${environment.apiBaseUrl}/push-subscriptions`, subscription);
  }

  removePushSubscription(subscriptionId: string) {
    return this.http.delete<void>(`${environment.apiBaseUrl}/push-subscriptions/${subscriptionId}`);
  }

  startLiveCameraSession(payload?: {
    relatedLocationPointId?: string | null;
    deviceLabel?: string | null;
    microphoneEnabled?: boolean;
    emergency?: boolean;
  }) {
    return this.http.post<LiveCameraSessionRecord>(`${environment.apiBaseUrl}/live-camera/sessions/start`, {
      relatedLocationPointId: payload?.relatedLocationPointId,
      deviceLabel: payload?.deviceLabel,
      microphoneEnabled: payload?.microphoneEnabled,
      emergency: payload?.emergency
    });
  }

  getLiveCameraIceConfig() {
    return this.http.get<LiveCameraIceConfig>(`${environment.apiBaseUrl}/live-camera/ice-config`);
  }

  stopLiveCameraSession(sessionId: string, reason?: string) {
    return this.http.post<LiveCameraSessionRecord>(`${environment.apiBaseUrl}/live-camera/sessions/${sessionId}/stop`, {
      reason
    });
  }

  updateLiveCameraSessionState(
    sessionId: string,
    sessionStatus: Exclude<LiveCameraSessionStatus, "OFFLINE">,
    metadata?: Record<string, unknown> | null
  ) {
    return this.http.post<LiveCameraSessionRecord>(`${environment.apiBaseUrl}/live-camera/sessions/${sessionId}/state`, {
      sessionStatus,
      metadata: metadata ?? undefined
    });
  }

  getLiveCameraSessions(filters?: { userId?: string; includeInactive?: boolean; limit?: number }) {
    let params = new HttpParams();
    if (filters?.userId) {
      params = params.set("userId", filters.userId);
    }
    if (typeof filters?.includeInactive === "boolean") {
      params = params.set("includeInactive", String(filters.includeInactive));
    }
    if (typeof filters?.limit === "number") {
      params = params.set("limit", String(filters.limit));
    }

    return this.http.get<LiveCameraSessionRecord[]>(`${environment.apiBaseUrl}/live-camera/sessions`, { params });
  }

  getLiveCameraSession(sessionId: string) {
    return this.http.get<LiveCameraSessionRecord>(`${environment.apiBaseUrl}/live-camera/sessions/${sessionId}`);
  }

  logLiveCameraViewerEvent(payload: {
    targetUserId: string;
    liveCameraSessionId?: string | null;
    eventType: Extract<
      LiveCameraEventType,
      "VIEWER_SWITCHED_STREAM" | "STREAM_SELECTED_IN_CONTROL_ROOM" | "VIEWER_OPENED_STREAM"
    >;
    metadata?: Record<string, unknown> | null;
  }) {
    return this.http.post<{ id: string; createdAt: string }>(`${environment.apiBaseUrl}/live-camera/events`, payload);
  }

  getLiveCameraLogs(filters?: {
    userId?: string;
    actorUserId?: string;
    eventType?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) {
    let params = new HttpParams();
    if (filters?.userId) {
      params = params.set("userId", filters.userId);
    }
    if (filters?.actorUserId) {
      params = params.set("actorUserId", filters.actorUserId);
    }
    if (filters?.eventType) {
      params = params.set("eventType", filters.eventType);
    }
    if (filters?.from) {
      params = params.set("from", filters.from);
    }
    if (filters?.to) {
      params = params.set("to", filters.to);
    }
    if (typeof filters?.page === "number") {
      params = params.set("page", String(filters.page));
    }
    if (typeof filters?.pageSize === "number") {
      params = params.set("pageSize", String(filters.pageSize));
    }

    return this.http.get<LiveCameraLogsResponse>(`${environment.apiBaseUrl}/live-camera/logs`, { params });
  }

  getControlRoomOverview(params?: {
    search?: string;
    activeCameraOnly?: boolean;
    liveTrackingOnly?: boolean;
    staleAfterSeconds?: number;
    offlineAfterSeconds?: number;
    limit?: number;
  }) {
    let query = new HttpParams();
    if (params?.search) {
      query = query.set("search", params.search);
    }
    if (typeof params?.activeCameraOnly === "boolean") {
      query = query.set("activeCameraOnly", String(params.activeCameraOnly));
    }
    if (typeof params?.liveTrackingOnly === "boolean") {
      query = query.set("liveTrackingOnly", String(params.liveTrackingOnly));
    }
    if (typeof params?.staleAfterSeconds === "number") {
      query = query.set("staleAfterSeconds", String(params.staleAfterSeconds));
    }
    if (typeof params?.offlineAfterSeconds === "number") {
      query = query.set("offlineAfterSeconds", String(params.offlineAfterSeconds));
    }
    if (typeof params?.limit === "number") {
      query = query.set("limit", String(params.limit));
    }

    return this.http.get<ControlRoomOverviewResponse>(`${environment.apiBaseUrl}/control-room/overview`, {
      params: query
    });
  }

  resetTrustedDevice(userId: string) {
    return this.http.post<{ userId: string; resetAt: string; hadTrustedDevice: boolean }>(
      `${environment.apiBaseUrl}/users/${userId}/trusted-device/reset`,
      {}
    );
  }

  // Backward-compatible wrappers while legacy callers are being migrated.
  startLocationSharing() {
    return this.startLiveTracking();
  }

  stopLocationSharing() {
    return this.stopLiveTracking();
  }

  sendLocationUpdate(payload: LocationUpdateInput) {
    return this.sendLiveTrackingUpdate(payload);
  }

  getLocationSharingStatus() {
    return this.getLiveTrackingStatus();
  }

  getLatestLocations(activeOnly = false, staleAfterSeconds = 120) {
    return this.getLatestLiveTrackedUsers(activeOnly, staleAfterSeconds);
  }

  getLocationHistory(personId: string, options?: { since?: string; until?: string; limit?: number }) {
    return this.getLiveTrackingHistory(personId, options);
  }
}
