import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { env } from "./config/env";
import { httpLogger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { requireAuth } from "./middleware/auth";
import { errorHandler, notFound } from "./middleware/error";
import { authRouter } from "./routes/auth";
import { carsRouter } from "./routes/cars";
import { dashboardRouter } from "./routes/dashboard";
import { dispatchesRouter } from "./routes/dispatches";
import { emergencyPlansRouter } from "./routes/emergencyPlans";
import { exportsRouter } from "./routes/exports";
import { householdsRouter } from "./routes/households";
import { housingUnitsRouter } from "./routes/housingUnits";
import { incidentsRouter } from "./routes/incidents";
import { landlordsRouter } from "./routes/landlords";
import { locationRouter, locationsRouter } from "./routes/locations";
import { mapReferencesRouter } from "./routes/mapReferences";
import { notificationsRouter } from "./routes/notifications";
import { responseUnitsRouter } from "./routes/responseUnits";
import { rentalAgreementsRouter } from "./routes/rentalAgreements";
import { usersRouter } from "./routes/users";
import { zonesRouter } from "./routes/zones";
import { asyncHandler } from "./utils/asyncHandler";

export const app = express();

const defaultAllowedOrigins = ["http://localhost:4200"];
const configuredOrigins = [env.FRONTEND_ORIGIN, env.CLIENT_ORIGIN]
  .filter((value): value is string => Boolean(value))
  .flatMap((value) => value.split(","))
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const allowedOrigins = new Set([...defaultAllowedOrigins, ...configuredOrigins]);

function isAllowedOrigin(origin: string) {
  if (allowedOrigins.has(origin)) {
    return true;
  }

  // Allow Vercel preview/production domains like https://my-app.vercel.app
  return /^https:\/\/([a-zA-Z0-9-]+\.)*vercel\.app$/i.test(origin);
}

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Location-Token"],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
  })
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 500
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(httpLogger);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/location", locationRouter);

app.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        liveLocationEnabled: true,
        liveLocationVisible: true,
        trustedDevice: {
          select: {
            isActive: true,
            lastSeenAt: true
          }
        }
      }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    return res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
      liveLocationEnabled: user.liveLocationEnabled,
      liveLocationVisible: user.liveLocationVisible,
      trustedDeviceAssigned: Boolean(user.trustedDevice?.isActive),
      trustedDeviceLastSeenAt: user.trustedDevice?.lastSeenAt ?? null
    });
  })
);

app.use(requireAuth);
app.use("/live-tracking", locationRouter);
app.use("/users", usersRouter);
app.use("/zones", zonesRouter);
app.use("/households", householdsRouter);
app.use("/cars", carsRouter);
app.use("/housing-units", housingUnitsRouter);
app.use("/landlords", landlordsRouter);
app.use("/rental-agreements", rentalAgreementsRouter);
app.use("/incidents", incidentsRouter);
app.use("/emergency-plans", emergencyPlansRouter);
app.use("/notifications", notificationsRouter);
app.use("/map-references", mapReferencesRouter);
app.use("/dashboard", dashboardRouter);
app.use("/exports", exportsRouter);
app.use("/response-units", responseUnitsRouter);
app.use("/dispatches", dispatchesRouter);
app.use("/locations", locationsRouter);

app.use(notFound);
app.use(errorHandler);

