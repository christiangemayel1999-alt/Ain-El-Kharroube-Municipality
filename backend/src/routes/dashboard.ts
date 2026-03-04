import { FamilyCheckStatus, RentalAgreementStatus } from "@prisma/client";
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
      highPriorityIncidents,
      unverified,
      zones,
      householdsWithZone,
      mapHouseholds,
      expiringAgreements,
      activeEmergencyPlan
    ] = await Promise.all([
      prisma.household.findMany({ where: { status: "ACTIVE" } }),
      prisma.housingUnit.count({ where: { status: "OCCUPIED" } }),
      prisma.housingUnit.count({ where: { status: "AVAILABLE" } }),
      prisma.incident.findMany({
        where: { priority: "HIGH", status: { in: ["OPEN", "IN_PROGRESS"] } },
        orderBy: { createdAt: "desc" },
        take: 10
      }),
      prisma.household.findMany({
        where: { safetyCheckStatus: FamilyCheckStatus.PENDING },
        orderBy: { createdAt: "desc" },
        take: 10
      }),
      prisma.zone.findMany({ orderBy: { name: "asc" } }),
      prisma.household.findMany({ include: { zone: true } }),
      prisma.household.findMany({
        where: { status: "ACTIVE", approxLat: { not: null }, approxLng: { not: null } },
        select: {
          id: true,
          householdCode: true,
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
          needs: true,
          casePriority: true,
          safetyCheckStatus: true,
          hasCar: true,
          carModel: true,
          carColor: true,
          carPlate: true
        }
      }),
      prisma.rentalAgreement.findMany({
        where: {
          status: RentalAgreementStatus.ACTIVE,
          endDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
          }
        },
        include: { household: true, housingUnit: true },
        orderBy: { endDate: "asc" },
        take: 20
      }),
      prisma.emergencyPlan.findFirst({
        where: { isActive: true },
        include: {
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
        agreementsExpiringIn14Days: expiringAgreements,
        highPriorityIncidents,
        unverifiedHouseholds: unverified
      },
      mapMarkers: mapHouseholds.map((h) => ({
        ...h,
        needs: Array.isArray(h.needs) ? h.needs.map((n) => String(n)) : []
      })),
      recentArrivals: recentArrivals.slice(-20).reverse(),
      emergencyPlan: activeEmergencyPlan
    });
  })
);

