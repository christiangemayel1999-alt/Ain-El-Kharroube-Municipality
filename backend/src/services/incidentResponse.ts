import {
  DispatchStatus,
  EmergencyPlan,
  IncidentDispatch,
  IncidentPriority,
  IncidentStatus,
  IncidentTimelineEventType,
  Prisma,
  Role,
  UnitStatus,
  UnitType
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { addIncidentTimelineEvent } from "./incidentTimeline";

type ActivatePlanInput = {
  incidentId: string;
  emergencyPlanId: string;
  selectedUnitIds?: string[];
  customMessage?: string | null;
  actorId: string;
};

type DispatchAction = "ACKNOWLEDGE" | "EN_ROUTE" | "ARRIVED" | "COMPLETE";

function summarizeVehicle(vehicle: {
  color: string | null;
  brand: string | null;
  model: string | null;
  plateNumber: string | null;
} | null) {
  if (!vehicle) {
    return null;
  }

  const vehicleLabel = [vehicle.color, vehicle.brand, vehicle.model]
    .map((value) => (value ?? "").trim())
    .filter((value) => value.length > 0)
    .join(" ");
  const plate = (vehicle.plateNumber ?? "").trim();
  if (!vehicleLabel && !plate) {
    return null;
  }
  if (vehicleLabel && plate) {
    return `${vehicleLabel} (${plate})`;
  }
  return vehicleLabel || plate;
}

function defaultPlanMessage(plan: EmergencyPlan, override: string | null | undefined) {
  const custom = String(override ?? "").trim();
  if (custom.length > 0) {
    return custom;
  }
  const fallback = String(plan.defaultNotificationMessage ?? "").trim();
  if (fallback.length > 0) {
    return fallback;
  }
  return `Emergency plan "${plan.name}" has been activated. Proceed immediately and confirm receipt.`;
}

function dispatchStatusFromUnit(unitStatus: UnitStatus) {
  if (unitStatus === UnitStatus.AVAILABLE) {
    return DispatchStatus.NOTIFIED;
  }
  return DispatchStatus.UNAVAILABLE;
}

function normalizePriorityForSort(priority: IncidentPriority) {
  if (priority === IncidentPriority.HIGH) {
    return 3;
  }
  if (priority === IncidentPriority.MEDIUM) {
    return 2;
  }
  return 1;
}

async function selectUnitsForActivation(
  tx: Prisma.TransactionClient,
  planId: string,
  selectedUnitIds: string[] | undefined
) {
  if (selectedUnitIds && selectedUnitIds.length > 0) {
    return tx.responseUnit.findMany({
      where: { id: { in: selectedUnitIds } },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    });
  }

  const requiredSteps = await tx.emergencyPlanStep.findMany({
    where: { planId, isRequired: true },
    orderBy: { stepOrder: "asc" },
    select: { unitTypeRequired: true }
  });
  const requiredTypes = Array.from(new Set(requiredSteps.map((step) => step.unitTypeRequired)));

  if (!requiredTypes.length) {
    return tx.responseUnit.findMany({
      where: { status: UnitStatus.AVAILABLE },
      orderBy: { name: "asc" },
      take: 3
    });
  }

  const units = await tx.responseUnit.findMany({
    where: {
      OR: [
        { status: UnitStatus.AVAILABLE, type: { in: requiredTypes } },
        { status: { not: UnitStatus.AVAILABLE }, type: { in: requiredTypes } }
      ]
    },
    orderBy: [{ status: "asc" }, { name: "asc" }]
  });

  const picked: typeof units = [];
  for (const type of requiredTypes) {
    const exactMatch =
      units.find((unit) => unit.type === type && unit.status === UnitStatus.AVAILABLE) ??
      units.find((unit) => unit.type === type);
    if (exactMatch) {
      picked.push(exactMatch);
    }
  }
  return picked;
}

export async function activatePlanForIncident(input: ActivatePlanInput) {
  return prisma.$transaction(async (tx) => {
    const incident = await tx.incident.findUnique({
      where: { id: input.incidentId },
      include: {
        vehicle: true
      }
    });
    if (!incident) {
      throw new Error("Incident not found");
    }

    const plan = await tx.emergencyPlan.findUnique({
      where: { id: input.emergencyPlanId },
      include: {
        steps: { orderBy: { stepOrder: "asc" } },
        policePosts: true
      }
    });
    if (!plan) {
      throw new Error("Emergency plan not found");
    }

    const updatedIncident = await tx.incident.update({
      where: { id: incident.id },
      data: {
        emergencyPlanId: plan.id,
        status: IncidentStatus.ACTIVE_RESPONSE,
        activatedAt: new Date(),
        severity: plan.severity
      },
      include: {
        household: { select: { id: true, householdCode: true } },
        vehicle: true,
        emergencyPlan: {
          include: {
            steps: { orderBy: { stepOrder: "asc" } }
          }
        }
      }
    });

    const timelineEvents = [];
    timelineEvents.push(
      await addIncidentTimelineEvent(tx, {
        incidentId: incident.id,
        eventType: IncidentTimelineEventType.PLAN_ACTIVATED,
        message: `Plan "${plan.name}" activated.`,
        metadata: { emergencyPlanId: plan.id },
        createdById: input.actorId
      })
    );

    const candidateUnits = await selectUnitsForActivation(tx, plan.id, input.selectedUnitIds);
    const createdDispatches: IncidentDispatch[] = [];
    const createdNotifications = [];

    const messageBody = defaultPlanMessage(plan, input.customMessage);
    const vehicleSummary = summarizeVehicle(updatedIncident.vehicle);

    for (const unit of candidateUnits) {
      const dispatchStatus = dispatchStatusFromUnit(unit.status);
      const dispatch = await tx.incidentDispatch.create({
        data: {
          incidentId: incident.id,
          unitId: unit.id,
          officerId: unit.assignedOfficerId ?? null,
          status: dispatchStatus,
          notifiedAt: dispatchStatus === DispatchStatus.NOTIFIED ? new Date() : null,
          notes: dispatchStatus === DispatchStatus.UNAVAILABLE ? "Unit unavailable at dispatch time." : null
        }
      });
      createdDispatches.push(dispatch);

      if (dispatchStatus === DispatchStatus.NOTIFIED && unit.assignedOfficerId) {
        const incidentTitle = updatedIncident.title?.trim() || updatedIncident.incidentCode;
        const title =
          plan.defaultNotificationTitle?.trim() ||
          `Dispatch: ${plan.name}`;
        const messageLines = [
          `${incidentTitle}`,
          `Type: ${updatedIncident.type}`,
          `Severity: ${updatedIncident.severity}`,
          updatedIncident.locationLabel ? `Location: ${updatedIncident.locationLabel}` : null,
          vehicleSummary ? `Vehicle: ${vehicleSummary}` : null,
          `Action: ${messageBody}`
        ]
          .filter((line): line is string => Boolean(line))
          .join(" | ");

        const notification = await tx.notification.create({
          data: {
            userId: unit.assignedOfficerId,
            title,
            message: messageLines,
            emergencyPlanId: plan.id,
            policePostLabel: plan.policePosts[0]?.label ?? null,
            targetLat: updatedIncident.locationLat ?? plan.policePosts[0]?.lat ?? null,
            targetLng: updatedIncident.locationLng ?? plan.policePosts[0]?.lng ?? null,
            incidentId: updatedIncident.id,
            dispatchId: dispatch.id,
            incidentType: updatedIncident.type,
            incidentPriority: updatedIncident.priority,
            incidentSeverity: updatedIncident.severity,
            locationLabel: updatedIncident.locationLabel,
            vehicleSummary,
            actionRequired: messageBody,
            metadata: {
              incidentCode: updatedIncident.incidentCode,
              unitName: unit.name,
              unitType: unit.type
            }
          }
        });
        createdNotifications.push(notification);
      }

      if (dispatchStatus === DispatchStatus.NOTIFIED) {
        await tx.responseUnit.update({
          where: { id: unit.id },
          data: { status: UnitStatus.BUSY }
        });
      }
    }

    timelineEvents.push(
      await addIncidentTimelineEvent(tx, {
        incidentId: incident.id,
        eventType: IncidentTimelineEventType.NOTIFICATIONS_SENT,
        message: `Notifications sent to ${createdNotifications.length} officers.`,
        metadata: {
          dispatches: createdDispatches.length,
          notifications: createdNotifications.length
        },
        createdById: input.actorId
      })
    );

    const timeline = await tx.incidentTimeline.findMany({
      where: { incidentId: incident.id },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return {
      incident: updatedIncident,
      plan,
      dispatches: createdDispatches,
      notifications: createdNotifications,
      timeline
    };
  });
}

function dispatchActionConfig(action: DispatchAction) {
  if (action === "ACKNOWLEDGE") {
    return {
      status: DispatchStatus.ACKNOWLEDGED,
      eventType: IncidentTimelineEventType.OFFICER_ACKNOWLEDGED,
      message: "Officer acknowledged dispatch.",
      timestampField: "acknowledgedAt" as const
    };
  }
  if (action === "EN_ROUTE") {
    return {
      status: DispatchStatus.EN_ROUTE,
      eventType: IncidentTimelineEventType.UNIT_EN_ROUTE,
      message: "Unit is en route.",
      timestampField: "enRouteAt" as const
    };
  }
  if (action === "ARRIVED") {
    return {
      status: DispatchStatus.ARRIVED,
      eventType: IncidentTimelineEventType.UNIT_ARRIVED,
      message: "Unit arrived at location.",
      timestampField: "arrivedAt" as const
    };
  }
  return {
    status: DispatchStatus.COMPLETED,
    eventType: IncidentTimelineEventType.INCIDENT_RESOLVED,
    message: "Dispatch completed.",
    timestampField: "completedAt" as const
  };
}

export async function updateDispatchStatus(input: {
  dispatchId: string;
  action: DispatchAction;
  actorId: string;
  actorRole: Role;
  notes?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const dispatch = await tx.incidentDispatch.findUnique({
      where: { id: input.dispatchId },
      include: {
        incident: true,
        unit: true
      }
    });
    if (!dispatch) {
      throw new Error("Dispatch not found");
    }

    if (input.actorRole === Role.POLICE) {
      const assignedOfficerId = dispatch.officerId ?? null;
      if (assignedOfficerId && assignedOfficerId !== input.actorId) {
        throw new Error("Dispatch is assigned to another officer");
      }
    }

    const cfg = dispatchActionConfig(input.action);
    const now = new Date();
    const data: Prisma.IncidentDispatchUncheckedUpdateInput = {
      status: cfg.status,
      notes: input.notes !== undefined ? input.notes : dispatch.notes
    };
    if (cfg.timestampField === "acknowledgedAt") {
      data.acknowledgedAt = now;
      if (!dispatch.officerId && input.actorRole === Role.POLICE) {
        data.officerId = input.actorId;
      }
    }
    if (cfg.timestampField === "enRouteAt") {
      data.enRouteAt = now;
    }
    if (cfg.timestampField === "arrivedAt") {
      data.arrivedAt = now;
    }
    if (cfg.timestampField === "completedAt") {
      data.completedAt = now;
    }

    const updatedDispatch = await tx.incidentDispatch.update({
      where: { id: dispatch.id },
      data,
      include: {
        incident: true,
        unit: true
      }
    });

    if (cfg.status === DispatchStatus.COMPLETED) {
      await tx.responseUnit.update({
        where: { id: dispatch.unitId },
        data: { status: UnitStatus.AVAILABLE }
      });
    } else {
      await tx.responseUnit.update({
        where: { id: dispatch.unitId },
        data: { status: UnitStatus.BUSY }
      });
    }

    await addIncidentTimelineEvent(tx, {
      incidentId: dispatch.incidentId,
      eventType: cfg.eventType,
      message: `${cfg.message} (${updatedDispatch.unit.name})`,
      metadata: {
        dispatchId: dispatch.id,
        status: cfg.status
      },
      createdById: input.actorId
    });

    const openDispatches = await tx.incidentDispatch.findMany({
      where: { incidentId: dispatch.incidentId },
      select: { status: true }
    });
    const allFinished =
      openDispatches.length > 0 &&
      openDispatches.every(
        (item) => item.status === DispatchStatus.COMPLETED || item.status === DispatchStatus.UNAVAILABLE
      );

    if (allFinished) {
      await tx.incident.update({
        where: { id: dispatch.incidentId },
        data: {
          status: IncidentStatus.CONTAINED,
          resolvedAt: new Date()
        }
      });
      await addIncidentTimelineEvent(tx, {
        incidentId: dispatch.incidentId,
        eventType: IncidentTimelineEventType.INCIDENT_RESOLVED,
        message: "All dispatches completed or unavailable. Incident contained.",
        createdById: input.actorId
      });
    }

    const timeline = await tx.incidentTimeline.findMany({
      where: { incidentId: dispatch.incidentId },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return {
      dispatch: updatedDispatch,
      timeline,
      sortScore: normalizePriorityForSort(updatedDispatch.incident.priority)
    };
  });
}
