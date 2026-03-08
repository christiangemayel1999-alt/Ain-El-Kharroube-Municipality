import {
  LocationUpdateSource,
  Prisma,
  Role,
  TrackingEventType,
  TrackingPingStatus
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody, validateQuery } from "../middleware/validate";
import { writeTrackingEvent } from "../services/trackingAudit";
import {
  computeTrackingHealthState,
  DEFAULT_PING_EXPIRATION_SECONDS,
  DEFAULT_TRACKING_OFFLINE_AFTER_SECONDS,
  DEFAULT_TRACKING_STALE_AFTER_SECONDS,
  expireDueTrackingPings,
  MAX_PING_EXPIRATION_SECONDS,
  MIN_PING_EXPIRATION_SECONDS,
  parseTrackingPingStatusList
} from "../services/trackingPing";
import { isWebPushEnabled, sendWebPush, webPushPublicKey } from "../services/webPush";
import { asyncHandler } from "../utils/asyncHandler";

const TRACKING_OPERATOR_ROLES = [Role.ADMIN, Role.CASE_WORKER, Role.POLICE] as const;
type WebPushSendResult = Awaited<ReturnType<typeof sendWebPush>>;

const createTrackingPingSchema = z.object({
  targetUserId: z.string().uuid(),
  requestMessage: z.string().trim().max(240).optional().nullable(),
  expiresInSeconds: z
    .coerce.number()
    .int()
    .min(MIN_PING_EXPIRATION_SECONDS)
    .max(MAX_PING_EXPIRATION_SECONDS)
    .optional()
});

const listTrackingPingsQuerySchema = z.object({
  targetUserId: z.string().uuid().optional(),
  requestedByUserId: z.string().uuid().optional(),
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

const listTrackingLogsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  eventType: z.string().optional(),
  pingStatus: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

const trackingOverviewQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  health: z.string().optional(),
  staleAfterSeconds: z.coerce.number().int().min(30).max(900).default(DEFAULT_TRACKING_STALE_AFTER_SECONDS),
  offlineAfterSeconds: z.coerce
    .number()
    .int()
    .min(60)
    .max(3600)
    .default(DEFAULT_TRACKING_OFFLINE_AFTER_SECONDS),
  limit: z.coerce.number().int().min(1).max(300).default(150)
});

const respondToTrackingPingSchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    accuracy: z.coerce.number().min(0).max(5000).optional(),
    timestamp: z.union([z.string().trim().min(1), z.coerce.number()]).optional().nullable(),
    batteryLevel: z.coerce.number().min(0).max(100).optional().nullable(),
    failureReason: z.enum(["PERMISSION_DENIED", "UNAVAILABLE", "TIMEOUT", "UNKNOWN"]).optional(),
    errorMessage: z.string().trim().max(300).optional().nullable()
  })
  .superRefine((data, ctx) => {
    const hasCoordinates =
      typeof data.latitude === "number" &&
      typeof data.longitude === "number" &&
      typeof data.accuracy === "number";

    if (data.failureReason && hasCoordinates) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide either location coordinates or failureReason, not both."
      });
      return;
    }

    if (!data.failureReason && !hasCoordinates) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Location coordinates are required when failureReason is not provided."
      });
    }
  });

const savePushSubscriptionSchema = z.object({
  endpoint: z.string().trim().url().max(2000),
  keys: z.object({
    p256dh: z.string().trim().min(10).max(600),
    auth: z.string().trim().min(5).max(300)
  }),
  expirationTime: z.coerce.number().optional().nullable()
});

function normalizeOptionalText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function parseIsoDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
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

function parseTrackingEventTypeList(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  const parts = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => value.toUpperCase() as TrackingEventType);

  if (!parts.length) {
    return null;
  }

  const validEventTypes = new Set(Object.values(TrackingEventType));
  if (parts.some((value) => !validEventTypes.has(value))) {
    return null;
  }

  return Array.from(new Set(parts));
}

function parseTrackingHealthFilter(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  const valid = new Set(["ACTIVE", "STALE", "OFFLINE", "NOT_ENABLED"]);
  const parts = raw
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);

  if (!parts.length || parts.some((value) => !valid.has(value))) {
    return null;
  }

  return Array.from(new Set(parts));
}

