import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { environment } from "../../environments/environment";
import {
  LiveLocationShareStatus,
  LivePersonLocation,
  LocationHistoryResponse,
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
