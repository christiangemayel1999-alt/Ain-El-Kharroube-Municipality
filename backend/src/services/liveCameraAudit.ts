import { LiveCameraEventType, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type LiveCameraEventInput = {
  userId: string;
  actorUserId?: string | null;
  eventType: LiveCameraEventType;
  eventSummary?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  liveCameraSessionId?: string | null;
  createdAt?: Date;
};

const DEFAULT_EVENT_SUMMARY: Record<LiveCameraEventType, string> = {
  CAMERA_SESSION_STARTED: "Camera session started.",
  CAMERA_SESSION_STOPPED: "Camera session stopped.",
  CAMERA_PERMISSION_DENIED: "Camera permission denied.",
  CAMERA_STREAM_ENDED_UNEXPECTEDLY: "Camera stream ended unexpectedly.",
  VIEWER_OPENED_STREAM: "Viewer opened camera stream.",
  VIEWER_SWITCHED_STREAM: "Viewer switched focused camera stream.",
  STREAM_SELECTED_IN_CONTROL_ROOM: "Stream selected in Control Room.",
  TRUSTED_DEVICE_MISMATCH_BLOCKED_CAMERA_START: "Camera start blocked by trusted-device policy.",
  CAMERA_STATE_UPDATED: "Camera state updated."
};

export async function writeLiveCameraEvent(input: LiveCameraEventInput, client: DbClient = prisma) {
  return client.liveCameraEventLog.create({
    data: {
      userId: input.userId,
      actorUserId: input.actorUserId ?? null,
      eventType: input.eventType,
      eventSummary: input.eventSummary ?? DEFAULT_EVENT_SUMMARY[input.eventType],
      metadata: input.metadata ?? undefined,
      liveCameraSessionId: input.liveCameraSessionId ?? null,
      createdAt: input.createdAt
    }
  });
}

export async function writeLiveCameraEvents(inputs: LiveCameraEventInput[], client: DbClient = prisma) {
  if (!inputs.length) {
    return;
  }

  for (const input of inputs) {
    await writeLiveCameraEvent(input, client);
  }
}

