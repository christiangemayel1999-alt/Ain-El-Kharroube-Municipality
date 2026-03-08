import crypto from "crypto";
import { LocationSessionSource, LocationUpdateSource, Prisma, Role, TrackingPingStatus } from "@prisma/client";
import rateLimit from "express-rate-limit";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { authenticateBearerToken, extractBearerToken } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import { validateBody, validateQuery } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { writeTrackingEvent } from "../services/trackingAudit";
import { expireDueTrackingPings } from "../services/trackingPing";
import { asyncHandler } from "../utils/asyncHandler";

const LOCATION_VIEW_ROLES = [Role.ADMIN, Role.CASE_WORKER, Role.POLICE] as const;
const DEFAULT_HISTORY_WINDOW_HOURS = 24;
const MAX_HISTORY_LIMIT = 300;
const DEFAULT_STALE_AFTER_SECONDS = 120;

class LocationAuthError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type LocationActor = {
  userId: string;
  role: Role;
  mode: "AUTH" | "TOKEN";
  tokenId: string | null;
  trustedDeviceId: string | null;
  sessionSource: LocationSessionSource;
};

const sessionPayloadSchema = z.object({
  token: z.string().trim().min(24).max(512).optional()
});

const locationUpdateSchema = z.object({
  token: z.string().trim().min(24).max(512).optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).max(5000),
  timestamp: z.union([z.string().trim().min(1), z.coerce.number()]).optional().nullable(),
  source: z.nativeEnum(LocationUpdateSource).optional(),
  batteryLevel: z.coerce.number().min(0).max(100).optional().nullable()
});

const shareStatusQuerySchema = z.object({
  token: z.string().trim().min(24).max(512).optional()
});

const latestLocationsQuerySchema = z.object({
  activeOnly: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  staleAfterSeconds: z.coerce.number().int().min(30).max(900).default(DEFAULT_STALE_AFTER_SECONDS)
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_HISTORY_LIMIT).default(100),
  since: z.string().trim().optional(),
  until: z.string().trim().optional()
});

const createShareLinkSchema = z.object({
  userId: z.string().uuid(),
  label: z.string().trim().max(120).optional().nullable(),
  expiresInHours: z.coerce.number().int().min(1).max(24 * 14).default(24)
});

const includeRevokedQuerySchema = z.object({
  includeRevoked: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

function hashShareToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function securityLog(event: string, metadata: Record<string, unknown>) {
  console.warn(`[location-security] ${event}`, metadata);
}

function normalizeTokenCandidate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length >= 24 ? trimmed : null;
}

function extractShareToken(req: Request) {
  return (
    normalizeTokenCandidate(req.headers["x-location-token"]) ??
    normalizeTokenCandidate(req.query.token) ??
    normalizeTokenCandidate((req.body as { token?: unknown } | undefined)?.token)
  );
}

function parseClientTimestamp(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") {
    return new Date();
  }

  const value = typeof raw === "number" ? new Date(raw) : new Date(String(raw));
  if (Number.isNaN(value.getTime())) {
    return null;
  }

  const now = Date.now();
  const maxFutureMs = 5 * 60 * 1000;
  const maxPastMs = 7 * 24 * 60 * 60 * 1000;
  const ageMs = now - value.getTime();

  if (ageMs < -maxFutureMs || ageMs > maxPastMs) {
    return null;
  }

  return value;
}

function normalizeOptionalText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

function parseIsoDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function shareBaseUrl() {
  const firstConfiguredOrigin = [env.FRONTEND_ORIGIN, env.CLIENT_ORIGIN]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .find((value) => value.length > 0);

  return (firstConfiguredOrigin ?? "http://localhost:4200").replace(/\/+$/, "");
}

