import {
  IncidentStatus,
  LiveCameraEventType,
  LiveCameraSessionStatus,
  Prisma,
  Role
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody, validateQuery } from "../middleware/validate";
import { computeTrackingHealthState } from "../services/trackingPing";
import { writeLiveCameraEvent } from "../services/liveCameraAudit";
import { getLiveCameraIceConfig, getLiveCameraIceDebugSummary } from "../services/liveCameraIce";
import { invalidateLiveCameraSessionSignaling } from "../services/liveCameraSignaling";
import { asyncHandler } from "../utils/asyncHandler";

const CONTROL_ROOM_VIEW_ROLES = [Role.ADMIN, Role.CASE_WORKER, Role.POLICE] as const;
const TERMINAL_CAMERA_STATES = new Set<LiveCameraSessionStatus>([
  LiveCameraSessionStatus.ENDED,
  LiveCameraSessionStatus.FAILED,
  LiveCameraSessionStatus.PERMISSION_DENIED,
  LiveCameraSessionStatus.CAMERA_OFF
]);
const ACTIVE_INCIDENT_STATUSES = [
  IncidentStatus.DRAFT,
  IncidentStatus.REPORTED,
  IncidentStatus.ACTIVE_RESPONSE,
  IncidentStatus.CONTAINED,
  IncidentStatus.OPEN,
  IncidentStatus.IN_PROGRESS
] as const;

const startCameraSessionSchema = z.object({
  relatedLocationPointId: z.string().uuid().optional().nullable(),
  deviceLabel: z.string().trim().max(180).optional().nullable(),
  microphoneEnabled: z.boolean().optional(),
  emergency: z.boolean().optional()
});

const stopCameraSessionSchema = z.object({
  reason: z.string().trim().max(120).optional().nullable()
});

const cameraSessionStateSchema = z.object({
  sessionStatus: z.nativeEnum(LiveCameraSessionStatus),
  metadata: z.record(z.unknown()).optional().nullable()
});

const listCameraSessionsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  includeInactive: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  limit: z.coerce.number().int().min(1).max(300).default(120)
});

const listCameraLogsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  actorUserId: z.string().uuid().optional(),
  eventType: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
});

const controlRoomOverviewQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  activeCameraOnly: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  liveTrackingOnly: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  staleAfterSeconds: z.coerce.number().int().min(30).max(900).default(120),
  offlineAfterSeconds: z.coerce.number().int().min(60).max(3600).default(600),
  limit: z.coerce.number().int().min(1).max(500).default(250)
});

const logViewerEventSchema = z.object({
  targetUserId: z.string().uuid(),
  liveCameraSessionId: z.string().uuid().optional().nullable(),
  eventType: z.enum([
    LiveCameraEventType.VIEWER_SWITCHED_STREAM,
    LiveCameraEventType.STREAM_SELECTED_IN_CONTROL_ROOM,
    LiveCameraEventType.VIEWER_OPENED_STREAM
  ]),
  metadata: z.record(z.unknown()).optional().nullable()
});

function normalizeOptionalText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
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

function parseCameraEventTypeList(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length)
    .map((value) => value.toUpperCase() as LiveCameraEventType);

  if (!values.length) {
    return null;
  }

  const valid = new Set(Object.values(LiveCameraEventType));
  if (values.some((value) => !valid.has(value))) {
    return null;
  }

  return Array.from(new Set(values));
}

function userCanViewControlRoom(role: Role) {
  return (CONTROL_ROOM_VIEW_ROLES as readonly Role[]).includes(role);
}

function cameraStateBadge(sessionStatus: LiveCameraSessionStatus, isActive: boolean) {
  if (!isActive) {
    return "OFFLINE" as const;
  }
  return sessionStatus;
}

export const liveCameraRouter = Router();
export const controlRoomRouter = Router();

liveCameraRouter.get(
  "/ice-config",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        role: true,
        isActive: true,
        canSendLiveCamera: true
      }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!user.canSendLiveCamera && !userCanViewControlRoom(user.role)) {
      return res.status(403).json({ message: "You are not allowed to access live camera streaming configuration." });
    }

    return res.json(getLiveCameraIceConfig());
  })
);

liveCameraRouter.get(
  "/ice-config/debug",
  requireRoles(...CONTROL_ROOM_VIEW_ROLES),
  asyncHandler(async (_req, res) => {
    return res.json(getLiveCameraIceDebugSummary());
  })
);

