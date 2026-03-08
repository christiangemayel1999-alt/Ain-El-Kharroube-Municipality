import { TrackingPingStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { writeTrackingEvent } from "./trackingAudit";

export type TrackingHealthState = "ACTIVE" | "STALE" | "OFFLINE" | "NOT_ENABLED";

export const DEFAULT_PING_EXPIRATION_SECONDS = 180;
export const MIN_PING_EXPIRATION_SECONDS = 120;
export const MAX_PING_EXPIRATION_SECONDS = 300;
export const DEFAULT_TRACKING_STALE_AFTER_SECONDS = 120;
export const DEFAULT_TRACKING_OFFLINE_AFTER_SECONDS = 900;

export function computeTrackingHealthState(params: {
  liveLocationEnabled: boolean;
  isSharing: boolean;
  lastReceivedAt: Date | null;
  staleAfterSeconds: number;
  offlineAfterSeconds: number;
}) {
  if (!params.liveLocationEnabled) {
    return "NOT_ENABLED" as const;
  }

  if (!params.lastReceivedAt) {
    return "OFFLINE" as const;
  }

  const ageMs = Date.now() - params.lastReceivedAt.getTime();
  const staleMs = params.staleAfterSeconds * 1000;
  const offlineMs = Math.max(params.offlineAfterSeconds * 1000, staleMs + 1);

  if (params.isSharing && ageMs <= staleMs) {
    return "ACTIVE" as const;
  }

  if (ageMs <= offlineMs) {
    return "STALE" as const;
  }

  return "OFFLINE" as const;
}

export async function expireDueTrackingPings(limit = 250) {
  const now = new Date();
  const due = await prisma.locationPingRequest.findMany({
    where: {
      status: {
        in: [TrackingPingStatus.PENDING, TrackingPingStatus.OPENED]
      },
      expiresAt: {
        lt: now
      }
    },
    select: {
      id: true,
      targetUserId: true,
      requestedByUserId: true,
      status: true,
      expiresAt: true
    },
    orderBy: {
      expiresAt: "asc"
    },
    take: limit
  });

  let expiredCount = 0;

  for (const ping of due) {
    const updated = await prisma.locationPingRequest.updateMany({
      where: {
        id: ping.id,
        status: {
          in: [TrackingPingStatus.PENDING, TrackingPingStatus.OPENED]
        }
      },
      data: {
        status: TrackingPingStatus.EXPIRED,
        lastError: "PING_EXPIRED"
      }
    });

    if (updated.count < 1) {
      continue;
    }

    expiredCount += 1;

    await writeTrackingEvent({
      userId: ping.targetUserId,
      actorUserId: ping.requestedByUserId,
      eventType: "PING_EXPIRED",
      eventSummary: "Location ping expired before a valid response.",
      relatedPingRequestId: ping.id,
      metadata: {
        previousStatus: ping.status,
        expiresAt: ping.expiresAt.toISOString(),
        expiredAt: now.toISOString()
      }
    });
  }

  return expiredCount;
}

export function parseTrackingPingStatusList(raw: string | undefined) {
  if (!raw) {
    return null;
  }

  const parts = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (!parts.length) {
    return null;
  }

  const validStatuses = new Set(Object.values(TrackingPingStatus));
  const parsed = parts.map((value) => value.toUpperCase() as TrackingPingStatus);
  if (parsed.some((value) => !validStatuses.has(value))) {
    return null;
  }

  return Array.from(new Set(parsed));
}