async function resolveLocationActor(req: Request): Promise<LocationActor> {
  const now = new Date();
  const enforceAuthenticatedMode = req.baseUrl.startsWith("/live-tracking");

  if (enforceAuthenticatedMode) {
    if (!req.user) {
      throw new LocationAuthError(401, "Unauthorized");
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        role: true,
        isActive: true,
        liveLocationEnabled: true,
        trustedDevice: {
          select: {
            id: true,
            isActive: true
          }
        }
      }
    });

    if (!dbUser || !dbUser.isActive) {
      throw new LocationAuthError(401, "Unauthorized");
    }

    if (!dbUser.liveLocationEnabled) {
      throw new LocationAuthError(403, "Location sharing is not enabled for this user.");
    }

    return {
      userId: dbUser.id,
      role: dbUser.role,
      mode: "AUTH",
      tokenId: null,
      trustedDeviceId: dbUser.trustedDevice?.isActive ? dbUser.trustedDevice.id : null,
      sessionSource: LocationSessionSource.AUTHENTICATED_USER
    };
  }

  const shareToken = extractShareToken(req);

  // If a valid share token is provided, bind the request to the token owner.
  if (shareToken) {
    const tokenHash = hashShareToken(shareToken);
    const shareRecord = await prisma.locationShareToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            role: true,
            isActive: true,
            liveLocationEnabled: true
          }
        }
      }
    });

    if (!shareRecord || shareRecord.revokedAt || shareRecord.expiresAt <= now) {
      securityLog("token_rejected", {
        reason: !shareRecord ? "not_found" : shareRecord.revokedAt ? "revoked" : "expired",
        ip: req.ip
      });
      throw new LocationAuthError(401, "Invalid or expired location sharing token.");
    }

    if (!shareRecord.user.isActive) {
      throw new LocationAuthError(401, "User account is disabled.");
    }

    if (!shareRecord.user.liveLocationEnabled) {
      throw new LocationAuthError(403, "Location sharing is not enabled for this user.");
    }

    return {
      userId: shareRecord.user.id,
      role: shareRecord.user.role,
      mode: "TOKEN",
      tokenId: shareRecord.id,
      trustedDeviceId: null,
      sessionSource: LocationSessionSource.SHARE_TOKEN
    };
  }

  const bearerToken = extractBearerToken(req.headers.authorization);
  if (!bearerToken) {
    throw new LocationAuthError(401, "Unauthorized");
  }

  const authUser = await authenticateBearerToken(bearerToken);
  if (!authUser) {
    securityLog("bearer_rejected", { reason: "invalid", ip: req.ip });
    throw new LocationAuthError(401, "Unauthorized");
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: {
      id: true,
      role: true,
      isActive: true,
      liveLocationEnabled: true,
      trustedDevice: {
        select: {
          id: true,
          isActive: true
        }
      }
    }
  });

  if (!dbUser || !dbUser.isActive) {
    throw new LocationAuthError(401, "Unauthorized");
  }

  if (!dbUser.liveLocationEnabled) {
    throw new LocationAuthError(403, "Location sharing is not enabled for this user.");
  }

  return {
    userId: dbUser.id,
    role: dbUser.role,
    mode: "AUTH",
    tokenId: null,
    trustedDeviceId: dbUser.trustedDevice?.isActive ? dbUser.trustedDevice.id : null,
    sessionSource: LocationSessionSource.AUTHENTICATED_USER
  };
}

async function getActorOrRespond(req: Request, res: Response) {
  try {
    return await resolveLocationActor(req);
  } catch (error) {
    if (error instanceof LocationAuthError) {
      res.status(error.status).json({ message: error.message });
      return null;
    }
    throw error;
  }
}

async function ensureActiveSession(actor: LocationActor) {
  const current = await prisma.locationSharingSession.findFirst({
    where: {
      userId: actor.userId,
      isActive: true
    },
    orderBy: { startedAt: "desc" }
  });

  if (current) {
    if (actor.trustedDeviceId && current.trustedDeviceId !== actor.trustedDeviceId) {
      return prisma.locationSharingSession.update({
        where: { id: current.id },
        data: {
          trustedDeviceId: actor.trustedDeviceId
        }
      });
    }
    return current;
  }

  return prisma.locationSharingSession.create({
    data: {
      userId: actor.userId,
      source: actor.sessionSource,
      tokenId: actor.tokenId,
      trustedDeviceId: actor.trustedDeviceId
    }
  });
}

async function touchShareToken(tokenId: string | null, at: Date) {
  if (!tokenId) {
    return;
  }

  await prisma.locationShareToken.updateMany({
    where: { id: tokenId },
    data: { lastUsedAt: at }
  });
}

const locationUpdateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Keep token/auth users isolated so one noisy device cannot throttle everyone.
    const token = extractShareToken(req);
    if (token) {
      return `location-token:${hashShareToken(token)}`;
    }
    const bearer = extractBearerToken(req.headers.authorization);
    if (bearer) {
      return `location-auth:${hashShareToken(bearer)}`;
    }
    return `location-ip:${req.ip}`;
  },
  handler: (_req, res) => {
    res.status(429).json({ message: "Too many location updates. Please retry shortly." });
  }
});

export const locationRouter = Router();
export const locationsRouter = Router();

