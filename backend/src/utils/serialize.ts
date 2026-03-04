import { Role } from "@prisma/client";

export function canViewRestrictedContact(role: Role) {
  return role === Role.ADMIN || role === Role.CASE_WORKER;
}

export function maskPhone(value: string | null) {
  if (!value) return null;
  if (value.length <= 4) return "****";
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}

