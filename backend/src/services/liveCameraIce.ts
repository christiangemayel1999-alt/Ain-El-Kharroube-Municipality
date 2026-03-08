import { env } from "../config/env";

export type LiveCameraIceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: "password" | "oauth";
};

export type LiveCameraIceConfig = {
  iceServers: LiveCameraIceServerConfig[];
  iceTransportPolicy: "all" | "relay";
};

const FALLBACK_ICE_SERVERS: LiveCameraIceServerConfig[] = [
  {
    urls: ["stun:stun.l.google.com:19302"]
  }
];

function asTrimmedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIceServer(value: unknown): LiveCameraIceServerConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;
  const urlsRaw = row.urls;

  const urlsList = Array.isArray(urlsRaw)
    ? urlsRaw.map((item) => asTrimmedText(item)).filter((item) => item.length)
    : [asTrimmedText(urlsRaw)].filter((item) => item.length);

  if (!urlsList.length) {
    return null;
  }

  const username = asTrimmedText(row.username);
  const credential = asTrimmedText(row.credential);
  const credentialTypeRaw = asTrimmedText(row.credentialType).toLowerCase();
  const credentialType =
    credentialTypeRaw === "password" || credentialTypeRaw === "oauth"
      ? (credentialTypeRaw as "password" | "oauth")
      : undefined;

  return {
    urls: urlsList.length === 1 ? urlsList[0] : urlsList,
    username: username || undefined,
    credential: credential || undefined,
    credentialType
  };
}

function parseIceServersFromEnv() {
  const raw = asTrimmedText(env.LIVE_CAMERA_ICE_SERVERS_JSON);
  if (!raw) {
    return FALLBACK_ICE_SERVERS;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn("[live-camera] LIVE_CAMERA_ICE_SERVERS_JSON must be a JSON array. Falling back to default STUN.");
      return FALLBACK_ICE_SERVERS;
    }

    const normalized = parsed
      .map((item) => normalizeIceServer(item))
      .filter((item): item is LiveCameraIceServerConfig => Boolean(item));

    if (!normalized.length) {
      console.warn(
        "[live-camera] LIVE_CAMERA_ICE_SERVERS_JSON did not include valid iceServers entries. Falling back to default STUN."
      );
      return FALLBACK_ICE_SERVERS;
    }

    return normalized;
  } catch {
    console.warn("[live-camera] LIVE_CAMERA_ICE_SERVERS_JSON is invalid JSON. Falling back to default STUN.");
    return FALLBACK_ICE_SERVERS;
  }
}

const iceServers = parseIceServersFromEnv();
const iceTransportPolicy = env.LIVE_CAMERA_ICE_TRANSPORT_POLICY ?? "all";

export function getLiveCameraIceConfig(): LiveCameraIceConfig {
  return {
    iceServers,
    iceTransportPolicy
  };
}

