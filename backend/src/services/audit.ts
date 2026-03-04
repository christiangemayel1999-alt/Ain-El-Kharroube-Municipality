import { prisma } from "../lib/prisma";

export async function writeAudit(userId: string, action: string, entity: string, entityId: string) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      entity,
      entityId
    }
  });
}

