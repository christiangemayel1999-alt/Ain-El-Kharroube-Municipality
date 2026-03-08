import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = "ChangeMe123!";

const users: Array<{ email: string; fullName: string; role: Role }> = [
  { email: "admin@municipality.local", fullName: "Admin User", role: Role.ADMIN },
  { email: "caseworker1@municipality.local", fullName: "Case Worker One", role: Role.CASE_WORKER },
  { email: "caseworker2@municipality.local", fullName: "Case Worker Two", role: Role.CASE_WORKER },
  { email: "viewer@municipality.local", fullName: "Viewer User", role: Role.VIEWER },
  { email: "police1@municipality.local", fullName: "Police Officer One", role: Role.POLICE }
];

async function main() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        fullName: user.fullName,
        role: user.role,
        isActive: true,
        passwordHash
      },
      create: {
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: true,
        passwordHash
      }
    });
  }

  console.log("Local login accounts verified.");
  console.log("Use: admin@municipality.local / ChangeMe123!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