function secondsBetween(from: Date, to: Date | null) {
  if (!to) {
    return null;
  }
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

function userCanManageTracking(userRole: Role) {
  return (TRACKING_OPERATOR_ROLES as readonly Role[]).includes(userRole);
}

function isWebPushFailure(result: WebPushSendResult): result is Extract<WebPushSendResult, { ok: false }> {
  return result.ok === false;
}

async function logUnauthorizedTrackingAttempt(params: {
  actorUserId: string;
  action: string;
  pingRequestId?: string;
  targetUserId?: string;
}) {
  await writeTrackingEvent({
    userId: params.targetUserId ?? params.actorUserId,
    actorUserId: params.actorUserId,
    eventType: TrackingEventType.UNAUTHORIZED_TRACKING_ACTION_ATTEMPT,
    eventSummary: "Unauthorized tracking action blocked.",
    relatedPingRequestId: params.pingRequestId ?? null,
    metadata: {
      action: params.action,
      targetUserId: params.targetUserId ?? null
    }
  });
}

async function markStaleUsersInAudit(params: {
  staleUserIds: string[];
  staleAfterSeconds: number;
  now: Date;
}) {
  if (!params.staleUserIds.length) {
    return;
  }

  const dedupeWindow = new Date(params.now.getTime() - 15 * 60 * 1000);
  const recent = await prisma.trackingEventLog.findMany({
    where: {
      eventType: TrackingEventType.LIVE_TRACKING_BECAME_STALE,
      userId: {
        in: params.staleUserIds
      },
      createdAt: {
        gte: dedupeWindow
      }
    },
    select: {
      userId: true
    }
  });

  const alreadyLogged = new Set(recent.map((entry) => entry.userId));

  for (const userId of params.staleUserIds) {
    if (alreadyLogged.has(userId)) {
      continue;
    }

    await writeTrackingEvent({
      userId,
      eventType: TrackingEventType.LIVE_TRACKING_BECAME_STALE,
      eventSummary: "Live tracking became stale.",
      metadata: {
        staleAfterSeconds: params.staleAfterSeconds,
        markedAt: params.now.toISOString()
      }
    });
  }
}

async function deliverPingNotifications(params: {
  pingId: string;
  targetUserId: string;
  requestMessage: string;
  requestedByName: string;
}) {
  const now = new Date();
  await prisma.notification.create({
    data: {
      userId: params.targetUserId,
      title: "Location Ping Request",
      message: params.requestMessage,
      metadata: {
        kind: "TRACKING_PING",
        pingId: params.pingId,
        openPath: `/live-tracking/respond-ping/${params.pingId}`,
        requestedByName: params.requestedByName
      }
    }
  });

  await prisma.locationPingRequest.update({
    where: {
      id: params.pingId
    },
    data: {
      notificationDeliveredAt: now
    }
  });

  await writeTrackingEvent({
    userId: params.targetUserId,
    eventType: TrackingEventType.PING_NOTIFICATION_DELIVERED,
    eventSummary: "Ping request delivered in-app.",
    relatedPingRequestId: params.pingId,
    metadata: {
      method: "IN_APP",
      deliveredAt: now.toISOString()
    }
  });

  if (!isWebPushEnabled()) {
    return {
      pushAttempted: false,
      pushDeliveredCount: 0,
      pushFailedCount: 0
    };
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      userId: params.targetUserId,
      isActive: true
    },
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true
    }
  });

  if (!subscriptions.length) {
    return {
      pushAttempted: false,
      pushDeliveredCount: 0,
      pushFailedCount: 0
    };
  }

  let pushDeliveredCount = 0;
  let pushFailedCount = 0;

  for (const subscription of subscriptions) {
    const sendResult = await sendWebPush(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth
        }
      },
      {
        title: "Municipality Location Request",
        body: params.requestMessage,
        pingId: params.pingId,
        targetPath: `/live-tracking/respond-ping/${params.pingId}`
      }
    );

    if (!isWebPushFailure(sendResult)) {
      pushDeliveredCount += 1;
      await prisma.pushSubscription.update({
        where: {
          id: subscription.id
        },
        data: {
          lastSuccessAt: new Date(),
          lastFailureAt: null,
          lastFailureReason: null,
          isActive: true
        }
      });
      continue;
    }

    pushFailedCount += 1;
    await prisma.pushSubscription.update({
      where: {
        id: subscription.id
      },
      data: {
        isActive: sendResult.deactivateSubscription ? false : true,
        lastFailureAt: new Date(),
        lastFailureReason: sendResult.reason.slice(0, 240)
      }
    });
  }

  if (pushDeliveredCount > 0) {
    await writeTrackingEvent({
      userId: params.targetUserId,
      eventType: TrackingEventType.PING_NOTIFICATION_DELIVERED,
      eventSummary: "Ping request sent via web push.",
      relatedPingRequestId: params.pingId,
      metadata: {
        method: "PUSH",
        deliveredCount: pushDeliveredCount,
        failedCount: pushFailedCount
      }
    });
  }

  if (pushFailedCount > 0) {
    await writeTrackingEvent({
      userId: params.targetUserId,
      eventType: TrackingEventType.PUSH_NOTIFICATION_FAILED,
      eventSummary: "Some push notifications could not be delivered.",
      relatedPingRequestId: params.pingId,
      metadata: {
        failedCount: pushFailedCount,
        deliveredCount: pushDeliveredCount
      }
    });
  }

  return {
    pushAttempted: true,
    pushDeliveredCount,
    pushFailedCount
  };
}

