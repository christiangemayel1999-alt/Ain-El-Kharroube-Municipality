import { HttpErrorResponse } from "@angular/common/http";
import { Injectable, signal } from "@angular/core";
import { User } from "../models";
import { ApiService, LocationUpdateInput } from "./api.service";

type LocationSnapshot = {
  latitude: number;
  longitude: number;
  accuracyM: number;
  recordedAt: string;
};

@Injectable({ providedIn: "root" })
export class LiveTrackingService {
  private readonly minSendIntervalMs = 30_000;
  private readonly fallbackSendIntervalMs = 45_000;

  readonly isEligible = signal(false);
  readonly loading = signal(false);
  readonly isSharing = signal(false);
  readonly lastSentAt = signal<string | null>(null);
  readonly permissionError = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly showPrompt = signal(false);
  readonly lastKnownLocation = signal<LocationSnapshot | null>(null);

  private activeUserId: string | null = null;
  private promptDismissed = false;
  private watchId: number | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private lastSendMs = 0;
  private lastKnownPosition: GeolocationPosition | null = null;

  constructor(private readonly api: ApiService) {}

  syncAuthenticatedUser(user: User | null) {
    if (!user) {
      this.resetAllState();
      return;
    }

    const userChanged = this.activeUserId !== user.id;
    this.activeUserId = user.id;

    if (!user.liveLocationEnabled) {
      this.isEligible.set(false);
      this.showPrompt.set(false);
      this.isSharing.set(false);
      this.stopLocalTracking();
      return;
    }

    this.isEligible.set(true);

    if (userChanged) {
      this.promptDismissed = false;
      this.message.set(null);
      this.error.set(null);
      this.permissionError.set(null);
      this.lastSentAt.set(null);
      this.lastKnownPosition = null;
      this.lastKnownLocation.set(null);
      this.refreshStatus();
    }
  }

