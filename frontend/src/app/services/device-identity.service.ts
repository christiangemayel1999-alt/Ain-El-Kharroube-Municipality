import { Injectable } from "@angular/core";

export type LoginDevicePayload = {
  id: string;
  label: string | null;
  platform: string | null;
  language: string | null;
  timezone: string | null;
  screen: string | null;
};

@Injectable({ providedIn: "root" })
export class DeviceIdentityService {
  private readonly storageKey = "mvp_trusted_device_id_v1";
  private cachedDeviceId: string | null = null;

  getLoginDevicePayload(): LoginDevicePayload {
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const platform = this.readPlatform();
    const language = typeof navigator !== "undefined" ? navigator.language : null;
    const timezone = this.readTimezone();
    const screen = this.readScreenDescriptor();

    return {
      id: this.getOrCreateDeviceId(),
      label: this.buildDeviceLabel(platform, userAgent),
      platform,
      language,
      timezone,
      screen
    };
  }

  private getOrCreateDeviceId() {
    if (this.cachedDeviceId) {
      return this.cachedDeviceId;
    }

    const existing = this.readStorage(this.storageKey);
    if (existing && existing.length >= 16) {
      this.cachedDeviceId = existing;
      return existing;
    }

    const created = this.generateDeviceId();
    this.cachedDeviceId = created;
    this.writeStorage(this.storageKey, created);
    return created;
  }

  private readPlatform() {
    if (typeof navigator === "undefined") {
      return null;
    }

    const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    const platform = userAgentData?.platform ?? navigator.platform ?? "";
    const trimmed = platform.trim();
    return trimmed.length ? trimmed.slice(0, 120) : null;
  }

  private readTimezone() {
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const trimmed = String(zone ?? "").trim();
      return trimmed.length ? trimmed.slice(0, 120) : null;
    } catch {
      return null;
    }
  }

  private readScreenDescriptor() {
    if (typeof window === "undefined") {
      return null;
    }

    const { width, height, colorDepth } = window.screen;
    if (!width || !height) {
      return null;
    }

    return `${width}x${height}@${colorDepth}`;
  }

  private buildDeviceLabel(platform: string | null, userAgent: string) {
    const browser = this.detectBrowser(userAgent);
    if (platform && browser) {
      return `${platform} - ${browser}`;
    }
    if (platform) {
      return platform;
    }
    if (browser) {
      return browser;
    }
    return "Browser device";
  }

  private detectBrowser(userAgent: string) {
    const ua = userAgent.toLowerCase();
    if (!ua) {
      return null;
    }
    if (ua.includes("edg/")) {
      return "Edge";
    }
    if (ua.includes("chrome/") && !ua.includes("edg/")) {
      return "Chrome";
    }
    if (ua.includes("safari/") && !ua.includes("chrome/")) {
      return "Safari";
    }
    if (ua.includes("firefox/")) {
      return "Firefox";
    }
    return "Browser";
  }

  private generateDeviceId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    const randomPart = Math.random().toString(36).slice(2);
    return `legacy-${Date.now()}-${randomPart}`;
  }

  private readStorage(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeStorage(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore storage write failures (private browsing / blocked storage).
    }
  }
}
