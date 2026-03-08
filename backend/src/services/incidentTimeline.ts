import { IncidentTimelineEventType, Prisma } from "@prisma/client";

export type IncidentTimelinePayload = {
  incidentId: string;
  eventType: IncidentTimelineEventType;
  message: string;
  metadata?: Prisma.InputJsonValue;
  createdById?: string | null;
};

export async function addIncidentTimelineEvent(
  tx: Prisma.TransactionClient,
  payload: IncidentTimelinePayload
) {
  return tx.incidentTimeline.create({
    data: {
      incidentId: payload.incidentId,
      eventType: payload.eventType,
      message: payload.message,
      metadata: payload.metadata ?? undefined,
      createdById: payload.createdById ?? null
    }
  });
}
