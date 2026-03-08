import { Routes } from "@angular/router";
import { authGuard } from "./guards/auth.guard";
import { roleGuard } from "./guards/role.guard";

export const routes: Routes = [
  {
    path: "live-tracking",
    canActivate: [authGuard],
    loadComponent: () =>
      import("./pages/share-location.page").then((m) => m.ShareLocationPageComponent)
  },
  {
    path: "share-location",
    pathMatch: "full",
    redirectTo: "live-tracking"
  },
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
    path: "incidents",
    canActivate: [authGuard],
    loadComponent: () => import("./pages/incidents.page").then((m) => m.IncidentsPageComponent)
  },
  {
    path: "incidents/:id",
    canActivate: [authGuard],
    loadComponent: () => import("./pages/incident-detail.page").then((m) => m.IncidentDetailPageComponent)
  },
  {
    path: "emergency-plans",
    canActivate: [authGuard, roleGuard],
    data: { roles: ["ADMIN", "CASE_WORKER"] },
    loadComponent: () => import("./pages/emergency-plans.page").then((m) => m.EmergencyPlansPageComponent)
  },
  {
    path: "response-units",
    canActivate: [authGuard, roleGuard],
    data: { roles: ["ADMIN", "CASE_WORKER", "POLICE"] },
    loadComponent: () => import("./pages/response-units.page").then((m) => m.ResponseUnitsPageComponent)
  },
  {
    path: "officer-notifications",
    canActivate: [authGuard, roleGuard],
    data: { roles: ["POLICE", "ADMIN", "CASE_WORKER"] },
    loadComponent: () =>
      import("./pages/officer-notifications.page").then((m) => m.OfficerNotificationsPageComponent)
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