export const trackingPingsRouter = Router();
export const trackingLogsRouter = Router();
export const trackingUsersRouter = Router();
export const pushSubscriptionsRouter = Router();
trackingPingsRouter.post(
  "/",
  requireRoles(...TRACKING_OPERATOR_ROLES),
  validateBody(createTrackingPingSchema),
  asyncHandler(async (req, res) => {
    await expireDueTrackingPings(120);

    const payload = req.body as z.infer<typeof createTrackingPingSchema>;
    const targetUser = await prisma.user.findUnique({
      where: {
        id: payload.targetUserId
      },
      select: {
        id: true,
        fullName: true,
        isActive: true,
        liveLocationEnabled: true
      }
    });

    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({ message: "Target user not found." });
    }

    if (!targetUser.liveLocationEnabled) {
      return res.status(400).json({ message: "Live tracking sender is disabled for this user." });
    }

    const requestedBy = await prisma.user.findUnique({
      where: {
        id: req.user!.id
      },
      select: {
        id: true,
        fullName: true
      }
    });

    const requestMessage =
      normalizeOptionalText(payload.requestMessage) ??
      "Municipality is requesting your current location. Open now to send your latest location.";

    const now = new Date();
    const expiresInSeconds = payload.expiresInSeconds ?? DEFAULT_PING_EXPIRATION_SECONDS;
    const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000);

    const ping = await prisma.locationPingRequest.create({
      data: {
        targetUserId: targetUser.id,
        requestedByUserId: req.user!.id,
        requestMessage,
        status: TrackingPingStatus.PENDING,
        expiresAt
      }
    });

    await writeTrackingEvent({
      userId: targetUser.id,
      actorUserId: req.user!.id,
      eventType: TrackingEventType.PING_REQUESTED,
      eventSummary: "Location ping requested by operator.",
      relatedPingRequestId: ping.id,
      metadata: {
        requestMessage,
        expiresAt: expiresAt.toISOString()
      }
    });

    const pushResult = await deliverPingNotifications({
      pingId: ping.id,
      targetUserId: targetUser.id,
      requestMessage,
      requestedByName: requestedBy?.fullName ?? "Municipality"
    });

    return res.status(201).json({
      id: ping.id,
      targetUserId: ping.targetUserId,
      requestedByUserId: ping.requestedByUserId,
      status: ping.status,
      requestMessage: ping.requestMessage,
      createdAt: ping.createdAt,
      expiresAt: ping.expiresAt,
      pushAttempted: pushResult.pushAttempted,
      pushDeliveredCount: pushResult.pushDeliveredCount,
      pushFailedCount: pushResult.pushFailedCount
    });
  })
);