  startSharing() {
    if (this.loading()) {
      return;
    }

    if (!this.isEligible()) {
      this.error.set("Live tracking is not enabled for this account.");
      return;
    }

    const geolocationAvailabilityError = this.getGeolocationAvailabilityError();
    if (geolocationAvailabilityError) {
      this.permissionError.set(geolocationAvailabilityError);
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    this.permissionError.set(null);
    this.message.set(null);

    this.api.startLiveTracking().subscribe({
      next: () => {
        this.loading.set(false);
        this.isSharing.set(true);
        this.showPrompt.set(false);
        this.message.set("Live tracking started.");
        this.beginLocalTracking();
        this.sendCurrentLocation(true);
      },
      error: (err) => {
        this.loading.set(false);
        this.handleApiError(err, "Could not start live tracking.");
      }
    });
  }

  stopSharing(options?: { quiet?: boolean; skipApi?: boolean }) {
    const quiet = options?.quiet ?? false;
    const skipApi = options?.skipApi ?? false;

    if (skipApi) {
      this.isSharing.set(false);
      this.stopLocalTracking();
      if (!quiet) {
        this.message.set("Live tracking stopped.");
      }
      return;
    }

    if (this.loading()) {
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.api.stopLiveTracking().subscribe({
      next: () => {
        this.loading.set(false);
        this.isSharing.set(false);
        this.stopLocalTracking();
        if (!quiet) {
          this.message.set("Live tracking stopped.");
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.handleApiError(err, "Could not stop live tracking.");
      }
    });
  }

  dismissPrompt() {
    this.promptDismissed = true;
    this.showPrompt.set(false);
  }

  prepareForLogout() {
    if (this.isSharing()) {
      this.api.stopLiveTracking().subscribe({
        next: () => {
          // No-op: local state is cleared regardless.
        },
        error: () => {
          // Best-effort stop before logout.
        }
      });
    }

    this.resetAllState();
  }

  getFreshLocation(maxAgeMs = 120_000) {
    const snapshot = this.lastKnownLocation();
    if (!snapshot) {
      return null;
    }

    const ageMs = Date.now() - new Date(snapshot.recordedAt).getTime();
    if (Number.isNaN(ageMs) || ageMs > maxAgeMs) {
      return null;
    }

    return snapshot;
  }

  captureCurrentLocation(forceGps = false): Promise<LocationSnapshot> {
    const geolocationAvailabilityError = this.getGeolocationAvailabilityError();
    if (geolocationAvailabilityError) {
      return Promise.reject(new Error(geolocationAvailabilityError));
    }

    const fresh = !forceGps ? this.getFreshLocation(120_000) : null;
    if (fresh) {
      return Promise.resolve(fresh);
    }

    return new Promise<LocationSnapshot>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const snapshot = this.toSnapshot(position);
          this.lastKnownPosition = position;
          this.lastKnownLocation.set(snapshot);
          resolve(snapshot);
        },
        (geoError) => {
          reject(new Error(this.mapGeolocationError(geoError)));
        },
        {
          enableHighAccuracy: true,
          timeout: 20_000,
          maximumAge: 10_000
        }
      );
    });
  }

  private refreshStatus() {
    this.api.getLiveTrackingStatus().subscribe({
      next: (status) => {
        this.isSharing.set(status.isSharing);
        this.lastSentAt.set(status.lastUpdateAt);
        this.error.set(null);

        if (status.isSharing) {
          this.beginLocalTracking();
          this.sendCurrentLocation(true);
          this.showPrompt.set(false);
        } else {
          this.stopLocalTracking();
          if (!this.promptDismissed) {
            this.showPrompt.set(true);
          }
        }
      },
      error: (err) => {
        this.handleApiError(err, "Could not load live tracking status.");
      }
    });
  }

  private beginLocalTracking() {
    const geolocationAvailabilityError = this.getGeolocationAvailabilityError();
    if (geolocationAvailabilityError) {
      this.permissionError.set(geolocationAvailabilityError);
      return;
    }

    if (this.watchId !== null) {
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.handlePosition(position, false),
      (geoError) => this.handleGeolocationError(geoError),
      {
        enableHighAccuracy: true,
        timeout: 20_000,
        maximumAge: 10_000
      }
    );

    this.fallbackTimer = setInterval(() => this.sendCurrentLocation(false), this.fallbackSendIntervalMs);
  }

  private stopLocalTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    if (this.fallbackTimer !== null) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  private sendCurrentLocation(force: boolean) {
    if (!this.isSharing()) {
      return;
    }

    const geolocationAvailabilityError = this.getGeolocationAvailabilityError();
    if (geolocationAvailabilityError) {
      this.permissionError.set(geolocationAvailabilityError);
      return;
    }

    if (this.lastKnownPosition) {
      this.handlePosition(this.lastKnownPosition, force);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => this.handlePosition(position, force),
      (geoError) => this.handleGeolocationError(geoError),
      {
        enableHighAccuracy: true,
        timeout: 20_000,
        maximumAge: 10_000
      }
    );
  }

  private handlePosition(position: GeolocationPosition, force: boolean) {
    this.lastKnownPosition = position;
    this.lastKnownLocation.set(this.toSnapshot(position));

    const now = Date.now();
    if (!force && now - this.lastSendMs < this.minSendIntervalMs) {
      return;
    }

    const payload: LocationUpdateInput = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: Math.max(0, position.coords.accuracy ?? 0),
      timestamp: new Date(position.timestamp).toISOString(),
      source: "BROWSER_GEOLOCATION"
    };

    this.api.sendLiveTrackingUpdate(payload).subscribe({
      next: (response) => {
        this.lastSendMs = now;
        this.lastSentAt.set(response.receivedAt);
        this.permissionError.set(null);
        this.error.set(null);
      },
      error: (err) => {
        this.handleApiError(err, "Could not send location update.");
      }
    });
  }

  private handleGeolocationError(error: GeolocationPositionError) {
    this.permissionError.set(this.mapGeolocationError(error));
  }

  private mapGeolocationError(error: GeolocationPositionError) {
    if (error.code === error.PERMISSION_DENIED) {
      return "Location permission denied. Please allow GPS access.";
    }

    if (error.code === error.POSITION_UNAVAILABLE) {
      return "GPS unavailable. Check if location services are enabled.";
    }

    return "GPS timed out. Retrying automatically...";
  }

  private getGeolocationAvailabilityError() {
    if (!("geolocation" in navigator)) {
      return "GPS unavailable on this device/browser.";
    }

    if (!this.isSecureLocationContext()) {
      return "Location permission requires HTTPS. Open the app over HTTPS (or localhost) to share GPS.";
    }

    return null;
  }

  private isSecureLocationContext() {
    if (typeof window === "undefined") {
      return true;
    }

    if (window.isSecureContext) {
      return true;
    }

    const host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  }

  private handleApiError(err: unknown, fallbackMessage: string) {
    const httpError = err as HttpErrorResponse | undefined;
    const message = String(httpError?.error?.message ?? "").trim();
    const status = httpError?.status ?? 0;

    if (status === 401) {
      this.error.set(message || "Unauthorized. Please sign in again.");
      this.isSharing.set(false);
      this.showPrompt.set(false);
      this.stopLocalTracking();
      return;
    }

    if (status === 403) {
      this.error.set(message || "Live tracking is not allowed for this account.");
      this.isSharing.set(false);
      this.showPrompt.set(false);
      this.stopLocalTracking();
      return;
    }

    this.error.set(message || fallbackMessage);
  }

  private toSnapshot(position: GeolocationPosition): LocationSnapshot {
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyM: Math.max(0, position.coords.accuracy ?? 0),
      recordedAt: new Date(position.timestamp).toISOString()
    };
  }

  private resetAllState() {
    this.stopLocalTracking();
    this.activeUserId = null;
    this.promptDismissed = false;
    this.lastKnownPosition = null;
    this.lastKnownLocation.set(null);
    this.isEligible.set(false);
    this.loading.set(false);
    this.isSharing.set(false);
    this.lastSentAt.set(null);
    this.permissionError.set(null);
    this.error.set(null);
    this.message.set(null);
    this.showPrompt.set(false);
  }
}
