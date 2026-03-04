import bcrypt from "bcrypt";
import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { asyncHandler } from "../utils/asyncHandler";

const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
  isActive: z.boolean().optional().default(true)
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(2).optional(),
  password: z.string().min(8).optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional()
});

export const usersRouter = Router();

usersRouter.use(requireRoles(Role.ADMIN));

usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      }
    });
    return res.json(users);
  })
);

usersRouter.post(
  "/",
  validateBody(createUserSchema),
  asyncHandler(async (req, res) => {
    const passwordHash = await bcrypt.hash(req.body.password, 10);
    const user = await prisma.user.create({
      data: {
        email: req.body.email,
        fullName: req.body.fullName,
        role: req.body.role,
        isActive: req.body.isActive,
        passwordHash
      },
      select: { id: true, email: true, fullName: true, role: true, isActive: true }
    });

    await writeAudit(req.user!.id, "CREATE", "User", user.id);
    return res.status(201).json(user);
  })
);

usersRouter.patch(
  "/:id",
  validateBody(updateUserSchema),
  asyncHandler(async (req, res) => {
    const data: Record<string, unknown> = { ...req.body };
    if (req.body.password) {
      data.passwordHash = await bcrypt.hash(req.body.password, 10);
      delete data.password;
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, email: true, fullName: true, role: true, isActive: true }
    });

    await writeAudit(req.user!.id, "UPDATE", "User", user.id);
    return res.json(user);
  })
);

usersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.user.delete({ where: { id: req.params.id } });
    await writeAudit(req.user!.id, "DELETE", "User", req.params.id);
    return res.status(204).send();
  })
);

