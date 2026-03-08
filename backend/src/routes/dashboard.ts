import { FamilyCheckStatus } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export const dashboardRouter = Router();

dashboardRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const [
      activeHouseholds,
      occupiedUnits,
      availableUnits,
      pendingChecks,
      zones,
      householdsWithZone,
      mapHouseholds,
      mapReferences,
      activeEmergencyPlan,
      activeIncidents,
      responseUnits,
      activeDispatches
    ] = await Promise.all([
      prisma.household.findMany({ where: { status: "ACTIVE" } }),
      prisma.housingUnit.count({ where: { status: "OCCUPIED" } }),
      prisma.housingUnit.count({ where: { status: "AVAILABLE" } }),
      prisma.household.findMany({
        where: { safetyCheckStatus: FamilyCheckStatus.PENDING },
        include: { zone: true },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      prisma.zone.findMany({ orderBy: { name: "asc" } }),
      prisma.household.findMany({ include: { zone: true } }),
      prisma.household.findMany({
        where: { status: "ACTIVE", approxLat: { not: null }, approxLng: { not: null } },
        select: {
          id: true,
          householdCode: true,
          firstName: true,
          lastName: true,
          fatherName: true,
          motherName: true,
          civilIdentityNumber: true,
          phoneNumber: true,
          pinLabel: true,
          headName: true,
          originArea: true,
          zoneId: true,
          arrivalDate: true,
          approxLat: true,
          approxLng: true,
          pinPrecisionM: true,
          familySize: true,
          age0_4: true,
          age5_17: true,
          age18_59: true,
          age60plus: true,
          members: true,
          needs: true,
          casePriority: true,
          safetyCheckStatus: true,
          hasCar: true,
          carModel: true,
          carColor: true,
          carPlate: true
        }
      }),
      prisma.mapReference.findMany({
        where: { visible: true },
        orderBy: [{ type: "asc" }, { name: "asc" }]
      }),
      prisma.emergencyPlan.findFirst({
        where: { isActive: true },
        include: {
          steps: {
            orderBy: { stepOrder: "asc" }
          },
          policePosts: {
            orderBy: { createdAt: "asc" }
          },
          createdBy: {
            select: {
              id: true,
              fullName: true,
              email: true
            }
          }
        }
      }),
      prisma.incident.findMany({
        where: {
          status: {
            in: ["REPORTED", "ACTIVE_RESPONSE", "CONTAINED", "OPEN", "IN_PROGRESS"]
          }
        },
        include: {
          vehicle: true,
          emergencyPlan: {
            select: { id: true, name: true, type: true, severity: true }
          },
          dispatches: {
            include: {
              unit: true,
              officer: { select: { id: true, fullName: true, role: true } }
            },
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
          }
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 50
      }),
      prisma.responseUnit.findMany({
        include: {
          assignedOfficer: {
            select: { id: true, fullName: true, role: true }
          }
        },
        orderBy: [{ status: "asc" }, { type: "asc" }, { name: "asc" }]
      }),
      prisma.incidentDispatch.findMany({
        where: {
          status: {
            in: ["NOTIFIED", "ACKNOWLEDGED", "EN_ROUTE", "ARRIVED", "INVESTIGATING"]
          }
        },
        include: {
          incident: {
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
            }
          },
          unit: true,
          officer: { select: { id: true, fullName: true, role: true } }
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 100
      })
    ]);

    const totalIndividuals = activeHouseholds.reduce((sum, h) => sum + h.familySize, 0);
    const children0_17 = activeHouseholds.reduce((sum, h) => sum + h.age0_4 + h.age5_17, 0);
    const elderly60plus = activeHouseholds.reduce((sum, h) => sum + h.age60plus, 0);

    const householdsByZone = zones.map((zone) => ({
      zoneId: zone.id,
      zone: zone.name,
      value: householdsWithZone.filter((h) => h.zoneId === zone.id).length
    }));

    const individualsByZone = zones.map((zone) => ({
      zoneId: zone.id,
      zone: zone.name,
      value: householdsWithZone
        .filter((h) => h.zoneId === zone.id)
        .reduce((sum, h) => sum + h.familySize, 0)
    }));

    const needsCounter = new Map<string, number>();
    for (const household of householdsWithZone) {
      const needs = Array.isArray(household.needs) ? household.needs : [];
      for (const need of needs) {
        const key = String(need);
        needsCounter.set(key, (needsCounter.get(key) ?? 0) + 1);
      }
    }

    const needsBreakdown = Array.from(needsCounter.entries()).map(([name, value]) => ({ name, value }));

    const recentArrivals = householdsWithZone
      .filter((h) => h.arrivalDate >= new Date(Date.now() - 56 * 24 * 60 * 60 * 1000))
      .sort((a, b) => a.arrivalDate.getTime() - b.arrivalDate.getTime());

    const weekMap = new Map<string, number>();
    for (const household of recentArrivals) {
      const key = startOfWeek(household.arrivalDate).toISOString().slice(0, 10);
      weekMap.set(key, (weekMap.get(key) ?? 0) + 1);
    }

    const newArrivalsPerWeek = Array.from(weekMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, value]) => ({ week, value }));

    const zoneLabelBuckets = new Map<string, { zone: string; lat: number; lng: number; households: number }>();
    for (const household of householdsWithZone) {
      if (household.approxLat == null || household.approxLng == null || !household.zone) {
        continue;
      }
      const bucket = zoneLabelBuckets.get(household.zoneId);
      if (bucket) {
        bucket.lat += household.approxLat;
        bucket.lng += household.approxLng;
        bucket.households += 1;
      } else {
        zoneLabelBuckets.set(household.zoneId, {
          zone: household.zone.name,
          lat: household.approxLat,
          lng: household.approxLng,
          households: 1
        });
      }
    }

    const zoneLabels = Array.from(zoneLabelBuckets.entries()).map(([zoneId, bucket]) => ({
      zoneId,
      zone: bucket.zone,
      lat: bucket.lat / bucket.households,
      lng: bucket.lng / bucket.households,
      households: bucket.households
    }));

    return res.json({
      kpis: {
        totalHouseholdsActive: activeHouseholds.length,
        totalIndividuals,
        children0_17,
        elderly60plus,
        occupiedUnits,
        availableUnits
      },
      charts: {
        householdsByZone,
        individualsByZone,
        needsBreakdown,
        newArrivalsPerWeek
      },
      workQueue: {
        pendingChecks: pendingChecks.map((h) => ({
          id: h.id,
          householdCode: h.householdCode,
          firstName: h.firstName,
          lastName: h.lastName,
          headName: h.headName,
          zoneId: h.zoneId,
          zoneName: h.zone?.name ?? null,
          originArea: h.originArea,
          arrivalDate: h.arrivalDate,
          phoneNumber: h.phoneNumber,
          casePriority: h.casePriority
        }))
      },
      mapMarkers: mapHouseholds.map((h) => ({
        ...h,
        needs: Array.isArray(h.needs) ? h.needs.map((n) => String(n)) : []
      })),
      mapReferences,
      zoneLabels,
      recentArrivals: recentArrivals.slice(-20).reverse(),
      emergencyPlan: activeEmergencyPlan,
      activeIncidents,
      incidentMarkers: activeIncidents
        .filter((incident) => incident.locationLat !== null && incident.locationLng !== null)
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
          locationLng: incident.locationLng,
          vehicle: incident.vehicle
        })),
      responseUnits,
      activeDispatches
    });
  })
);

