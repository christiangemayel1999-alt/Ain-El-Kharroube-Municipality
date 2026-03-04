import { PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext } from "@playwright/test";

const prisma = new PrismaClient();
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@municipality.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "Christian@123";

async function login(request: APIRequestContext, email: string, password: string) {
  const response = await request.post("/auth/login", {
    data: { email, password }
  });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return data.token as string;
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("Red-team regressions", () => {
  test("auth guard: no token and bad token return consistent 401 response", async ({ request }) => {
    const noTokenRes = await request.get("/households");
    expect(noTokenRes.status()).toBe(401);
    await expect(noTokenRes.json()).resolves.toMatchObject({ message: "Unauthorized" });

    const badTokenRes = await request.get("/households", {
      headers: authHeader("not-a-valid-token")
    });
    expect(badTokenRes.status()).toBe(401);
    await expect(badTokenRes.json()).resolves.toMatchObject({ message: "Unauthorized" });
  });

  test("auth guard: old token is blocked after deactivation", async ({ request }) => {
    const adminToken = await login(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const tempEmail = `qa-deactivate-${Date.now()}@municipality.local`;
    const tempPassword = "TempPass123!";

    const createdUserRes = await request.post("/users", {
      headers: authHeader(adminToken),
      data: {
        email: tempEmail,
        fullName: "QA Temp User",
        password: tempPassword,
        role: "VIEWER",
        isActive: true
      }
    });
    expect(createdUserRes.status()).toBe(201);
    const createdUser = await createdUserRes.json();

    const userToken = await login(request, tempEmail, tempPassword);
    const deactivateRes = await request.patch(`/users/${createdUser.id}`, {
      headers: authHeader(adminToken),
      data: { isActive: false }
    });
    expect(deactivateRes.ok()).toBeTruthy();

    const protectedRes = await request.get("/households", {
      headers: authHeader(userToken)
    });
    expect(protectedRes.status()).toBe(401);
    await expect(protectedRes.json()).resolves.toMatchObject({ message: "Unauthorized" });

    const cleanupRes = await request.delete(`/users/${createdUser.id}`, {
      headers: authHeader(adminToken)
    });
    expect(cleanupRes.status()).toBe(204);
  });

  test("auth guard: old token is blocked after account deletion", async ({ request }) => {
    const adminToken = await login(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const tempEmail = `qa-delete-${Date.now()}@municipality.local`;
    const tempPassword = "TempPass123!";

    const createdUserRes = await request.post("/users", {
      headers: authHeader(adminToken),
      data: {
        email: tempEmail,
        fullName: "QA Delete User",
        password: tempPassword,
        role: "VIEWER",
        isActive: true
      }
    });
    expect(createdUserRes.status()).toBe(201);
    const createdUser = await createdUserRes.json();

    const userToken = await login(request, tempEmail, tempPassword);
    const deleteRes = await request.delete(`/users/${createdUser.id}`, {
      headers: authHeader(adminToken)
    });
    expect(deleteRes.status()).toBe(204);

    const protectedRes = await request.get("/households", {
      headers: authHeader(userToken)
    });
    expect(protectedRes.status()).toBe(401);
    await expect(protectedRes.json()).resolves.toMatchObject({ message: "Unauthorized" });
  });

  test("auth guard: role changes apply immediately to already-issued token", async ({ request }) => {
    const adminToken = await login(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const tempEmail = `qa-role-${Date.now()}@municipality.local`;
    const tempPassword = "TempPass123!";

    const createdUserRes = await request.post("/users", {
      headers: authHeader(adminToken),
      data: {
        email: tempEmail,
        fullName: "QA Role User",
        password: tempPassword,
        role: "VIEWER",
        isActive: true
      }
    });
    expect(createdUserRes.status()).toBe(201);
    const createdUser = await createdUserRes.json();
    const userToken = await login(request, tempEmail, tempPassword);

    const promoteRes = await request.patch(`/users/${createdUser.id}`, {
      headers: authHeader(adminToken),
      data: { role: "ADMIN" }
    });
    expect(promoteRes.ok()).toBeTruthy();

    const adminRouteAsPromoted = await request.get("/users", {
      headers: authHeader(userToken)
    });
    expect(adminRouteAsPromoted.status()).toBe(200);

    const demoteRes = await request.patch(`/users/${createdUser.id}`, {
      headers: authHeader(adminToken),
      data: { role: "VIEWER" }
    });
    expect(demoteRes.ok()).toBeTruthy();

    const adminRouteAsDemoted = await request.get("/users", {
      headers: authHeader(userToken)
    });
    expect(adminRouteAsDemoted.status()).toBe(403);
    await expect(adminRouteAsDemoted.json()).resolves.toMatchObject({ message: "Forbidden" });

    const cleanupRes = await request.delete(`/users/${createdUser.id}`, {
      headers: authHeader(adminToken)
    });
    expect(cleanupRes.status()).toBe(204);
  });

  test("error handler: Prisma unique and not-found errors are safe and mapped", async ({ request }) => {
    const adminToken = await login(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    const duplicateRes = await request.post("/users", {
      headers: authHeader(adminToken),
      data: {
        email: ADMIN_EMAIL,
        fullName: "Duplicate Admin",
        password: "TempPass123!",
        role: "ADMIN",
        isActive: true
      }
    });
    expect(duplicateRes.status()).toBe(409);
    const duplicateBody = await duplicateRes.json();
    expect(String(duplicateBody.message)).toContain("Duplicate value");
    expect(String(duplicateBody.message)).not.toContain("prisma.");

    const missingId = "00000000-0000-0000-0000-000000000000";
    const missingRes = await request.delete(`/users/${missingId}`, {
      headers: authHeader(adminToken)
    });
    expect(missingRes.status()).toBe(404);
    await expect(missingRes.json()).resolves.toMatchObject({ message: "Record not found" });
  });

  test("error handler: validation, malformed JSON, and unknown server errors are safe", async ({ request }) => {
    const adminToken = await login(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    const validationRes = await request.post("/auth/login", {
      data: { email: "bad-email", password: "1" }
    });
    expect(validationRes.status()).toBe(400);
    await expect(validationRes.json()).resolves.toMatchObject({ message: "Validation failed" });

    const malformedJsonRes = await request.fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: "{\"email\":\"x@example.com\""
    });
    expect(malformedJsonRes.status()).toBe(400);
    await expect(malformedJsonRes.json()).resolves.toMatchObject({ message: "Malformed JSON" });

    const stamp = Date.now();
    const zone = await prisma.zone.upsert({
      where: { code: `QA-${stamp}` },
      update: { name: `QA Zone ${stamp}` },
      create: { code: `QA-${stamp}`, name: `QA Zone ${stamp}` }
    });
    const household = await prisma.household.create({
      data: {
        householdCode: `HH-QA-${stamp}`,
        arrivalDate: new Date("2026-03-01"),
        zoneId: zone.id,
        housingType: "HOST",
        familySize: 1,
        status: "ACTIVE"
      }
    });
    const unit = await prisma.housingUnit.create({
      data: {
        unitCode: `UNIT-QA-${stamp}`,
        zoneId: zone.id,
        type: "Apartment",
        rooms: 1,
        capacity: 2,
        condition: "Good",
        status: "AVAILABLE"
      }
    });
    const landlord = await prisma.landlord.create({
      data: {
        name: `QA Landlord ${stamp}`
      }
    });

    const unknownErrorRes = await request.post("/rental-agreements", {
      headers: authHeader(adminToken),
      data: {
        householdId: household.id,
        housingUnitId: unit.id,
        landlordId: landlord.id,
        startDate: "invalid-date-string",
        endDate: null,
        monthlyRent: 100,
        deposit: 0,
        status: "ACTIVE",
        notes: "qa unknown error test"
      }
    });
    expect(unknownErrorRes.status()).toBe(500);
    const unknownBody = await unknownErrorRes.json();
    expect(String(unknownBody.message)).toBe("Internal server error");
    expect(String(unknownBody.message)).not.toContain("prisma.");

    await prisma.landlord.delete({ where: { id: landlord.id } });
    await prisma.housingUnit.delete({ where: { id: unit.id } });
    await prisma.household.delete({ where: { id: household.id } });
    await prisma.zone.delete({ where: { id: zone.id } });
  });

  test("code generation: parallel incident creates avoid collisions", async ({ request }) => {
    const adminToken = await login(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const headers = authHeader(adminToken);
    const base = Date.now();

    const createRequests = Array.from({ length: 8 }).map((_, index) =>
      request.post("/incidents", {
        headers,
        data: {
          type: "OTHER",
          priority: "LOW",
          description: `qa-parallel-${base}-${index}`,
          status: "OPEN"
        }
      })
    );

    const responses = await Promise.all(createRequests);
    for (const res of responses) {
      expect(res.status()).toBe(201);
    }
    const payloads = await Promise.all(responses.map((res) => res.json()));
    const codes = payloads.map((item) => item.incidentCode);
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(codes.length);

    await Promise.all(
      payloads.map((item) =>
        request.delete(`/incidents/${item.id}`, {
          headers
        })
      )
    );
  });

  test("code generation: malformed historic code does not break next numeric generation", async ({ request }) => {
    const adminToken = await login(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const headers = authHeader(adminToken);
    const stamp = Date.now();

    const firstRes = await request.post("/incidents", {
      headers,
      data: {
        type: "OTHER",
        priority: "LOW",
        description: `qa-malformed-first-${stamp}`,
        status: "OPEN"
      }
    });
    expect(firstRes.status()).toBe(201);
    const first = await firstRes.json();

    await prisma.incident.update({
      where: { id: first.id },
      data: { incidentCode: `INC-BAD-${stamp}` }
    });

    const secondRes = await request.post("/incidents", {
      headers,
      data: {
        type: "OTHER",
        priority: "LOW",
        description: `qa-malformed-second-${stamp}`,
        status: "OPEN"
      }
    });
    expect(secondRes.status()).toBe(201);
    const second = await secondRes.json();
    expect(second.incidentCode).toMatch(/^INC-\d+$/);
    expect(second.incidentCode).not.toBe(`INC-BAD-${stamp}`);

    const cleanupFirst = await request.delete(`/incidents/${first.id}`, { headers });
    expect(cleanupFirst.status()).toBe(204);

    const cleanupSecond = await request.delete(`/incidents/${second.id}`, { headers });
    expect(cleanupSecond.status()).toBe(204);
  });
});
