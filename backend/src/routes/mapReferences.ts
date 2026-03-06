import { MapReferenceType, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody, validateQuery } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { asyncHandler } from "../utils/asyncHandler";

const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Color must use #RRGGBB format");
const iconSchema = z.string().trim().min(1).max(12);

const mapReferenceSchema = z.object({
  name: z.string().trim().min(2).max(160),
  type: z.nativeEnum(MapReferenceType),
  description: z.string().trim().max(500).optional().nullable(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  color: colorSchema.optional().nullable(),
  icon: iconSchema.optional().nullable(),
  visible: z.coerce.boolean().default(true)
});

const mapReferencePatchSchema = mapReferenceSchema.partial();

const mapReferenceQuerySchema = z.object({
  visible: z.enum(["true", "false"]).optional(),
  type: z.nativeEnum(MapReferenceType).optional()
});

const duplicateToleranceDeg = 0.00005;

function optionalText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

export const mapReferencesRouter = Router();

mapReferencesRouter.get(
  "/",
  validateQuery(mapReferenceQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as z.infer<typeof mapReferenceQuerySchema>;
    const where: {
      visible?: boolean;
      type?: MapReferenceType;
    } = {};

    if (query.visible) {
      where.visible = query.visible === "true";
    }
    if (query.type) {
      where.type = query.type;
    }

    const references = await prisma.mapReference.findMany({
      where,
      orderBy: [{ type: "asc" }, { name: "asc" }, { createdAt: "desc" }]
    });

    return res.json(references);
  })
);

mapReferencesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const reference = await prisma.mapReference.findUnique({
      where: { id: req.params.id }
    });

    if (!reference) {
      return res.status(404).json({ message: "Map reference not found" });
    }

    return res.json(reference);
  })
);

mapReferencesRouter.post(
  "/",
  requireRoles(Role.ADMIN),
  validateBody(mapReferenceSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof mapReferenceSchema>;

    // Duplicate strategy: if same name+type is submitted at nearly the same point,
    // merge by updating the existing marker instead of creating another overlapping one.
    const duplicate = await prisma.mapReference.findFirst({
      where: {
        name: payload.name,
        type: payload.type,
        lat: {
          gte: payload.lat - duplicateToleranceDeg,
          lte: payload.lat + duplicateToleranceDeg
        },
        lng: {
          gte: payload.lng - duplicateToleranceDeg,
          lte: payload.lng + duplicateToleranceDeg
        }
      }
    });

    if (duplicate) {
      const updated = await prisma.mapReference.update({
        where: { id: duplicate.id },
        data: {
          description: optionalText(payload.description),
          lat: payload.lat,
          lng: payload.lng,
          color: optionalText(payload.color),
          icon: optionalText(payload.icon),
          visible: payload.visible
        }
      });
      await writeAudit(req.user!.id, "UPDATE", "MapReference", updated.id);
      return res.json(updated);
    }

    const created = await prisma.mapReference.create({
      data: {
        name: payload.name,
        type: payload.type,
        description: optionalText(payload.description),
        lat: payload.lat,
        lng: payload.lng,
        color: optionalText(payload.color),
        icon: optionalText(payload.icon),
        visible: payload.visible
      }
    });

    await writeAudit(req.user!.id, "CREATE", "MapReference", created.id);
    return res.status(201).json(created);
  })
);

mapReferencesRouter.patch(
  "/:id",
  requireRoles(Role.ADMIN),
  validateBody(mapReferencePatchSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof mapReferencePatchSchema>;
    if (!Object.keys(payload).length) {
      return res.status(400).json({ message: "No fields provided for update" });
    }

    const updated = await prisma.mapReference.update({
      where: { id: req.params.id },
      data: {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.type !== undefined ? { type: payload.type } : {}),
        ...(payload.description !== undefined ? { description: optionalText(payload.description) } : {}),
        ...(payload.lat !== undefined ? { lat: payload.lat } : {}),
        ...(payload.lng !== undefined ? { lng: payload.lng } : {}),
        ...(payload.color !== undefined ? { color: optionalText(payload.color) } : {}),
        ...(payload.icon !== undefined ? { icon: optionalText(payload.icon) } : {}),
        ...(payload.visible !== undefined ? { visible: payload.visible } : {})
      }
    });

    await writeAudit(req.user!.id, "UPDATE", "MapReference", updated.id);
    return res.json(updated);
  })
);

mapReferencesRouter.delete(
  "/:id",
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    await prisma.mapReference.delete({
      where: { id: req.params.id }
    });
    await writeAudit(req.user!.id, "DELETE", "MapReference", req.params.id);
    return res.status(204).send();
  })
);
