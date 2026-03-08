import { Prisma, PrismaClient, TrackingEventType } from "@prisma/client";
import { prisma } from "../lib/prisma";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type TrackingEventInput = {
  userId: string;
  actorUserId?: string | null;
  eventType: TrackingEventType;
  eventSummary?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  relatedPingRequestId?: string | null;
  relatedSessionId?: string | null;
  relatedTrustedDeviceId?: string | null;
  createdAt?: Date;
};

const DEFAULT_EVENT_SUMMARY: Record<TrackingEventType, string> = {
  TRUSTED_DEVICE_ASSIGNED: "Trusted device assigned.",
  TRUSTED_DEVICE_RESET: "Trusted device reset.",
  LIVE_TRACKING_STARTED: "Live tracking started.",
  LIVE_TRACKING_STOPPED: "Live tracking stopped.",
  LIVE_TRACKING_UPDATE_RECEIVED: "Live tracking update received.",
  LIVE_TRACKING_BECAME_STALE: "Live tracking became stale.",
  PING_REQUESTED: "Location ping requested.",
  PING_NOTIFICATION_DELIVERED: "Ping notification delivered.",
  PING_OPENED: "Ping opened by user.",
  PING_LOCATION_RESPONDED: "Ping responded with location.",
  PING_EXPIRED: "Ping expired.",
  PING_CANCELLED: "Ping cancelled.",
  PING_FAILED: "Ping failed.",
  GEOLOCATION_PERMISSION_DENIED: "Geolocation permission denied.",
  GEOLOCATION_UNAVAILABLE: "Geolocation unavailable.",
  USER_HIDDEN_FROM_MAP: "User hidden from live map.",
  TRACKING_SENDER_DISABLED: "Tracking sender disabled.",
  UNAUTHORIZED_TRACKING_ACTION_ATTEMPT: "Unauthorized tracking action attempt.",
  STOP_ACTIVE_TRACKING_SESSION: "Active tracking session stopped by operator.",
  PUSH_SUBSCRIPTION_REGISTERED: "Push subscription registered.",
  PUSH_SUBSCRIPTION_REMOVED: "Push subscription removed.",
  PUSH_NOTIFICATION_FAILED: "Push notification delivery failed."
};

export async function writeTrackingEvent(input: TrackingEventInput, client: DbClient = prisma) {
  return client.trackingEventLog.create({
    data: {
      userId: input.userId,
      actorUserId: input.actorUserId ?? null,
      eventType: input.eventType,
      eventSummary: input.eventSummary ?? DEFAULT_EVENT_SUMMARY[input.eventType],
      metadata: input.metadata ?? undefined,
      relatedPingRequestId: input.relatedPingRequestId ?? null,
      relatedSessionId: input.relatedSessionId ?? null,
      relatedTrustedDeviceId: input.relatedTrustedDeviceId ?? null,
      createdAt: input.createdAt
    }
  });
}

export async function writeTrackingEvents(inputs: TrackingEventInput[], client: DbClient = prisma) {
  if (!inputs.length) {
    return;
  }

  for (const input of inputs) {
    await writeTrackingEvent(input, client);
  }
}
