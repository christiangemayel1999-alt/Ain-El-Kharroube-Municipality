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

export type LiveCameraIceDebugSummary = {
  backendIceConfigLoaded: boolean;
  iceConfigSource: "env" | "fallback";
  configuredIceServersCount: number;
  stunUrls: string[];
  turnUrls: string[];
  turnPresent: boolean;
  turnCredentialsPresent: boolean;
  iceTransportPolicy: "all" | "relay";
  fallbackStunOnlyMode: boolean;
  warnings: string[];
};

type IceRuntimeState = {
  config: LiveCameraIceConfig;
  debug: LiveCameraIceDebugSummary;
};

const FALLBACK_ICE_SERVERS: LiveCameraIceServerConfig[] = [
  {
    urls: ["stun:stun.l.google.com:19302"]
  }
];

function asTrimmedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asUrlsList(urls: string | string[]) {
  const values = Array.isArray(urls) ? urls : [urls];
  return values.map((value) => asTrimmedText(value)).filter((value) => value.length > 0);
}

function getUrlScheme(value: string) {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  return match ? match[1].toLowerCase() : "";
}

function isTurnUrl(value: string) {
  const scheme = getUrlScheme(value);
  return scheme === "turn" || scheme === "turns";
}

function isStunUrl(value: string) {
  const scheme = getUrlScheme(value);
  return scheme === "stun" || scheme === "stuns";
}

function redactUrl(value: string) {
  // TURN URLs can include inline auth (turn:user:pass@host). Never expose raw auth segments.
  return value.replace(/^((?:turn|turns):)[^@/\s]+@/i, "$1***@");
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

function parseIceServersFromEnv(warnings: string[]) {
  const raw = asTrimmedText(env.LIVE_CAMERA_ICE_SERVERS_JSON);
  if (!raw) {
    warnings.push("LIVE_CAMERA_ICE_SERVERS_JSON is not set; backend is using fallback STUN-only mode.");
    return {
      iceServers: FALLBACK_ICE_SERVERS,
      source: "fallback" as const
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      warnings.push(
        "LIVE_CAMERA_ICE_SERVERS_JSON is not a JSON array; backend is using fallback STUN-only mode."
      );
      return {
        iceServers: FALLBACK_ICE_SERVERS,
        source: "fallback" as const
      };
    }

    const normalized: LiveCameraIceServerConfig[] = [];
    parsed.forEach((item, index) => {
      const row = normalizeIceServer(item);
      if (row) {
        normalized.push(row);
        return;
      }
      warnings.push(`LIVE_CAMERA_ICE_SERVERS_JSON entry at index ${index} is invalid and was ignored.`);
    });

    if (!normalized.length) {
      warnings.push(
        "LIVE_CAMERA_ICE_SERVERS_JSON had no valid entries after normalization; backend is using fallback STUN-only mode."
      );
      return {
        iceServers: FALLBACK_ICE_SERVERS,
        source: "fallback" as const
      };
    }

    return {
      iceServers: normalized,
      source: "env" as const
    };
  } catch {
    warnings.push("LIVE_CAMERA_ICE_SERVERS_JSON failed JSON parsing; backend is using fallback STUN-only mode.");
    return {
      iceServers: FALLBACK_ICE_SERVERS,
      source: "fallback" as const
    };
  }
}

function parseIceTransportPolicy(warnings: string[]): "all" | "relay" {
  const value = asTrimmedText(env.LIVE_CAMERA_ICE_TRANSPORT_POLICY).toLowerCase();
  if (!value) {
    return "all";
  }
  if (value === "all" || value === "relay") {
    return value;
  }
  warnings.push(
    `LIVE_CAMERA_ICE_TRANSPORT_POLICY is invalid (${value}); defaulting to "all". Expected: "all" or "relay".`
  );
  return "all";
}

function buildIceDebugSummary(
  iceServers: LiveCameraIceServerConfig[],
  source: "env" | "fallback",
  iceTransportPolicy: "all" | "relay",
  warnings: string[]
): LiveCameraIceDebugSummary {
  const stunUrls = new Set<string>();
  const turnUrls = new Set<string>();
  let turnCredentialsPresent = false;

  for (const server of iceServers) {
    const urls = asUrlsList(server.urls);
    const hasTurn = urls.some((url) => isTurnUrl(url));
    const hasCredentials = Boolean(asTrimmedText(server.username) && asTrimmedText(server.credential));
    if (hasTurn && hasCredentials) {
      turnCredentialsPresent = true;
    }

    for (const url of urls) {
      if (isStunUrl(url)) {
        stunUrls.add(url);
      } else if (isTurnUrl(url)) {
        turnUrls.add(redactUrl(url));
      }
    }
  }

  const turnPresent = turnUrls.size > 0;
  if (!turnPresent) {
    warnings.push("No TURN URLs are configured in ICE servers; cross-network streaming may fail.");
  } else if (!turnCredentialsPresent) {
    warnings.push("TURN URLs are configured but TURN credentials are missing on all TURN servers.");
  }

  const fallbackStunOnlyMode = source === "fallback";
  return {
    backendIceConfigLoaded: source === "env",
    iceConfigSource: source,
    configuredIceServersCount: iceServers.length,
    stunUrls: [...stunUrls],
    turnUrls: [...turnUrls],
    turnPresent,
    turnCredentialsPresent,
    iceTransportPolicy,
    fallbackStunOnlyMode,
    warnings: [...new Set(warnings)]
  };
}

function buildIceRuntimeState(): IceRuntimeState {
  const warnings: string[] = [];
  const parsedServers = parseIceServersFromEnv(warnings);
  const iceTransportPolicy = parseIceTransportPolicy(warnings);
  const debug = buildIceDebugSummary(parsedServers.iceServers, parsedServers.source, iceTransportPolicy, warnings);

  return {
    config: {
      iceServers: parsedServers.iceServers,
      iceTransportPolicy
    },
    debug
  };
}

function logIceStartupDiagnostics(debug: LiveCameraIceDebugSummary) {
  for (const warning of debug.warnings) {
    console.warn(`[live-camera][ice] ${warning}`);
  }

  if (debug.fallbackStunOnlyMode) {
    console.warn("[live-camera][ice] Live Camera ICE: fallback STUN-only mode");
    return;
  }

  console.info(
    `[live-camera][ice] Live Camera ICE: ${debug.configuredIceServersCount} servers loaded, TURN present: ${debug.turnPresent ? "yes" : "no"}, policy: ${debug.iceTransportPolicy}`
  );
}

const runtimeState = buildIceRuntimeState();
logIceStartupDiagnostics(runtimeState.debug);

export function getLiveCameraIceConfig(): LiveCameraIceConfig {
  return runtimeState.config;
}

export function getLiveCameraIceDebugSummary(): LiveCameraIceDebugSummary {
  return runtimeState.debug;
}
