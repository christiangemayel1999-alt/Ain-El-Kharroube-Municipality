import { HttpErrorResponse } from "@angular/common/http";
import { Injectable, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { TrackingPingRequest, User } from "../models";
import { ApiService } from "./api.service";
import { LiveTrackingService } from "./live-tracking.service";

type GeolocationFailureReason = "PERMISSION_DENIED" | "UNAVAILABLE" | "TIMEOUT" | "UNKNOWN";

@Injectable({ providedIn: "root" })
export class TrackingPingService {
  readonly pendingPings = signal<TrackingPingRequest[]>([]);
  readonly activePing = signal<TrackingPingRequest | null>(null);
  readonly loading = signal(false);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly pushSupported = signal(false);
  readonly pushEnabled = signal(false);
  readonly pushPermission = signal<NotificationPermission>("default");

  private activeUserId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly dismissedPingIds = new Set<string>();
  private readonly autoAttemptedPingIds = new Set<string>();
  private visibilityHandlerInstalled = false;
  private readonly visibilityHandler = () => {
    if (!document.hidden) {
      void this.loadPendingPings(true);
    }
  };

  constructor(
    private readonly api: ApiService,
    private readonly liveTracking: LiveTrackingService
  ) {}

  syncAuthenticatedUser(user: User | null) {
    if (!user) {
      this.prepareForLogout();
      return;
    }

    const userChanged = this.activeUserId !== user.id;
    this.activeUserId = user.id;

    if (!userChanged) {
      return;
    }

    this.clearStateForUserSwitch();
    this.startPolling();
    this.installVisibilityHandler();
    void this.ensurePushSubscription(false);
  }

  prepareForLogout() {
    this.stopPolling();
    this.removeVisibilityHandler();
    this.clearStateForUserSwitch();
    this.activeUserId = null;
  }

  dismissPing(pingId: string) {
    this.dismissedPingIds.add(pingId);
    const nextActive = this.selectActivePing(this.pendingPings());
    this.activePing.set(nextActive);
  }

  async markOpened(pingId: string) {
    try {
      await firstValueFrom(this.api.openTrackingPing(pingId));
      this.error.set(null);
    } catch (error) {
      const message = this.extractHttpMessage(error);
      if (message) {
        this.error.set(message);
      }
    }
  }

  async respondNow(pingId: string) {
    if (this.sending()) {
      return false;
    }

    const ping = this.pendingPings().find((entry) => entry.id === pingId) ?? this.activePing();
    if (!ping) {
      this.error.set("No active ping request to respond to.");
      return false;
    }

    this.sending.set(true);
    this.error.set(null);
    this.message.set(null);
    await this.markOpened(pingId);

    try {
      const snapshot = await this.liveTracking.captureCurrentLocation(true);
      await firstValueFrom(
        this.api.respondToTrackingPing(pingId, {
          latitude: snapshot.latitude,
          longitude: snapshot.longitude,
          accuracy: Math.max(0, snapshot.accuracyM),
          timestamp: snapshot.recordedAt
        })
      );

      this.message.set("Location sent successfully.");
      this.dismissedPingIds.delete(pingId);
      await this.loadPendingPings(false);
      return true;
    } catch (error) {
      const message = this.extractHttpMessage(error) ?? String((error as Error)?.message ?? "Could not send location.");
      const failureReason = this.mapGeoFailureReason(message);

      try {
        await firstValueFrom(
          this.api.respondToTrackingPing(pingId, {
            failureReason,
            errorMessage: message
          })
        );
      } catch {
        // Best-effort failure logging.
      }

      this.error.set(message);
      await this.loadPendingPings(false);
      return false;
    } finally {
      this.sending.set(false);
    }
  }

  async enablePushNotifications() {
    await this.ensurePushSubscription(true);
  }

  async loadPendingPings(allowAutoRespond: boolean) {
    if (!this.activeUserId) {
      return;
    }

    this.loading.set(true);
    try {
      const rows = await firstValueFrom(this.api.getPendingMyTrackingPings());
      this.pendingPings.set(rows);
      const nextActive = this.selectActivePing(rows);
      this.activePing.set(nextActive);
      this.error.set(null);

      if (nextActive && nextActive.status === "PENDING") {
        void this.markOpened(nextActive.id);
      }

      if (allowAutoRespond) {
        await this.maybeAutoRespond(nextActive);
      }
    } catch (error) {
      const message = this.extractHttpMessage(error) ?? "Could not load pending location pings.";
      this.error.set(message);
      this.pendingPings.set([]);
      this.activePing.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  private startPolling() {
    this.stopPolling();
    void this.loadPendingPings(true);
    this.pollTimer = setInterval(() => {
      void this.loadPendingPings(true);
    }, 6000);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private installVisibilityHandler() {
    if (this.visibilityHandlerInstalled || typeof document === "undefined") {
      return;
    }
    document.addEventListener("visibilitychange", this.visibilityHandler);
    window.addEventListener("focus", this.visibilityHandler);
    this.visibilityHandlerInstalled = true;
  }

  private removeVisibilityHandler() {
    if (!this.visibilityHandlerInstalled || typeof document === "undefined") {
      return;
    }
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    window.removeEventListener("focus", this.visibilityHandler);
    this.visibilityHandlerInstalled = false;
  }

  private async maybeAutoRespond(nextActive: TrackingPingRequest | null) {
    if (!nextActive) {
      return;
    }

    if (this.autoAttemptedPingIds.has(nextActive.id)) {
      return;
    }

    if (typeof document !== "undefined" && document.hidden) {
      return;
    }

    try {
      if (!("permissions" in navigator) || !navigator.permissions?.query) {
        return;
      }
      const permissionStatus = await navigator.permissions.query({ name: "geolocation" as PermissionName });
      if (permissionStatus.state !== "granted") {
        return;
      }
    } catch {
      return;
    }

    this.autoAttemptedPingIds.add(nextActive.id);
    await this.respondNow(nextActive.id);
  }

  private selectActivePing(rows: TrackingPingRequest[]) {
    for (const row of rows) {
      if (this.dismissedPingIds.has(row.id)) {
        continue;
      }
      return row;
    }
    return null;
  }

  private clearStateForUserSwitch() {
    this.pendingPings.set([]);
    this.activePing.set(null);
    this.loading.set(false);
    this.sending.set(false);
    this.error.set(null);
    this.message.set(null);
    this.dismissedPingIds.clear();
    this.autoAttemptedPingIds.clear();
    this.pushSupported.set(false);
    this.pushEnabled.set(false);
    this.pushPermission.set("default");
  }

  private async ensurePushSubscription(forcePrompt: boolean) {
    const pushSupported = this.canUsePushApi();
    this.pushSupported.set(pushSupported);
    this.pushPermission.set(typeof Notification !== "undefined" ? Notification.permission : "default");

    if (!pushSupported) {
      return;
    }

    try {
      const pushConfig = await firstValueFrom(this.api.getPushPublicKey());
      if (!pushConfig.enabled || !pushConfig.publicKey) {
        this.pushEnabled.set(false);
        return;
      }

      const serviceWorkerRegistration = await navigator.serviceWorker.register("/tracking-push-sw.js");
      let permission: NotificationPermission = Notification.permission;

      if (permission === "default" && forcePrompt) {
        permission = await Notification.requestPermission();
      }

      this.pushPermission.set(permission);
      if (permission !== "granted") {
        this.pushEnabled.set(false);
        return;
      }

      let subscription = await serviceWorkerRegistration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await serviceWorkerRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: this.base64ToUint8Array(pushConfig.publicKey)
        });
      }

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.["p256dh"] || !json.keys["auth"]) {
        this.pushEnabled.set(false);
        return;
      }

      await firstValueFrom(
        this.api.registerPushSubscription({
          endpoint: json.endpoint,
          keys: {
            p256dh: json.keys["p256dh"],
            auth: json.keys["auth"]
          },
          expirationTime: json.expirationTime ?? null
        })
      );

      this.pushEnabled.set(true);
    } catch (error) {
      this.pushEnabled.set(false);
      const message = this.extractHttpMessage(error);
      if (forcePrompt && message) {
        this.error.set(message);
      }
    }
  }

  private canUsePushApi() {
    return (
      typeof window !== "undefined" &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window
    );
  }

  private extractHttpMessage(error: unknown) {
    const httpError = error as HttpErrorResponse | undefined;
    const raw = String(httpError?.error?.message ?? httpError?.message ?? "").trim();
    return raw.length ? raw : null;
  }

  private mapGeoFailureReason(message: string): GeolocationFailureReason {
    const normalized = message.toLowerCase();
    if (normalized.includes("denied")) {
      return "PERMISSION_DENIED";
    }
    if (normalized.includes("unavailable")) {
      return "UNAVAILABLE";
    }
    if (normalized.includes("timed out") || normalized.includes("timeout")) {
      return "TIMEOUT";
    }
    return "UNKNOWN";
  }

  private base64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const normalized = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(normalized);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}