locationRouter.post(
  "/start",
  validateBody(sessionPayloadSchema),
  asyncHandler(async (req, res) => {
    const actor = await getActorOrRespond(req, res);
    if (!actor) {
      return;
    }

    const session = await ensureActiveSession(actor);
    const now = new Date();

    await prisma.liveLocationState.upsert({
      where: { userId: actor.userId },
      create: {
        userId: actor.userId,
        isSharing: true
      },
      update: {
        isSharing: true
      }
    });

    await touchShareToken(actor.tokenId, now);
    await writeTrackingEvent({
      userId: actor.userId,
      actorUserId: actor.mode === "AUTH" ? actor.userId : null,
      eventType: "LIVE_TRACKING_STARTED",
      eventSummary: "Live tracking started.",
      relatedSessionId: session.id,
      metadata: {
        mode: actor.mode,
        source: actor.sessionSource
      }
    });

    return res.json({
      isSharing: true,
      sessionId: session.id,
      startedAt: session.startedAt
    });
  })
);

locationRouter.post(
  "/update",
  locationUpdateLimiter,
  validateBody(locationUpdateSchema),
  asyncHandler(async (req, res) => {
    const actor = await getActorOrRespond(req, res);
    if (!actor) {
      return;
    }

    const payload = req.body as z.infer<typeof locationUpdateSchema>;
    const recordedAt = parseClientTimestamp(payload.timestamp);
    if (!recordedAt) {
      return res.status(400).json({
        message: "Invalid timestamp. Use an ISO string or unix milliseconds within a reasonable range."
      });
    }

    const now = new Date();
    const source =
      payload.source ??
      (actor.mode === "TOKEN" ? LocationUpdateSource.SHARE_LINK : LocationUpdateSource.BROWSER_GEOLOCATION);
    const session = await ensureActiveSession(actor);

    // Persist immutable history first, then refresh the denormalized "latest location" row.
    const createdPoint = await prisma.locationPoint.create({
      data: {
        userId: actor.userId,
        sessionId: session.id,
        tokenId: actor.tokenId,
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracyM: payload.accuracy,
        recordedAt,
        source,
        batteryLevel: payload.batteryLevel ?? null,
        isSharingSnapshot: true
      }
    });

    await prisma.liveLocationState.upsert({
      where: { userId: actor.userId },
      create: {
        userId: actor.userId,
        isSharing: true,
        lastLatitude: payload.latitude,
        lastLongitude: payload.longitude,
        lastAccuracyM: payload.accuracy,
        lastRecordedAt: recordedAt,
        lastReceivedAt: now,
        lastSource: source,
        lastBatteryLevel: payload.batteryLevel ?? null,
        lastPointId: createdPoint.id
      },
      update: {
        isSharing: true,
        lastLatitude: payload.latitude,
        lastLongitude: payload.longitude,
        lastAccuracyM: payload.accuracy,
        lastRecordedAt: recordedAt,
        lastReceivedAt: now,
        lastSource: source,
        lastBatteryLevel: payload.batteryLevel ?? null,
        lastPointId: createdPoint.id
      }
    });

    await touchShareToken(actor.tokenId, now);
    await writeTrackingEvent({
      userId: actor.userId,
      actorUserId: actor.mode === "AUTH" ? actor.userId : null,
      eventType: "LIVE_TRACKING_UPDATE_RECEIVED",
      eventSummary: "Live tracking location update received.",
      relatedSessionId: session.id,
      metadata: {
        mode: actor.mode,
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracyM: payload.accuracy,
        source,
        receivedAt: now.toISOString()
      }
    });

    return res.json({
      accepted: true,
      receivedAt: now,
      recordedAt
    });
  })
);

locationRouter.post(
  "/stop",
  validateBody(sessionPayloadSchema),
  asyncHandler(async (req, res) => {
    const actor = await getActorOrRespond(req, res);
    if (!actor) {
      return;
    }

    const now = new Date();
    const activeSessions = await prisma.locationSharingSession.findMany({
      where: {
        userId: actor.userId,
        isActive: true
      },
      select: {
        id: true
      }
    });

    await prisma.locationSharingSession.updateMany({
      where: {
        userId: actor.userId,
        isActive: true
      },
      data: {
        isActive: false,
        stoppedAt: now,
        stoppedReason: "USER_STOPPED"
      }
    });

    await prisma.liveLocationState.upsert({
      where: { userId: actor.userId },
      create: {
        userId: actor.userId,
        isSharing: false
      },
      update: {
        isSharing: false
      }
    });

    await touchShareToken(actor.tokenId, now);
    for (const session of activeSessions) {
      await writeTrackingEvent({
        userId: actor.userId,
        actorUserId: actor.mode === "AUTH" ? actor.userId : null,
        eventType: "LIVE_TRACKING_STOPPED",
        eventSummary: "Live tracking stopped.",
        relatedSessionId: session.id,
        metadata: {
          mode: actor.mode,
          stoppedReason: "USER_STOPPED",
          stoppedAt: now.toISOString()
        }
      });
    }

    return res.json({
      isSharing: false,
      stoppedAt: now
    });
  })
);

