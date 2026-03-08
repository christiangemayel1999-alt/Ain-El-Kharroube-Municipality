import {
  EmergencySeverity,
  IncidentLocationSource,
  IncidentPriority,
  IncidentStatus,
  IncidentTimelineEventType,
  IncidentType,
  Prisma,
  Role
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { activatePlanForIncident } from "../services/incidentResponse";
import { addIncidentTimelineEvent } from "../services/incidentTimeline";
import { asyncHandler } from "../utils/asyncHandler";
import { createWithCodeRetry } from "../utils/code";

const vehicleSchema = z
  .object({
    vehicleType: z.string().trim().max(60).optional().nullable(),
    brand: z.string().trim().max(60).optional().nullable(),
    model: z.string().trim().max(60).optional().nullable(),
    color: z.string().trim().max(40).optional().nullable(),
    plateNumber: z.string().trim().max(40).optional().nullable(),
    registrationCountry: z.string().trim().max(60).optional().nullable(),
    directionOfTravel: z.string().trim().max(120).optional().nullable(),
    passengerCount: z.coerce.number().int().min(0).max(200).optional().nullable(),
    notes: z.string().trim().max(1200).optional().nullable(),
    photoUrl: z.string().trim().max(500).optional().nullable()
  })
  .strict();

const incidentSchemaBase = z.object({
  householdId: z.string().uuid().optional().nullable(),
  title: z.string().trim().max(180).optional().nullable(),
  type: z.nativeEnum(IncidentType),
  priority: z.nativeEnum(IncidentPriority),
  severity: z.nativeEnum(EmergencySeverity).default(EmergencySeverity.MEDIUM),
  description: z.string().trim().min(3).max(3000),
  assignedUserId: z.string().uuid().optional().nullable(),
  emergencyPlanId: z.string().uuid().optional().nullable(),
  locationLabel: z.string().trim().max(180).optional().nullable(),
  locationLat: z.number().min(-90).max(90).optional().nullable(),
  locationLng: z.number().min(-180).max(180).optional().nullable(),
  locationAccuracyM: z.number().min(0).max(5000).optional().nullable(),
  locationSource: z.nativeEnum(IncidentLocationSource).optional().nullable(),
  status: z.nativeEnum(IncidentStatus).default(IncidentStatus.REPORTED),
  dueDate: z.string().optional().nullable(),
  resolutionNotes: z.string().trim().max(3000).optional().nullable(),
  vehicle: vehicleSchema.optional().nullable()
});

const incidentSchema = incidentSchemaBase
  .superRefine((data, ctx) => {
    if ((data.locationLat == null) !== (data.locationLng == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "locationLat and locationLng must both be provided together"
      });
    }
    if (data.locationAccuracyM != null && (data.locationLat == null || data.locationLng == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "locationAccuracyM can only be provided together with locationLat and locationLng"
      });
    }
  });

const incidentPatchSchema = incidentSchemaBase
  .partial()
  .superRefine((data, ctx) => {
    if ((data.locationLat == null) !== (data.locationLng == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "locationLat and locationLng must both be provided together"
      });
    }
    if (data.locationAccuracyM != null && (data.locationLat == null || data.locationLng == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "locationAccuracyM can only be provided together with locationLat and locationLng"
      });
    }
  });

const activatePlanSchema = z.object({
  emergencyPlanId: z.string().uuid(),
  selectedUnitIds: z.array(z.string().uuid()).optional(),
  customMessage: z.string().trim().max(2000).optional().nullable()
});

export const incidentsRouter = Router();

incidentsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const incidents = await prisma.incident.findMany({
      include: {
        household: { select: { id: true, householdCode: true, headName: true } },
        assignedUser: { select: { id: true, fullName: true, email: true, role: true } },
        emergencyPlan: { select: { id: true, name: true, type: true, severity: true } },
        vehicle: true,
        dispatches: {
          include: {
            unit: true,
            officer: { select: { id: true, fullName: true, email: true, role: true } }
          },
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    return res.json(incidents);
  })
);

incidentsRouter.post(
  "/",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(incidentSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof incidentSchema>;

    const created = await prisma.$transaction(async (tx) =>
      createWithCodeRetry({
        model: "incident",
        create: async (incidentCode) => {
          const incident = await tx.incident.create({
            data: {
              incidentCode,
              householdId: payload.householdId ?? null,
              title: payload.title ?? null,
              type: payload.type,
              priority: payload.priority,
              severity: payload.severity,
              description: payload.description,
              assignedUserId: payload.assignedUserId ?? null,
              emergencyPlanId: payload.emergencyPlanId ?? null,
              locationLabel: payload.locationLabel ?? null,
              locationLat: payload.locationLat ?? null,
              locationLng: payload.locationLng ?? null,
              locationAccuracyM: payload.locationAccuracyM ?? null,
              locationSource: payload.locationSource ?? null,
              status: payload.status,
              dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
              resolutionNotes: payload.resolutionNotes ?? null
            },
            include: {
              vehicle: true
            }
          });

          if (payload.vehicle) {
            await tx.incidentVehicle.create({
              data: {
                incidentId: incident.id,
                ...payload.vehicle
              }
            });
          }

          await addIncidentTimelineEvent(tx, {
            incidentId: incident.id,
            eventType: IncidentTimelineEventType.INCIDENT_CREATED,
            message: "Incident created.",
            metadata: {
              type: incident.type,
              priority: incident.priority,
              status: incident.status
            },
            createdById: req.user!.id
          });

          if (payload.vehicle) {
            await addIncidentTimelineEvent(tx, {
              incidentId: incident.id,
              eventType: IncidentTimelineEventType.VEHICLE_UPDATED,
              message: "Vehicle details added.",
              createdById: req.user!.id
            });
          }

          return tx.incident.findUniqueOrThrow({
            where: { id: incident.id },
            include: {
              household: { select: { id: true, householdCode: true, headName: true } },
              assignedUser: { select: { id: true, fullName: true, email: true, role: true } },
              emergencyPlan: { select: { id: true, name: true, type: true, severity: true } },
              vehicle: true,
              dispatches: {
                include: {
                  unit: true,
                  officer: { select: { id: true, fullName: true, email: true, role: true } }
                },
                orderBy: { createdAt: "asc" }
              },
              timeline: {
                include: { createdBy: { select: { id: true, fullName: true, role: true } } },
                orderBy: { createdAt: "desc" }
              }
            }
          });
        }
      })
    );

    await writeAudit(req.user!.id, "CREATE", "Incident", created.id);
    return res.status(201).json(created);
  })
);

incidentsRouter.post(
  "/:id/activate-plan",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(activatePlanSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof activatePlanSchema>;
    let result;
    try {
      result = await activatePlanForIncident({
        incidentId: req.params.id,
        emergencyPlanId: payload.emergencyPlanId,
        selectedUnitIds: payload.selectedUnitIds,
        customMessage: payload.customMessage,
        actorId: req.user!.id
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not activate plan";
      if (message === "Incident not found" || message === "Emergency plan not found") {
        return res.status(404).json({ message });
      }
      throw error;
    }

    await writeAudit(req.user!.id, "ACTIVATE_PLAN", "Incident", req.params.id);
    return res.json(result);
  })
);

incidentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const incident = await prisma.incident.findUnique({
      where: { id: req.params.id },
      include: {
        household: { select: { id: true, householdCode: true, headName: true } },
        assignedUser: { select: { id: true, fullName: true, email: true, role: true } },
        emergencyPlan: {
          include: {
            steps: { orderBy: { stepOrder: "asc" } }
          }
        },
        vehicle: true,
        dispatches: {
          include: {
            unit: true,
            officer: { select: { id: true, fullName: true, email: true, role: true } }
          },
          orderBy: { createdAt: "asc" }
        },
        timeline: {
          include: { createdBy: { select: { id: true, fullName: true, role: true } } },
          orderBy: { createdAt: "desc" }
        },
        notifications: {
          orderBy: { createdAt: "desc" },
          take: 50
        }
      }
    });
    if (!incident) {
      return res.status(404).json({ message: "Incident not found" });
    }
    return res.json(incident);
  })
);