liveCameraRouter.post(
  "/sessions/start",
  validateBody(startCameraSessionSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof startCameraSessionSchema>;

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        isActive: true,
        canSendLiveCamera: true,
        visibleInControlRoom: true,
        trustedDevice: {
          select: {
            id: true,
            isActive: true
          }
        }
      }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!user.canSendLiveCamera) {
      return res.status(403).json({ message: "Live camera sending is not enabled for this account." });
    }

    if (!user.visibleInControlRoom) {
      return res.status(403).json({ message: "This account is hidden from Control Room broadcasts." });
    }

    if (!req.user!.trustedDeviceId || !user.trustedDevice?.isActive || user.trustedDevice.id !== req.user!.trustedDeviceId) {
      await writeLiveCameraEvent({
        userId: user.id,
        actorUserId: req.user!.id,
        eventType: "TRUSTED_DEVICE_MISMATCH_BLOCKED_CAMERA_START",
        eventSummary: "Camera session start blocked due to trusted-device mismatch.",
        metadata: {
          trustedDeviceIdInToken: req.user!.trustedDeviceId ?? null,
          currentTrustedDeviceId: user.trustedDevice?.id ?? null
        }
      });

      return res.status(403).json({
        message: "Camera broadcast requires an active trusted device session. Please log in again from your trusted device."
      });
    }

    const now = new Date();
    const existingActiveSessions = await prisma.liveCameraSession.findMany({
      where: {
        userId: user.id,
        isActive: true
      },
      select: {
        id: true
      }
    });

    await prisma.liveCameraSession.updateMany({
      where: {
        userId: user.id,
        isActive: true
      },
      data: {
        isActive: false,
        endedAt: now,
        sessionStatus: LiveCameraSessionStatus.ENDED
      }
    });

    for (const active of existingActiveSessions) {
      invalidateLiveCameraSessionSignaling({
        sessionId: active.id,
        targetUserId: user.id,
        reason: "REPLACED_BY_NEW_SESSION"
      });
    }

    const session = await prisma.liveCameraSession.create({
      data: {
        userId: user.id,
        relatedLocationPointId: payload.relatedLocationPointId ?? null,
        deviceLabel: normalizeOptionalText(payload.deviceLabel),
        userAgent: normalizeOptionalText(req.headers["user-agent"]),
        sessionStatus: LiveCameraSessionStatus.CONNECTING,
        metadata: {
          microphoneEnabled: payload.microphoneEnabled ?? true,
          emergency: payload.emergency ?? false
        }
      },
      select: {
        id: true,
        userId: true,
        startedAt: true,
        endedAt: true,
        isActive: true,
        sessionStatus: true,
        deviceLabel: true,
        userAgent: true,
        metadata: true,
        createdAt: true,
        updatedAt: true
      }
    });

    await writeLiveCameraEvent({
      userId: user.id,
      actorUserId: req.user!.id,
      eventType: "CAMERA_SESSION_STARTED",
      liveCameraSessionId: session.id,
      metadata: {
        startedAt: session.startedAt.toISOString()
      }
    });

    return res.status(201).json({
      ...session,
      signalingPath: "/live-camera/ws"
    });
  })
);

liveCameraRouter.post(
  "/sessions/:id/stop",
  validateBody(stopCameraSessionSchema),
  asyncHandler(async (req, res) => {
    const sessionId = z.string().uuid().parse(req.params.id);
    const payload = req.body as z.infer<typeof stopCameraSessionSchema>;

    const session = await prisma.liveCameraSession.findUnique({
      where: {
        id: sessionId
      },
      select: {
        id: true,
        userId: true,
        isActive: true,
        sessionStatus: true,
        startedAt: true,
        endedAt: true
      }
    });

    if (!session) {
      return res.status(404).json({ message: "Camera session not found." });
    }

    const canManage = userCanViewControlRoom(req.user!.role);
    if (session.userId !== req.user!.id && !canManage) {
      return res.status(403).json({ message: "You are not allowed to stop this camera session." });
    }

    if (!session.isActive) {
      invalidateLiveCameraSessionSignaling({
        sessionId: session.id,
        targetUserId: session.userId,
        reason: "ALREADY_INACTIVE"
      });
      return res.json(session);
    }

    const now = new Date();
    const updated = await prisma.liveCameraSession.update({
      where: {
        id: session.id
      },
      data: {
        isActive: false,
        endedAt: now,
        sessionStatus: LiveCameraSessionStatus.ENDED,
        metadata: {
          reason: normalizeOptionalText(payload.reason) ?? "STOPPED_BY_USER",
          stoppedAt: now.toISOString()
        }
      },
      select: {
        id: true,
        userId: true,
        startedAt: true,
        endedAt: true,
        isActive: true,
        sessionStatus: true,
        metadata: true,
        createdAt: true,
        updatedAt: true
      }
    });

    await writeLiveCameraEvent({
      userId: session.userId,
      actorUserId: req.user!.id,
      eventType: "CAMERA_SESSION_STOPPED",
      liveCameraSessionId: session.id,
      metadata: {
        reason: normalizeOptionalText(payload.reason) ?? "STOPPED_BY_USER",
        stoppedAt: now.toISOString()
      }
    });

    invalidateLiveCameraSessionSignaling({
      sessionId: session.id,
      targetUserId: session.userId,
      reason: normalizeOptionalText(payload.reason) ?? "STOPPED_BY_USER"
    });

    return res.json(updated);
  })
);

