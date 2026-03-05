import { Routes } from "@angular/router";
import { authGuard } from "./guards/auth.guard";
import { roleGuard } from "./guards/role.guard";

export const routes: Routes = [
  {
    path: "login",
    loadComponent: () => import("./pages/login.page").then((m) => m.LoginPageComponent)
  },
  {
    path: "dashboard",
    canActivate: [authGuard],
    loadComponent: () => import("./pages/dashboard.page").then((m) => m.DashboardPageComponent)
  },
  {
    path: "households",
    canActivate: [authGuard],
    loadComponent: () => import("./pages/households.page").then((m) => m.HouseholdsPageComponent)
  },
  {
    path: "cars",
    canActivate: [authGuard],
    loadComponent: () => import("./pages/cars.page").then((m) => m.CarsPageComponent)
  },
  {
    path: "households/:id",
    canActivate: [authGuard, roleGuard],
    data: { roles: ["ADMIN", "CASE_WORKER", "VIEWER"] },
    loadComponent: () => import("./pages/household-detail.page").then((m) => m.HouseholdDetailPageComponent)
  },
  {
    path: "users",
    canActivate: [authGuard, roleGuard],
    data: { roles: ["ADMIN"] },
    loadComponent: () => import("./pages/users.page").then((m) => m.UsersPageComponent)
  },
  {
    path: "",
    pathMatch: "full",
    redirectTo: "dashboard"
  },
  {
    path: "**",
    redirectTo: "dashboard"
  }
];