locationRouter.get(
  "/status",
  validateQuery(shareStatusQuerySchema),
  asyncHandler(async (req, res) => {
    const actor = await getActorOrRespond(req, res);
    if (!actor) {
      return;
    }

    const state = await prisma.liveLocationState.findUnique({
      where: { userId: actor.userId }
    });

    const user = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: {
        id: true,
        fullName: true,
        role: true
      }
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await touchShareToken(actor.tokenId, new Date());

    return res.json({
      user,
      isSharing: state?.isSharing ?? false,
      lastUpdateAt: state?.lastReceivedAt ?? null,
      lastRecordedAt: state?.lastRecordedAt ?? null
    });
  })
);

locationsRouter.get(
  "/latest",
  requireRoles(...LOCATION_VIEW_ROLES),
  validateQuery(latestLocationsQuerySchema),
  asyncHandler(async (req, res) => {
    await expireDueTrackingPings(120);

    const query = req.query as z.infer<typeof latestLocationsQuerySchema>;
    const staleThreshold = Date.now() - query.staleAfterSeconds * 1000;

    const locations = await prisma.liveLocationState.findMany({
      where: {
        user: {
          isActive: true,
          liveLocationEnabled: true,
          liveLocationVisible: true
        },
        lastLatitude: { not: null },
        lastLongitude: { not: null },
        isSharing: query.activeOnly ? true : undefined
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            role: true
          }
        }
      },
      orderBy: [{ isSharing: "desc" }, { lastReceivedAt: "desc" }]
    });

    const userIds = locations.map((entry) => entry.user.id);
    type LatestPingRow = {
      id: string;
      targetUserId: string;
      status: TrackingPingStatus;
      createdAt: Date;
      respondedAt: Date | null;
    };

    const latestPings = userIds.length
      ? await prisma.$queryRaw<LatestPingRow[]>(Prisma.sql`
        SELECT DISTINCT ON ("targetUserId")
          "id", "targetUserId", "status", "createdAt", "respondedAt"
        FROM "LocationPingRequest"
        WHERE "targetUserId" IN (${Prisma.join(userIds)})
        ORDER BY "targetUserId", "createdAt" DESC
      `)
      : [];

    const latestPingByUserId = new Map(latestPings.map((entry) => [entry.targetUserId, entry]));
    const now = Date.now();

    return res.json(
      locations.map((entry) => {
        const latestPing = latestPingByUserId.get(entry.user.id);
        const freshnessSeconds = entry.lastReceivedAt
          ? Math.max(0, Math.round((now - entry.lastReceivedAt.getTime()) / 1000))
          : null;

        return {
          personId: entry.user.id,
          fullName: entry.user.fullName,
          role: entry.user.role,
          latitude: entry.lastLatitude,
          longitude: entry.lastLongitude,
          accuracyM: entry.lastAccuracyM,
          lastRecordedAt: entry.lastRecordedAt,
          lastReceivedAt: entry.lastReceivedAt,
          source: entry.lastSource,
          batteryLevel: entry.lastBatteryLevel,
          isTrackingActive: entry.isSharing,
          isStale: !entry.lastReceivedAt || entry.lastReceivedAt.getTime() < staleThreshold,
          freshnessSeconds,
          lastPingStatus: latestPing?.status ?? null,
          lastPingRequestedAt: latestPing?.createdAt ?? null,
          lastPingRespondedAt: latestPing?.respondedAt ?? null,
          recentlyPinged:
            Boolean(latestPing?.createdAt) &&
            now - (latestPing?.createdAt?.getTime() ?? 0) <= 5 * 60 * 1000
        };
      })
    );
  })
);