liveCameraRouter.post(
  "/sessions/:id/state",
  validateBody(cameraSessionStateSchema),
  asyncHandler(async (req, res) => {
    const sessionId = z.string().uuid().parse(req.params.id);
    const payload = req.body as z.infer<typeof cameraSessionStateSchema>;

    const session = await prisma.liveCameraSession.findUnique({
      where: {
        id: sessionId
      },
      select: {
        id: true,
        userId: true,
        isActive: true,
        sessionStatus: true,
        endedAt: true,
        metadata: true
      }
    });

    if (!session) {
      return res.status(404).json({ message: "Camera session not found." });
    }

    if (session.userId !== req.user!.id) {
      return res.status(403).json({ message: "You are not allowed to update this camera session." });
    }

    const now = new Date();
    const terminal = TERMINAL_CAMERA_STATES.has(payload.sessionStatus);

    const mergedMetadata = {
      ...(session.metadata && typeof session.metadata === "object" ? (session.metadata as Record<string, unknown>) : {}),
      ...(payload.metadata ?? {}),
      lastStateUpdateAt: now.toISOString()
    };

    const updated = await prisma.liveCameraSession.update({
      where: {
        id: session.id
      },
      data: {
        sessionStatus: payload.sessionStatus,
        metadata: mergedMetadata as Prisma.InputJsonValue,
        isActive: terminal ? false : session.isActive,
        endedAt: terminal ? now : session.endedAt
      },
      select: {
        id: true,
        userId: true,
        startedAt: true,
        endedAt: true,
        isActive: true,
        sessionStatus: true,
        metadata: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (payload.sessionStatus === LiveCameraSessionStatus.PERMISSION_DENIED) {
      await writeLiveCameraEvent({
        userId: session.userId,
        actorUserId: req.user!.id,
        eventType: "CAMERA_PERMISSION_DENIED",
        liveCameraSessionId: session.id,
        metadata: {
          updatedAt: now.toISOString()
        }
      });
    } else if (payload.sessionStatus === LiveCameraSessionStatus.FAILED) {
      await writeLiveCameraEvent({
        userId: session.userId,
        actorUserId: req.user!.id,
        eventType: "CAMERA_STREAM_ENDED_UNEXPECTEDLY",
        liveCameraSessionId: session.id,
        metadata: {
          updatedAt: now.toISOString()
        }
      });
    } else if (terminal) {
      await writeLiveCameraEvent({
        userId: session.userId,
        actorUserId: req.user!.id,
        eventType: "CAMERA_SESSION_STOPPED",
        liveCameraSessionId: session.id,
        metadata: {
          updatedAt: now.toISOString(),
          status: payload.sessionStatus
        }
      });
    } else {
      await writeLiveCameraEvent({
        userId: session.userId,
        actorUserId: req.user!.id,
        eventType: "CAMERA_STATE_UPDATED",
        liveCameraSessionId: session.id,
        metadata: {
          updatedAt: now.toISOString(),
          status: payload.sessionStatus
        }
      });
    }

    if (terminal) {
      invalidateLiveCameraSessionSignaling({
        sessionId: session.id,
        targetUserId: session.userId,
        reason: payload.sessionStatus
      });
    }

    return res.json(updated);
  })
);

liveCameraRouter.get(
  "/sessions",
  validateQuery(listCameraSessionsQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as z.infer<typeof listCameraSessionsQuerySchema>;
    const canViewControlRoom = userCanViewControlRoom(req.user!.role);

    if (query.userId && !canViewControlRoom && query.userId !== req.user!.id) {
      return res.status(403).json({ message: "You are not allowed to query other users' camera sessions." });
    }

    const where: Prisma.LiveCameraSessionWhereInput = {
      userId: query.userId ?? (canViewControlRoom ? undefined : req.user!.id),
      isActive: query.includeInactive ? undefined : true,
      user: canViewControlRoom
        ? {
            isActive: true,
            visibleInControlRoom: true
          }
        : {
            isActive: true
          }
    };

    const rows = await prisma.liveCameraSession.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { startedAt: "desc" }],
      take: query.limit,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            role: true,
            canSendLiveCamera: true,
            visibleInControlRoom: true,
            liveLocationState: {
              select: {
                lastLatitude: true,
                lastLongitude: true,
                lastAccuracyM: true,
                lastReceivedAt: true,
                isSharing: true
              }
            }
          }
        }
      }
    });

    const nowMs = Date.now();
    return res.json(
      rows.map((row) => {
        const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
        const location = row.user.liveLocationState;

        return {
          id: row.id,
          userId: row.userId,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          isActive: row.isActive,
          sessionStatus: cameraStateBadge(row.sessionStatus, row.isActive),
          rawSessionStatus: row.sessionStatus,
          relatedLocationPointId: row.relatedLocationPointId,
          deviceLabel: row.deviceLabel,
          userAgent: row.userAgent,
          metadata: row.metadata,
          microphoneEnabled:
            typeof metadata.microphoneEnabled === "boolean" ? metadata.microphoneEnabled : null,
          emergency: typeof metadata.emergency === "boolean" ? metadata.emergency : false,
          user: {
            id: row.user.id,
            fullName: row.user.fullName,
            role: row.user.role,
            canSendLiveCamera: row.user.canSendLiveCamera,
            visibleInControlRoom: row.user.visibleInControlRoom
          },
          location: location
            ? {
                latitude: location.lastLatitude,
                longitude: location.lastLongitude,
                accuracyM: location.lastAccuracyM,
                lastReceivedAt: location.lastReceivedAt,
                isTrackingActive: location.isSharing,
                freshnessSeconds: location.lastReceivedAt
                  ? Math.max(0, Math.round((nowMs - location.lastReceivedAt.getTime()) / 1000))
                  : null
              }
            : null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        };
      })
    );
  })
);