incidentsRouter.patch(
  "/:id",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(incidentPatchSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof incidentPatchSchema>;

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.incident.findUnique({
        where: { id: req.params.id },
        include: { vehicle: true }
      });
      if (!existing) {
        return null;
      }

      const status = payload.status ?? existing.status;
      const data: Prisma.IncidentUncheckedUpdateInput = {
        householdId: payload.householdId === undefined ? undefined : payload.householdId,
        title: payload.title === undefined ? undefined : payload.title,
        type: payload.type,
        priority: payload.priority,
        severity: payload.severity,
        description: payload.description,
        assignedUserId: payload.assignedUserId === undefined ? undefined : payload.assignedUserId,
        emergencyPlanId: payload.emergencyPlanId === undefined ? undefined : payload.emergencyPlanId,
        locationLabel: payload.locationLabel === undefined ? undefined : payload.locationLabel,
        locationLat: payload.locationLat === undefined ? undefined : payload.locationLat,
        locationLng: payload.locationLng === undefined ? undefined : payload.locationLng,
        locationAccuracyM:
          payload.locationAccuracyM === undefined ? undefined : payload.locationAccuracyM,
        locationSource: payload.locationSource === undefined ? undefined : payload.locationSource,
        status,
        dueDate: payload.dueDate === undefined ? undefined : payload.dueDate ? new Date(payload.dueDate) : null,
        resolutionNotes:
          payload.resolutionNotes === undefined ? undefined : payload.resolutionNotes
      };

      if (payload.status === IncidentStatus.ACTIVE_RESPONSE && !existing.activatedAt) {
        data.activatedAt = new Date();
      }
      if (payload.status === IncidentStatus.RESOLVED) {
        data.resolvedAt = new Date();
      }
      if (payload.status === IncidentStatus.CLOSED) {
        data.closedAt = new Date();
      }

      const incident = await tx.incident.update({
        where: { id: req.params.id },
        data
      });

      if (payload.vehicle !== undefined) {
        if (payload.vehicle === null) {
          await tx.incidentVehicle.deleteMany({
            where: { incidentId: incident.id }
          });
          await addIncidentTimelineEvent(tx, {
            incidentId: incident.id,
            eventType: IncidentTimelineEventType.VEHICLE_UPDATED,
            message: "Vehicle details removed.",
            createdById: req.user!.id
          });
        } else {
          await tx.incidentVehicle.upsert({
            where: { incidentId: incident.id },
            update: payload.vehicle,
            create: {
              incidentId: incident.id,
              ...payload.vehicle
            }
          });
          await addIncidentTimelineEvent(tx, {
            incidentId: incident.id,
            eventType: IncidentTimelineEventType.VEHICLE_UPDATED,
            message: existing.vehicle ? "Vehicle details updated." : "Vehicle details added.",
            createdById: req.user!.id
          });
        }
      }

      if (payload.status && payload.status !== existing.status) {
        const eventType =
          payload.status === IncidentStatus.CLOSED
            ? IncidentTimelineEventType.INCIDENT_CLOSED
            : payload.status === IncidentStatus.RESOLVED
              ? IncidentTimelineEventType.INCIDENT_RESOLVED
              : IncidentTimelineEventType.DISPATCH_STATUS_CHANGED;
        await addIncidentTimelineEvent(tx, {
          incidentId: incident.id,
          eventType,
          message: `Incident status changed from ${existing.status} to ${payload.status}.`,
          createdById: req.user!.id
        });
      }

      return tx.incident.findUniqueOrThrow({
        where: { id: incident.id },
        include: {
          household: { select: { id: true, householdCode: true, headName: true } },
          assignedUser: { select: { id: true, fullName: true, email: true, role: true } },
          emergencyPlan: {
            include: {
              steps: { orderBy: { stepOrder: "asc" } }
            }
          },
          vehicle: true,
          dispatches: {
            include: {
              unit: true,
              officer: { select: { id: true, fullName: true, email: true, role: true } }
            },
            orderBy: { createdAt: "asc" }
          },
          timeline: {
            include: { createdBy: { select: { id: true, fullName: true, role: true } } },
            orderBy: { createdAt: "desc" }
          }
        }
      });
    });

    if (!updated) {
      return res.status(404).json({ message: "Incident not found" });
    }

    await writeAudit(req.user!.id, "UPDATE", "Incident", updated.id);
    return res.json(updated);
  })
);

incidentsRouter.delete(
  "/:id",
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    await prisma.incident.delete({ where: { id: req.params.id } });
    await writeAudit(req.user!.id, "DELETE", "Incident", req.params.id);
    return res.status(204).send();
  })
);