locationsRouter.get(
  "/history/:personId",
  requireRoles(...LOCATION_VIEW_ROLES),
  validateQuery(historyQuerySchema),
  asyncHandler(async (req, res) => {
    const personId = z.string().uuid().parse(req.params.personId);
    const query = req.query as z.infer<typeof historyQuerySchema>;
    const now = new Date();
    const defaultSince = new Date(now.getTime() - DEFAULT_HISTORY_WINDOW_HOURS * 60 * 60 * 1000);
    const since = query.since ? parseIsoDate(query.since) : defaultSince;
    const until = query.until ? parseIsoDate(query.until) : now;

    if (!since || !until) {
      return res.status(400).json({ message: "Invalid date range in query." });
    }

    if (since.getTime() > until.getTime()) {
      return res.status(400).json({ message: "The 'since' date must be before 'until'." });
    }

    const person = await prisma.user.findUnique({
      where: { id: personId },
      select: {
        id: true,
        fullName: true,
        role: true,
        liveLocationEnabled: true,
        liveLocationVisible: true,
        isActive: true
      }
    });

    if (!person || !person.isActive || !person.liveLocationEnabled) {
      return res.status(404).json({ message: "Tracked person not found." });
    }

    if (!person.liveLocationVisible && req.user!.role !== Role.ADMIN) {
      return res.status(403).json({ message: "You are not allowed to view this location history." });
    }

    const points = await prisma.locationPoint.findMany({
      where: {
        userId: personId,
        receivedAt: {
          gte: since,
          lte: until
        }
      },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        accuracyM: true,
        source: true,
        batteryLevel: true,
        recordedAt: true,
        receivedAt: true,
        isSharingSnapshot: true,
        sessionId: true
      },
      orderBy: { receivedAt: "desc" },
      take: query.limit
    });

    return res.json({
      person: {
        id: person.id,
        fullName: person.fullName,
        role: person.role
      },
      window: {
        since,
        until,
        limit: query.limit
      },
      points
    });
  })
);

locationsRouter.post(
  "/share-links",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(createShareLinkSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof createShareLinkSchema>;
    const targetUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        fullName: true,
        isActive: true,
        liveLocationEnabled: true
      }
    });

    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({ message: "User not found." });
    }

    if (!targetUser.liveLocationEnabled) {
      return res.status(400).json({ message: "Location sharing is disabled for this user." });
    }

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashShareToken(rawToken);
    const expiresAt = new Date(Date.now() + payload.expiresInHours * 60 * 60 * 1000);

    const created = await prisma.locationShareToken.create({
      data: {
        userId: targetUser.id,
        tokenHash,
        label: normalizeOptionalText(payload.label),
        expiresAt,
        createdByUserId: req.user!.id
      },
      select: {
        id: true,
        userId: true,
        label: true,
        expiresAt: true,
        createdAt: true
      }
    });

    await writeAudit(req.user!.id, "CREATE", "LocationShareToken", created.id);

    return res.status(201).json({
      ...created,
      token: rawToken,
      shareUrl: `${shareBaseUrl()}/share-location?token=${encodeURIComponent(rawToken)}`,
      user: {
        id: targetUser.id,
        fullName: targetUser.fullName
      }
    });
  })
);

locationsRouter.get(
  "/share-links/:personId",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateQuery(includeRevokedQuerySchema),
  asyncHandler(async (req, res) => {
    const personId = z.string().uuid().parse(req.params.personId);
    const query = req.query as z.infer<typeof includeRevokedQuerySchema>;

    const records = await prisma.locationShareToken.findMany({
      where: {
        userId: personId,
        revokedAt: query.includeRevoked ? undefined : null
      },
      select: {
        id: true,
        label: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
        createdBy: {
          select: {
            id: true,
            fullName: true
          }
        }
      },
      orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }]
    });

    return res.json(records);
  })
);

locationsRouter.post(
  "/share-links/:tokenId/revoke",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  asyncHandler(async (req, res) => {
    const tokenId = z.string().uuid().parse(req.params.tokenId);
    const now = new Date();
    const existing = await prisma.locationShareToken.findUnique({
      where: { id: tokenId },
      select: { id: true, revokedAt: true }
    });

    if (!existing) {
      return res.status(404).json({ message: "Share link not found." });
    }

    if (!existing.revokedAt) {
      await prisma.locationShareToken.update({
        where: { id: tokenId },
        data: { revokedAt: now }
      });

      await prisma.locationSharingSession.updateMany({
        where: {
          tokenId,
          isActive: true
        },
        data: {
          isActive: false,
          stoppedAt: now,
          stoppedReason: "TOKEN_REVOKED"
        }
      });

      await writeAudit(req.user!.id, "REVOKE", "LocationShareToken", tokenId);
    }

    return res.json({
      id: tokenId,
      revokedAt: existing.revokedAt ?? now
    });
  })
);