liveCameraRouter.get(
  "/sessions/:id",
  asyncHandler(async (req, res) => {
    const sessionId = z.string().uuid().parse(req.params.id);
    const canViewControlRoom = userCanViewControlRoom(req.user!.role);

    const row = await prisma.liveCameraSession.findUnique({
      where: { id: sessionId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            role: true,
            canSendLiveCamera: true,
            visibleInControlRoom: true,
            liveLocationState: {
              select: {
                lastLatitude: true,
                lastLongitude: true,
                lastAccuracyM: true,
                lastReceivedAt: true,
                isSharing: true
              }
            }
          }
        }
      }
    });

    if (!row) {
      return res.status(404).json({ message: "Camera session not found." });
    }

    if (!canViewControlRoom && row.userId !== req.user!.id) {
      return res.status(403).json({ message: "You are not allowed to access this camera session." });
    }

    return res.json(row);
  })
);

liveCameraRouter.post(
  "/events",
  requireRoles(...CONTROL_ROOM_VIEW_ROLES),
  validateBody(logViewerEventSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof logViewerEventSchema>;

    const target = await prisma.user.findUnique({
      where: { id: payload.targetUserId },
      select: { id: true }
    });

    if (!target) {
      return res.status(404).json({ message: "Target user not found." });
    }

    const created = await writeLiveCameraEvent({
      userId: payload.targetUserId,
      actorUserId: req.user!.id,
      eventType: payload.eventType,
      liveCameraSessionId: payload.liveCameraSessionId ?? null,
      metadata: (payload.metadata ?? null) as Prisma.InputJsonValue | null
    });

    return res.status(201).json({
      id: created.id,
      createdAt: created.createdAt
    });
  })
);

