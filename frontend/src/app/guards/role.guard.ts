import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { Role } from "../models";
import { AuthService } from "../services/auth.service";

export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const expected = (route.data["roles"] as Role[] | undefined) ?? [];

  if (expected.length === 0 || auth.hasAnyRole(expected)) {
    return true;
  }

  return router.createUrlTree(["/dashboard"]);
};