trackingPingsRouter.get(
  "/",
  requireRoles(...TRACKING_OPERATOR_ROLES),
  validateQuery(listTrackingPingsQuerySchema),
  asyncHandler(async (req, res) => {
    await expireDueTrackingPings(200);

    const query = req.query as z.infer<typeof listTrackingPingsQuerySchema>;
    const statuses = parseTrackingPingStatusList(query.status);
    if (query.status && !statuses) {
      return res.status(400).json({ message: "Invalid tracking ping status filter." });
    }

    const from = parseIsoDate(query.from);
    const to = parseIsoDate(query.to);
    if ((query.from && !from) || (query.to && !to)) {
      return res.status(400).json({ message: "Invalid date range." });
    }

    const rows = await prisma.locationPingRequest.findMany({
      where: {
        targetUserId: query.targetUserId,
        requestedByUserId: query.requestedByUserId,
        status: statuses ? { in: statuses } : undefined,
        createdAt:
          from || to
            ? {
                gte: from ?? undefined,
                lte: to ?? undefined
              }
            : undefined
      },
      include: {
        targetUser: {
          select: {
            id: true,
            fullName: true,
            role: true
          }
        },
        requestedBy: {
          select: {
            id: true,
            fullName: true,
            role: true
          }
        },
        locationPoint: {
          select: {
            id: true,
            latitude: true,
            longitude: true,
            accuracyM: true,
            recordedAt: true,
            receivedAt: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: query.limit
    });

    return res.json(
      rows.map((row) => ({
        id: row.id,
        targetUserId: row.targetUserId,
        requestedByUserId: row.requestedByUserId,
        status: row.status,
        requestMessage: row.requestMessage,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        openedAt: row.openedAt,
        respondedAt: row.respondedAt,
        cancelledAt: row.cancelledAt,
        lastError: row.lastError,
        isLateResponse: row.isLateResponse,
        notificationDeliveredAt: row.notificationDeliveredAt,
        responseTimeSeconds: secondsBetween(row.createdAt, row.respondedAt),
        targetUser: row.targetUser,
        requestedBy: row.requestedBy,
        locationPoint: row.locationPoint
      }))
    );
  })
);

trackingPingsRouter.get(
  "/my-pending",
  asyncHandler(async (req, res) => {
    await expireDueTrackingPings(120);

    const now = new Date();
    const rows = await prisma.locationPingRequest.findMany({
      where: {
        targetUserId: req.user!.id,
        status: {
          in: [TrackingPingStatus.PENDING, TrackingPingStatus.OPENED, TrackingPingStatus.FAILED]
        },
        expiresAt: {
          gt: now
        }
      },
      include: {
        requestedBy: {
          select: {
            id: true,
            fullName: true,
            role: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 10
    });

    return res.json(
      rows.map((row) => ({
        id: row.id,
        status: row.status,
        requestMessage: row.requestMessage,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        openedAt: row.openedAt,
        respondedAt: row.respondedAt,
        lastError: row.lastError,
        requestedBy: row.requestedBy
      }))
    );
  })
);

trackingPingsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    await expireDueTrackingPings(50);

    const pingId = z.string().uuid().parse(req.params.id);
    const ping = await prisma.locationPingRequest.findUnique({
      where: {
        id: pingId
      },
      include: {
        targetUser: {
          select: {
            id: true,
            fullName: true,
            role: true
          }
        },
        requestedBy: {
          select: {
            id: true,
            fullName: true,
            role: true
          }
        },
        locationPoint: {
          select: {
            id: true,
            latitude: true,
            longitude: true,
            accuracyM: true,
            recordedAt: true,
            receivedAt: true
          }
        }
      }
    });

    if (!ping) {
      return res.status(404).json({ message: "Tracking ping not found." });
    }

    if (!userCanManageTracking(req.user!.role) && ping.targetUserId !== req.user!.id) {
      await logUnauthorizedTrackingAttempt({
        actorUserId: req.user!.id,
        action: "tracking_ping_read",
        pingRequestId: ping.id,
        targetUserId: ping.targetUserId
      });
      return res.status(403).json({ message: "You are not allowed to access this tracking ping." });
    }

    return res.json({
      id: ping.id,
      targetUserId: ping.targetUserId,
      requestedByUserId: ping.requestedByUserId,
      status: ping.status,
      requestMessage: ping.requestMessage,
      createdAt: ping.createdAt,
      expiresAt: ping.expiresAt,
      openedAt: ping.openedAt,
      respondedAt: ping.respondedAt,
      cancelledAt: ping.cancelledAt,
      lastError: ping.lastError,
      isLateResponse: ping.isLateResponse,
      notificationDeliveredAt: ping.notificationDeliveredAt,
      responseTimeSeconds: secondsBetween(ping.createdAt, ping.respondedAt),
      targetUser: ping.targetUser,
      requestedBy: ping.requestedBy,
      locationPoint: ping.locationPoint
    });
  })
);

trackingPingsRouter.post(
  "/:id/open",
  asyncHandler(async (req, res) => {
    await expireDueTrackingPings(50);

    const pingId = z.string().uuid().parse(req.params.id);
    const ping = await prisma.locationPingRequest.findUnique({
      where: {
        id: pingId
      },
      select: {
        id: true,
        targetUserId: true,
        requestedByUserId: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        openedAt: true,
        respondedAt: true,
        lastError: true
      }
    });

    if (!ping) {
      return res.status(404).json({ message: "Tracking ping not found." });
    }

    if (ping.targetUserId !== req.user!.id) {
      await logUnauthorizedTrackingAttempt({
        actorUserId: req.user!.id,
        action: "tracking_ping_open",
        pingRequestId: ping.id,
        targetUserId: ping.targetUserId
      });
      return res.status(403).json({ message: "You are not allowed to open this tracking ping." });
    }

    if (ping.status === TrackingPingStatus.CANCELLED) {
      return res.status(409).json({ message: "This tracking ping was cancelled." });
    }

    if (ping.status === TrackingPingStatus.RESPONDED) {
      return res.json({
        id: ping.id,
        status: ping.status,
        createdAt: ping.createdAt,
        expiresAt: ping.expiresAt,
        openedAt: ping.openedAt,
        respondedAt: ping.respondedAt,
        lastError: ping.lastError
      });
    }

    if (ping.status === TrackingPingStatus.EXPIRED || ping.expiresAt <= new Date()) {
      return res.status(410).json({
        message: "This tracking ping has expired.",
        status: TrackingPingStatus.EXPIRED
      });
    }

    const shouldMarkOpened = ping.status === TrackingPingStatus.PENDING && !ping.openedAt;
    const openedAt = new Date();

    const updated = await prisma.locationPingRequest.update({
      where: {
        id: ping.id
      },
      data: shouldMarkOpened
        ? {
            status: TrackingPingStatus.OPENED,
            openedAt
          }
        : {
            openedAt: ping.openedAt ?? openedAt
          },
      select: {
        id: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        openedAt: true,
        respondedAt: true,
        lastError: true
      }
    });

    if (shouldMarkOpened) {
      await writeTrackingEvent({
        userId: ping.targetUserId,
        actorUserId: req.user!.id,
        eventType: TrackingEventType.PING_OPENED,
        eventSummary: "User opened the location ping flow.",
        relatedPingRequestId: ping.id,
        metadata: {
          openedAt: openedAt.toISOString()
        }
      });
    }

    return res.json(updated);
  })
);

trackingPingsRouter.post(
  "/:id/respond",
  validateBody(respondToTrackingPingSchema),
  asyncHandler(async (req, res) => {
    await expireDueTrackingPings(50);

    const pingId = z.string().uuid().parse(req.params.id);
    const payload = req.body as z.infer<typeof respondToTrackingPingSchema>;

    const ping = await prisma.locationPingRequest.findUnique({
      where: {
        id: pingId
      },
      select: {
        id: true,
        targetUserId: true,
        requestedByUserId: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        openedAt: true,
        respondedAt: true,
        locationPointId: true
      }
    });

    if (!ping) {
      return res.status(404).json({ message: "Tracking ping not found." });
    }

    if (ping.targetUserId !== req.user!.id) {
      await logUnauthorizedTrackingAttempt({
        actorUserId: req.user!.id,
        action: "tracking_ping_respond",
        pingRequestId: ping.id,
        targetUserId: ping.targetUserId
      });
      return res.status(403).json({ message: "You are not allowed to respond to this tracking ping." });
    }

    if (ping.status === TrackingPingStatus.CANCELLED) {
      return res.status(409).json({ message: "This tracking ping was cancelled." });
    }

    if (ping.status === TrackingPingStatus.RESPONDED && ping.locationPointId) {
      return res.status(409).json({ message: "This tracking ping already has a location response." });
    }

    const now = new Date();
    const isExpired = ping.expiresAt <= now || ping.status === TrackingPingStatus.EXPIRED;

    if (payload.failureReason) {
      const failedStatus = isExpired ? TrackingPingStatus.EXPIRED : TrackingPingStatus.FAILED;
      const errorText = [payload.failureReason, normalizeOptionalText(payload.errorMessage)]
        .filter((value): value is string => Boolean(value))
        .join(": ")
        .slice(0, 300);

      const updated = await prisma.locationPingRequest.update({
        where: {
          id: ping.id
        },
        data: {
          status: failedStatus,
          lastError: errorText || payload.failureReason,
          isLateResponse: isExpired
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          expiresAt: true,
          openedAt: true,
          respondedAt: true,
          lastError: true,
          isLateResponse: true
        }
      });

      if (payload.failureReason === "PERMISSION_DENIED") {
        await writeTrackingEvent({
          userId: ping.targetUserId,
          actorUserId: req.user!.id,
          eventType: TrackingEventType.GEOLOCATION_PERMISSION_DENIED,
          relatedPingRequestId: ping.id,
          metadata: {
            failureReason: payload.failureReason,
            errorMessage: normalizeOptionalText(payload.errorMessage)
          }
        });
      } else if (payload.failureReason === "UNAVAILABLE") {
        await writeTrackingEvent({
          userId: ping.targetUserId,
          actorUserId: req.user!.id,
          eventType: TrackingEventType.GEOLOCATION_UNAVAILABLE,
          relatedPingRequestId: ping.id,
          metadata: {
            failureReason: payload.failureReason,
            errorMessage: normalizeOptionalText(payload.errorMessage)
          }
        });
      }

      await writeTrackingEvent({
        userId: ping.targetUserId,
        actorUserId: req.user!.id,
        eventType: TrackingEventType.PING_FAILED,
        eventSummary: "Location ping response failed.",
        relatedPingRequestId: ping.id,
        metadata: {
          failureReason: payload.failureReason,
          errorMessage: normalizeOptionalText(payload.errorMessage),
          expiredAtResponseTime: isExpired
        }
      });

      if (isExpired && ping.status !== TrackingPingStatus.EXPIRED) {
        await writeTrackingEvent({
          userId: ping.targetUserId,
          actorUserId: ping.requestedByUserId,
          eventType: TrackingEventType.PING_EXPIRED,
          eventSummary: "Ping expired before a valid location response.",
          relatedPingRequestId: ping.id,
          metadata: {
            failureReason: payload.failureReason,
            expiresAt: ping.expiresAt.toISOString(),
            attemptedAt: now.toISOString()
          }
        });
      }

      return res.json({
        accepted: false,
        reason: payload.failureReason,
        ping: updated
      });
    }
    const recordedAt = parseClientTimestamp(payload.timestamp);
    if (!recordedAt) {
      return res.status(400).json({
        message: "Invalid timestamp. Use an ISO string or unix milliseconds within a reasonable range."
      });
    }

    const activeSession = await prisma.locationSharingSession.findFirst({
      where: {
        userId: req.user!.id,
        isActive: true
      },
      select: {
        id: true
      },
      orderBy: {
        startedAt: "desc"
      }
    });

    const response = await prisma.$transaction(async (tx) => {
      const point = await tx.locationPoint.create({
        data: {
          userId: req.user!.id,
          sessionId: activeSession?.id ?? null,
          latitude: payload.latitude!,
          longitude: payload.longitude!,
          accuracyM: payload.accuracy!,
          recordedAt,
          source: LocationUpdateSource.BROWSER_GEOLOCATION,
          batteryLevel: payload.batteryLevel ?? null,
          isSharingSnapshot: false
        }
      });

      await tx.liveLocationState.upsert({
        where: {
          userId: req.user!.id
        },
        create: {
          userId: req.user!.id,
          isSharing: Boolean(activeSession?.id),
          lastLatitude: payload.latitude!,
          lastLongitude: payload.longitude!,
          lastAccuracyM: payload.accuracy!,
          lastRecordedAt: recordedAt,
          lastReceivedAt: now,
          lastSource: LocationUpdateSource.BROWSER_GEOLOCATION,
          lastBatteryLevel: payload.batteryLevel ?? null,
          lastPointId: point.id
        },
        update: {
          lastLatitude: payload.latitude!,
          lastLongitude: payload.longitude!,
          lastAccuracyM: payload.accuracy!,
          lastRecordedAt: recordedAt,
          lastReceivedAt: now,
          lastSource: LocationUpdateSource.BROWSER_GEOLOCATION,
          lastBatteryLevel: payload.batteryLevel ?? null,
          lastPointId: point.id
        }
      });

      const nextStatus = isExpired ? TrackingPingStatus.EXPIRED : TrackingPingStatus.RESPONDED;

      const updatedPing = await tx.locationPingRequest.update({
        where: {
          id: ping.id
        },
        data: {
          status: nextStatus,
          respondedAt: now,
          locationPointId: point.id,
          isLateResponse: isExpired,
          lastError: isExpired ? "LATE_RESPONSE" : null,
          openedAt: ping.openedAt ?? now
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          expiresAt: true,
          openedAt: true,
          respondedAt: true,
          lastError: true,
          isLateResponse: true,
          locationPointId: true
        }
      });

      await writeTrackingEvent(
        {
          userId: req.user!.id,
          actorUserId: req.user!.id,
          eventType: TrackingEventType.PING_LOCATION_RESPONDED,
          eventSummary: isExpired
            ? "Late location response saved after ping expiration."
            : "Location response saved for ping.",
          relatedPingRequestId: ping.id,
          relatedSessionId: activeSession?.id ?? null,
          metadata: {
            latitude: payload.latitude,
            longitude: payload.longitude,
            accuracyM: payload.accuracy,
            recordedAt: recordedAt.toISOString(),
            receivedAt: now.toISOString(),
            lateResponse: isExpired
          }
        },
        tx
      );

      await writeTrackingEvent(
        {
          userId: req.user!.id,
          actorUserId: req.user!.id,
          eventType: TrackingEventType.LIVE_TRACKING_UPDATE_RECEIVED,
          eventSummary: "One-shot location update received from ping flow.",
          relatedPingRequestId: ping.id,
          relatedSessionId: activeSession?.id ?? null,
          metadata: {
            source: "PING_RESPONSE",
            latitude: payload.latitude,
            longitude: payload.longitude,
            accuracyM: payload.accuracy,
            receivedAt: now.toISOString()
          }
        },
        tx
      );

      if (isExpired && ping.status !== TrackingPingStatus.EXPIRED) {
        await writeTrackingEvent(
          {
            userId: req.user!.id,
            actorUserId: ping.requestedByUserId,
            eventType: TrackingEventType.PING_EXPIRED,
            eventSummary: "Ping response arrived after expiration window.",
            relatedPingRequestId: ping.id,
            metadata: {
              lateResponse: true,
              expiresAt: ping.expiresAt.toISOString(),
              respondedAt: now.toISOString()
            }
          },
          tx
        );
      }

      return {
        point,
        ping: updatedPing
      };
    });

    return res.json({
      accepted: true,
      lateResponse: isExpired,
      locationPointId: response.point.id,
      ping: response.ping
    });
  })
);

trackingPingsRouter.post(
  "/:id/cancel",
  requireRoles(...TRACKING_OPERATOR_ROLES),
  asyncHandler(async (req, res) => {
    await expireDueTrackingPings(30);

    const pingId = z.string().uuid().parse(req.params.id);
    const ping = await prisma.locationPingRequest.findUnique({
      where: {
        id: pingId
      },
      select: {
        id: true,
        targetUserId: true,
        status: true,
        cancelledAt: true
      }
    });

    if (!ping) {
      return res.status(404).json({ message: "Tracking ping not found." });
    }

    if (
      ping.status === TrackingPingStatus.CANCELLED ||
      ping.status === TrackingPingStatus.RESPONDED ||
      ping.status === TrackingPingStatus.EXPIRED
    ) {
      return res.json({
        id: ping.id,
        status: ping.status,
        cancelledAt: ping.cancelledAt
      });
    }

    const now = new Date();
    const updated = await prisma.locationPingRequest.update({
      where: {
        id: ping.id
      },
      data: {
        status: TrackingPingStatus.CANCELLED,
        cancelledAt: now,
        lastError: "CANCELLED_BY_OPERATOR"
      },
      select: {
        id: true,
        status: true,
        cancelledAt: true
      }
    });

    await writeTrackingEvent({
      userId: ping.targetUserId,
      actorUserId: req.user!.id,
      eventType: TrackingEventType.PING_CANCELLED,
      eventSummary: "Tracking ping cancelled by operator.",
      relatedPingRequestId: ping.id,
      metadata: {
        cancelledAt: now.toISOString()
      }
    });

    return res.json(updated);
  })
);

trackingUsersRouter.get(
  "/overview",
  requireRoles(...TRACKING_OPERATOR_ROLES),
  validateQuery(trackingOverviewQuerySchema),
  asyncHandler(async (req, res) => {
    await expireDueTrackingPings(120);

    const query = req.query as z.infer<typeof trackingOverviewQuerySchema>;
    const healthFilter = parseTrackingHealthFilter(query.health);
    if (query.health && !healthFilter) {
      return res.status(400).json({ message: "Invalid tracking health filter." });
    }

    const users = await prisma.user.findMany({
      where: {
        OR: query.search
          ? [
              {
                fullName: {
                  contains: query.search,
                  mode: "insensitive"
                }
              },
              {
                email: {
                  contains: query.search,
                  mode: "insensitive"
                }
              }
            ]
          : undefined
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        liveLocationEnabled: true,
        liveLocationVisible: true,
        trustedDevice: {
          select: {
            id: true,
            isActive: true,
            deviceLabel: true,
            platform: true,
            browserLanguage: true,
            timezone: true,
            lastSeenAt: true,
            firstTrustedAt: true,
            resetAt: true
          }
        },
        liveLocationState: {
          select: {
            isSharing: true,
            lastLatitude: true,
            lastLongitude: true,
            lastAccuracyM: true,
            lastRecordedAt: true,
            lastReceivedAt: true,
            lastSource: true,
            lastBatteryLevel: true
          }
        }
      },
      orderBy: [{ liveLocationEnabled: "desc" }, { fullName: "asc" }],
      take: query.limit
    });

    const userIds = users.map((user) => user.id);
    type LatestPingRow = {
      id: string;
      targetUserId: string;
      status: TrackingPingStatus;
      createdAt: Date;
      expiresAt: Date;
      openedAt: Date | null;
      respondedAt: Date | null;
      isLateResponse: boolean;
    };

    const latestPings = userIds.length
      ? await prisma.$queryRaw<LatestPingRow[]>(Prisma.sql`
        SELECT DISTINCT ON ("targetUserId")
          "id", "targetUserId", "status", "createdAt", "expiresAt", "openedAt", "respondedAt", "isLateResponse"
        FROM "LocationPingRequest"
        WHERE "targetUserId" IN (${Prisma.join(userIds)})
        ORDER BY "targetUserId", "createdAt" DESC
      `)
      : [];

    const latestPingByUserId = new Map(latestPings.map((row) => [row.targetUserId, row]));

    const now = new Date();
    const rows = users.map((user) => {
      const latestState = user.liveLocationState;
      const trackingHealthState = computeTrackingHealthState({
        liveLocationEnabled: user.liveLocationEnabled,
        isSharing: Boolean(latestState?.isSharing),
        lastReceivedAt: latestState?.lastReceivedAt ?? null,
        staleAfterSeconds: query.staleAfterSeconds,
        offlineAfterSeconds: query.offlineAfterSeconds
      });

      const latestPing = latestPingByUserId.get(user.id) ?? null;

      return {
        userId: user.id,
        name: user.fullName,
        email: user.email,
        role: user.role,
        accountStatus: user.isActive ? "ACTIVE" : "DISABLED",
        trustedDeviceAssigned: Boolean(user.trustedDevice?.isActive),
        trustedDevice: user.trustedDevice,
        liveTrackingSenderEnabled: user.liveLocationEnabled,
        visibleOnLiveMap: user.liveLocationVisible,
        currentlySharing: Boolean(latestState?.isSharing),
        lastKnownLocationTime: latestState?.lastReceivedAt ?? null,
        lastKnownLocation: {
          latitude: latestState?.lastLatitude ?? null,
          longitude: latestState?.lastLongitude ?? null,
          accuracyM: latestState?.lastAccuracyM ?? null,
          source: latestState?.lastSource ?? null
        },
        lastPingStatus: latestPing?.status ?? null,
        lastPingRequestedAt: latestPing?.createdAt ?? null,
        lastPingRespondedAt: latestPing?.respondedAt ?? null,
        lastSeenOnlineAt: user.trustedDevice?.lastSeenAt ?? null,
        trackingHealthState
      };
    });

    const staleUserIds = rows
      .filter((row) => row.trackingHealthState === "STALE" && row.currentlySharing)
      .map((row) => row.userId);
    await markStaleUsersInAudit({
      staleUserIds,
      staleAfterSeconds: query.staleAfterSeconds,
      now
    });

    const filteredRows = healthFilter
      ? rows.filter((row) => healthFilter.includes(row.trackingHealthState))
      : rows;

    return res.json({
      generatedAt: now,
      staleAfterSeconds: query.staleAfterSeconds,
      offlineAfterSeconds: query.offlineAfterSeconds,
      users: filteredRows
    });
  })
);
trackingUsersRouter.post(
  "/:id/stop-session",
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const userId = z.string().uuid().parse(req.params.id);

    const user = await prisma.user.findUnique({
      where: {
        id: userId
      },
      select: {
        id: true,
        fullName: true
      }
    });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const now = new Date();
    const activeSessions = await prisma.locationSharingSession.findMany({
      where: {
        userId,
        isActive: true
      },
      select: {
        id: true
      }
    });

    await prisma.locationSharingSession.updateMany({
      where: {
        userId,
        isActive: true
      },
      data: {
        isActive: false,
        stoppedAt: now,
        stoppedReason: "ADMIN_STOPPED"
      }
    });

    await prisma.liveLocationState.upsert({
      where: {
        userId
      },
      create: {
        userId,
        isSharing: false
      },
      update: {
        isSharing: false
      }
    });

    await writeTrackingEvent({
      userId,
      actorUserId: req.user!.id,
      eventType: TrackingEventType.STOP_ACTIVE_TRACKING_SESSION,
      eventSummary: "Operator stopped active tracking session.",
      metadata: {
        stoppedAt: now.toISOString(),
        sessionCount: activeSessions.length
      }
    });

    for (const session of activeSessions) {
      await writeTrackingEvent({
        userId,
        actorUserId: req.user!.id,
        eventType: TrackingEventType.LIVE_TRACKING_STOPPED,
        eventSummary: "Live tracking session stopped by operator.",
        relatedSessionId: session.id,
        metadata: {
          stoppedAt: now.toISOString(),
          stoppedReason: "ADMIN_STOPPED"
        }
      });
    }

    return res.json({
      userId,
      fullName: user.fullName,
      stoppedAt: now,
      sessionCount: activeSessions.length
    });
  })
);

trackingLogsRouter.get(
  "/",
  requireRoles(...TRACKING_OPERATOR_ROLES),
  validateQuery(listTrackingLogsQuerySchema),
  asyncHandler(async (req, res) => {
    await expireDueTrackingPings(120);

    const query = req.query as z.infer<typeof listTrackingLogsQuerySchema>;
    const eventTypes = parseTrackingEventTypeList(query.eventType);
    if (query.eventType && !eventTypes) {
      return res.status(400).json({ message: "Invalid tracking event type filter." });
    }

    const pingStatuses = parseTrackingPingStatusList(query.pingStatus);
    if (query.pingStatus && !pingStatuses) {
      return res.status(400).json({ message: "Invalid tracking ping status filter." });
    }

    const from = parseIsoDate(query.from);
    const to = parseIsoDate(query.to);
    if ((query.from && !from) || (query.to && !to)) {
      return res.status(400).json({ message: "Invalid date range." });
    }

    const where: Prisma.TrackingEventLogWhereInput = {
      userId: query.userId,
      actorUserId: query.actorUserId,
      eventType: eventTypes ? { in: eventTypes } : undefined,
      createdAt:
        from || to
          ? {
              gte: from ?? undefined,
              lte: to ?? undefined
            }
          : undefined,
      relatedPingRequest: pingStatuses
        ? {
            status: {
              in: pingStatuses
            }
          }
        : undefined
    };

    const skip = (query.page - 1) * query.pageSize;

    const [total, items] = await Promise.all([
      prisma.trackingEventLog.count({ where }),
      prisma.trackingEventLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              role: true
            }
          },
          actorUser: {
            select: {
              id: true,
              fullName: true,
              role: true
            }
          },
          relatedPingRequest: {
            select: {
              id: true,
              status: true,
              createdAt: true,
              openedAt: true,
              respondedAt: true,
              expiresAt: true,
              isLateResponse: true,
              locationPoint: {
                select: {
                  id: true,
                  latitude: true,
                  longitude: true,
                  accuracyM: true,
                  recordedAt: true,
                  receivedAt: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        skip,
        take: query.pageSize
      })
    ]);

    return res.json({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items: items.map((item) => ({
        id: item.id,
        timestamp: item.createdAt,
        user: item.user,
        actor: item.actorUser,
        eventType: item.eventType,
        summary: item.eventSummary,
        metadata: item.metadata,
        relatedPingRequest: item.relatedPingRequest,
        relatedSessionId: item.relatedSessionId,
        relatedTrustedDeviceId: item.relatedTrustedDeviceId,
        coordinates: item.relatedPingRequest?.locationPoint
          ? {
              latitude: item.relatedPingRequest.locationPoint.latitude,
              longitude: item.relatedPingRequest.locationPoint.longitude,
              accuracyM: item.relatedPingRequest.locationPoint.accuracyM
            }
          : null
      }))
    });
  })
);

pushSubscriptionsRouter.get(
  "/public-key",
  asyncHandler(async (_req, res) => {
    const publicKey = webPushPublicKey();
    return res.json({
      enabled: Boolean(publicKey),
      publicKey
    });
  })
);

pushSubscriptionsRouter.post(
  "/",
  validateBody(savePushSubscriptionSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof savePushSubscriptionSchema>;
    const expirationTime =
      typeof payload.expirationTime === "number" && Number.isFinite(payload.expirationTime)
        ? new Date(payload.expirationTime)
        : null;

    const subscription = await prisma.pushSubscription.upsert({
      where: {
        endpoint: payload.endpoint
      },
      create: {
        userId: req.user!.id,
        endpoint: payload.endpoint,
        p256dh: payload.keys.p256dh,
        auth: payload.keys.auth,
        expirationTime,
        userAgent: normalizeOptionalText(req.headers["user-agent"]),
        isActive: true,
        lastFailureAt: null,
        lastFailureReason: null
      },
      update: {
        userId: req.user!.id,
        p256dh: payload.keys.p256dh,
        auth: payload.keys.auth,
        expirationTime,
        userAgent: normalizeOptionalText(req.headers["user-agent"]),
        isActive: true,
        lastFailureAt: null,
        lastFailureReason: null
      },
      select: {
        id: true,
        endpoint: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });

    await writeTrackingEvent({
      userId: req.user!.id,
      actorUserId: req.user!.id,
      eventType: TrackingEventType.PUSH_SUBSCRIPTION_REGISTERED,
      eventSummary: "Browser push subscription saved.",
      metadata: {
        subscriptionId: subscription.id
      }
    });

    return res.status(201).json(subscription);
  })
);

pushSubscriptionsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const subscriptionId = z.string().uuid().parse(req.params.id);
    const existing = await prisma.pushSubscription.findUnique({
      where: {
        id: subscriptionId
      },
      select: {
        id: true,
        userId: true
      }
    });

    if (!existing) {
      return res.status(404).json({ message: "Push subscription not found." });
    }

    if (existing.userId !== req.user!.id && req.user!.role !== Role.ADMIN) {
      return res.status(403).json({ message: "You are not allowed to remove this push subscription." });
    }

    await prisma.pushSubscription.delete({
      where: {
        id: existing.id
      }
    });

    await writeTrackingEvent({
      userId: existing.userId,
      actorUserId: req.user!.id,
      eventType: TrackingEventType.PUSH_SUBSCRIPTION_REMOVED,
      eventSummary: "Browser push subscription removed.",
      metadata: {
        subscriptionId: existing.id
      }
    });

    return res.status(204).send();
  })
);