liveCameraRouter.get(
  "/logs",
  requireRoles(...CONTROL_ROOM_VIEW_ROLES),
  validateQuery(listCameraLogsQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as z.infer<typeof listCameraLogsQuerySchema>;
    const eventTypes = parseCameraEventTypeList(query.eventType);
    if (query.eventType && !eventTypes) {
      return res.status(400).json({ message: "Invalid camera event type filter." });
    }

    const from = parseIsoDate(query.from);
    const to = parseIsoDate(query.to);
    if ((query.from && !from) || (query.to && !to)) {
      return res.status(400).json({ message: "Invalid date range." });
    }

    const where: Prisma.LiveCameraEventLogWhereInput = {
      userId: query.userId,
      actorUserId: query.actorUserId,
      eventType: eventTypes ? { in: eventTypes } : undefined,
      createdAt:
        from || to
          ? {
              gte: from ?? undefined,
              lte: to ?? undefined
            }
          : undefined
    };

    const skip = (query.page - 1) * query.pageSize;

    const [total, items] = await Promise.all([
      prisma.liveCameraEventLog.count({ where }),
      prisma.liveCameraEventLog.findMany({
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
          liveCameraSession: {
            select: {
              id: true,
              startedAt: true,
              endedAt: true,
              isActive: true,
              sessionStatus: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: query.pageSize
      })
    ]);

    return res.json({
      page: query.page,
      pageSize: query.pageSize,
      total,
      items
    });
  })
);

controlRoomRouter.get(
  "/overview",
  requireRoles(...CONTROL_ROOM_VIEW_ROLES),
  validateQuery(controlRoomOverviewQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as z.infer<typeof controlRoomOverviewQuerySchema>;

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
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
        canSendLiveCamera: true,
        visibleInControlRoom: true,
        liveLocationEnabled: true,
        liveLocationVisible: true,
        trustedDevice: {
          select: {
            id: true,
            isActive: true,
            deviceLabel: true,
            platform: true,
            lastSeenAt: true
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
        },
        liveCameraSessions: {
          orderBy: {
            startedAt: "desc"
          },
          take: 1,
          select: {
            id: true,
            startedAt: true,
            endedAt: true,
            isActive: true,
            sessionStatus: true,
            metadata: true
          }
        }
      },
      orderBy: [{ canSendLiveCamera: "desc" }, { liveLocationEnabled: "desc" }, { fullName: "asc" }],
      take: query.limit
    });

    const activeSessions = await prisma.liveCameraSession.findMany({
      where: {
        isActive: true,
        user: {
          isActive: true,
          visibleInControlRoom: true
        }
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            role: true,
            canSendLiveCamera: true,
            visibleInControlRoom: true,
            liveLocationState: {
              select: {
                isSharing: true,
                lastLatitude: true,
                lastLongitude: true,
                lastAccuracyM: true,
                lastRecordedAt: true,
                lastReceivedAt: true
              }
            }
          }
        }
      },
      orderBy: { startedAt: "desc" }
    });

    const activeIncidents = await prisma.incident.findMany({
      where: {
        status: {
          in: [...ACTIVE_INCIDENT_STATUSES]
        }
      },
      select: {
        id: true,
        incidentCode: true,
        title: true,
        type: true,
        priority: true,
        severity: true,
        status: true,
        locationLabel: true,
        locationLat: true,
        locationLng: true
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 250
    });
    const activeIncidentsCount = activeIncidents.length;

    const nowMs = Date.now();
    const activeSessionByUserId = new Map(activeSessions.map((session) => [session.userId, session]));

    const usersRows = users
      .map((user) => {
        const location = user.liveLocationState;
        const activeSession = activeSessionByUserId.get(user.id) ?? null;
        const latestSession = user.liveCameraSessions[0] ?? null;

        const trackingHealthState = computeTrackingHealthState({
          liveLocationEnabled: user.liveLocationEnabled,
          isSharing: Boolean(location?.isSharing),
          lastReceivedAt: location?.lastReceivedAt ?? null,
          staleAfterSeconds: query.staleAfterSeconds,
          offlineAfterSeconds: query.offlineAfterSeconds
        });

        const cameraStatus = activeSession
          ? cameraStateBadge(activeSession.sessionStatus, true)
          : latestSession
            ? cameraStateBadge(latestSession.sessionStatus, latestSession.isActive)
            : "OFFLINE";

        const metadata =
          activeSession?.metadata && typeof activeSession.metadata === "object"
            ? (activeSession.metadata as Record<string, unknown>)
            : {};

        return {
          userId: user.id,
          name: user.fullName,
          email: user.email,
          role: user.role,
          canSendLiveCamera: user.canSendLiveCamera,
          visibleInControlRoom: user.visibleInControlRoom,
          liveTrackingEnabled: user.liveLocationEnabled,
          liveTrackingVisible: user.liveLocationVisible,
          liveTrackingActive: Boolean(location?.isSharing),
          liveCameraActive: Boolean(activeSession),
          cameraStatus,
          microphoneEnabled:
            typeof metadata.microphoneEnabled === "boolean" ? metadata.microphoneEnabled : null,
          trustedDeviceAssigned: Boolean(user.trustedDevice?.isActive),
          trustedDevice: user.trustedDevice,
          lastGpsUpdate: location?.lastReceivedAt ?? null,
          lastKnownLocation: {
            latitude: location?.lastLatitude ?? null,
            longitude: location?.lastLongitude ?? null,
            accuracyM: location?.lastAccuracyM ?? null,
            source: location?.lastSource ?? null
          },
          trackingHealthState,
          activeCameraSessionId: activeSession?.id ?? null,
          lastCameraSessionAt: latestSession?.startedAt ?? null,
          lastCameraEndedAt: latestSession?.endedAt ?? null
        };
      })
      .filter((row) => (query.activeCameraOnly ? row.liveCameraActive : true))
      .filter((row) => (query.liveTrackingOnly ? row.liveTrackingEnabled : true));

    const mapUsers = usersRows
      .filter((row) => row.liveTrackingVisible)
      .filter((row) => row.lastKnownLocation.latitude != null && row.lastKnownLocation.longitude != null)
      .map((row) => ({
        userId: row.userId,
        fullName: row.name,
        role: row.role,
        latitude: row.lastKnownLocation.latitude,
        longitude: row.lastKnownLocation.longitude,
        accuracyM: row.lastKnownLocation.accuracyM,
        isTrackingActive: row.liveTrackingActive,
        trackingHealthState: row.trackingHealthState,
        lastGpsUpdate: row.lastGpsUpdate,
        freshnessSeconds: row.lastGpsUpdate
          ? Math.max(0, Math.round((nowMs - new Date(row.lastGpsUpdate).getTime()) / 1000))
          : null,
        hasActiveCamera: row.liveCameraActive,
        activeCameraSessionId: row.activeCameraSessionId,
        cameraStatus: row.cameraStatus,
        lastCameraSessionAt: row.lastCameraSessionAt,
        lastCameraEndedAt: row.lastCameraEndedAt
      }));

    const cameraSessions = activeSessions.map((session) => {
      const location = session.user.liveLocationState;
      const metadata =
        session.metadata && typeof session.metadata === "object"
          ? (session.metadata as Record<string, unknown>)
          : {};

      return {
        id: session.id,
        userId: session.userId,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        isActive: session.isActive,
        sessionStatus: cameraStateBadge(session.sessionStatus, session.isActive),
        rawSessionStatus: session.sessionStatus,
        metadata: session.metadata,
        microphoneEnabled:
          typeof metadata.microphoneEnabled === "boolean" ? metadata.microphoneEnabled : null,
        emergency: typeof metadata.emergency === "boolean" ? metadata.emergency : false,
        user: {
          id: session.user.id,
          fullName: session.user.fullName,
          role: session.user.role,
          canSendLiveCamera: session.user.canSendLiveCamera,
          visibleInControlRoom: session.user.visibleInControlRoom
        },
        location: location
          ? {
              latitude: location.lastLatitude,
              longitude: location.lastLongitude,
              accuracyM: location.lastAccuracyM,
              lastRecordedAt: location.lastRecordedAt,
              lastReceivedAt: location.lastReceivedAt,
              isTrackingActive: location.isSharing,
              freshnessSeconds: location.lastReceivedAt
                ? Math.max(0, Math.round((nowMs - location.lastReceivedAt.getTime()) / 1000))
                : null
            }
          : null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      };
    });

    const staleOrOfflineUsersCount = usersRows.filter(
      (row) => row.trackingHealthState === "STALE" || row.trackingHealthState === "OFFLINE"
    ).length;
    const emergencyStreamsCount = cameraSessions.filter((session) => session.emergency).length;

    return res.json({
      generatedAt: new Date(),
      summary: {
        totalTrackedUsers: mapUsers.length,
        totalLiveCameraUsers: cameraSessions.length,
        emergencyStreamsCount,
        staleOrOfflineUsersCount,
        activeIncidentsCount
      },
      incidentMarkers: activeIncidents
        .filter((incident) => incident.locationLat != null && incident.locationLng != null)
        .map((incident) => ({
          id: incident.id,
          incidentCode: incident.incidentCode,
          title: incident.title,
          type: incident.type,
          priority: incident.priority,
          severity: incident.severity,
          status: incident.status,
          locationLabel: incident.locationLabel,
          locationLat: incident.locationLat,
          locationLng: incident.locationLng
        })),
      mapUsers,
      cameraSessions,
      users: usersRows
    });
  })
);

