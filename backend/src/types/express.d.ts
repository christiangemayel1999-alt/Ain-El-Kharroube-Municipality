import { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface UserContext {
      id: string;
      email: string;
      role: Role;
      trustedDeviceId?: string | null;
    }

    interface Request {
      user?: UserContext;
    }
  }
}

export {};

