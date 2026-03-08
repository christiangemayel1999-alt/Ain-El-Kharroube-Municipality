import { CommonModule } from "@angular/common";
import { BreakpointObserver, Breakpoints } from "@angular/cdk/layout";
import { Component, OnDestroy, OnInit, effect, inject, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatSidenav, MatSidenavModule } from "@angular/material/sidenav";
import { MatToolbarModule } from "@angular/material/toolbar";
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { Subscription } from "rxjs";
import { Role } from "./models";
import { AuthService } from "./services/auth.service";
import { LiveCameraService } from "./services/live-camera.service";
import { LiveTrackingService } from "./services/live-tracking.service";
import { TrackingPingService } from "./services/tracking-ping.service";

type NavItem = {
  label: string;
  route: string;
  roles?: Role[];
  requiresLiveTracking?: boolean;
  requiresCameraSender?: boolean;
};

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatSidenavModule
  ],
  template: `
    <ng-container *ngIf="auth.isLoggedIn(); else loggedOutOutlet">
      <mat-sidenav-container class="app-shell">
        <mat-sidenav #mobileNav mode="over" class="mobile-nav">
          <div class="mobile-nav-header">
            <strong>Navigation</strong>
            <span *ngIf="auth.currentUser() as user">{{ user.fullName }} ({{ user.role }})</span>
          </div>
          <nav class="mobile-links">
            <a
              mat-button
              class="mobile-link"
              *ngFor="let item of navItems"
              [routerLink]="item.route"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: false }"
              (click)="closeMobileNav(mobileNav)"
              [hidden]="!canView(item)"
            >
              {{ item.label }}
            </a>
            <button mat-stroked-button color="warn" type="button" class="mobile-logout" (click)="logout(); closeMobileNav(mobileNav)">
              Logout
            </button>
          </nav>
        </mat-sidenav>

        <mat-sidenav-content>
          <mat-toolbar color="primary" class="topbar">
            <button
              mat-icon-button
              type="button"
              *ngIf="isMobile()"
              (click)="mobileNav.toggle()"
              aria-label="Open menu"
            >
              <mat-icon>menu</mat-icon>
            </button>

            <span class="title">Ain El Kharroube</span>

            <nav class="desktop-links" *ngIf="!isMobile()">
              <a
                mat-button
                *ngFor="let item of navItems"
                [routerLink]="item.route"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: false }"
                [hidden]="!canView(item)"
              >
                {{ item.label }}
              </a>
            </nav>

            <span class="spacer"></span>
            <button
              mat-stroked-button
              type="button"
              class="tracking-toggle"
              *ngIf="auth.currentUser()?.liveLocationEnabled"
              [disabled]="liveTracking.loading()"
              (click)="toggleLiveTracking()"
            >
              {{
                liveTracking.loading()
                  ? 'Working...'
                  : liveTracking.isSharing()
                    ? 'Stop GPS'
                    : 'Start GPS'
              }}
            </button>
            <span class="tracking-state" *ngIf="!isMobile() && auth.currentUser()?.liveLocationEnabled">
              {{ liveTracking.isSharing() ? 'GPS active' : 'GPS inactive' }}
            </span>
            <span class="user" *ngIf="!isMobile() && auth.currentUser() as user">{{ user.fullName }} ({{ user.role }})</span>
            <button mat-button type="button" (click)="logout()">Logout</button>
          </mat-toolbar>

          <section class="tracking-banner" *ngIf="liveTracking.showPrompt()">
            <p>Live tracking is available for your account. Do you want to start sharing your location?</p>
            <div class="tracking-actions">
              <button
                mat-raised-button
                color="primary"
                type="button"
                [disabled]="liveTracking.loading()"
                (click)="startLiveTrackingFromPrompt()"
              >
                Start sharing
              </button>
              <button mat-button type="button" (click)="dismissLiveTrackingPrompt()">Not now</button>
            </div>
            <p class="tracking-error" *ngIf="liveTracking.permissionError()">{{ liveTracking.permissionError() }}</p>
            <p class="tracking-error" *ngIf="liveTracking.error()">{{ liveTracking.error() }}</p>
          </section>

          <section class="ping-banner" *ngIf="trackingPing.activePing() as ping">
            <p><strong>Municipality is requesting your current location.</strong></p>
            <p>
              Requested {{ ping.createdAt | date:'HH:mm:ss' }}.
              Expires {{ ping.expiresAt | date:'HH:mm:ss' }}.
            </p>
            <p class="ping-message" *ngIf="ping.requestMessage">{{ ping.requestMessage }}</p>
            <div class="tracking-actions">
              <button
                mat-raised-button
                color="primary"
                type="button"
                [disabled]="trackingPing.sending()"
                (click)="respondToActivePing()"
              >
                {{ trackingPing.sending() ? 'Sending...' : 'Send location now' }}
              </button>
              <a mat-button [routerLink]="['/live-tracking/respond-ping', ping.id]">Open response page</a>
              <button mat-button type="button" (click)="dismissActivePing()">Dismiss</button>
              <button
                mat-stroked-button
                type="button"
                *ngIf="trackingPing.pushSupported() && trackingPing.pushPermission() !== 'denied' && !trackingPing.pushEnabled()"
                (click)="trackingPing.enablePushNotifications()"
              >
                Enable browser alerts
              </button>
            </div>
            <p class="tracking-error" *ngIf="trackingPing.error()">{{ trackingPing.error() }}</p>
            <p class="tracking-state-ok" *ngIf="trackingPing.message()">{{ trackingPing.message() }}</p>
          </section>

          <main class="app-content">
            <router-outlet></router-outlet>
          </main>
        </mat-sidenav-content>
      </mat-sidenav-container>
    </ng-container>

    <ng-template #loggedOutOutlet>
      <router-outlet></router-outlet>
    </ng-template>
  `,
  styles: [
    `
      .app-shell {
        min-height: 100dvh;
      }

      .topbar {
        min-height: var(--app-toolbar-height);
        position: sticky;
        top: 0;
        z-index: 1000;
        gap: 0.25rem;
        padding-inline: clamp(0.5rem, 1.8vw, 1rem);
      }

      .title {
        font-weight: 600;
        margin-right: 0.35rem;
        white-space: nowrap;
      }

      .desktop-links {
        display: flex;
        align-items: center;
        gap: 0.2rem;
        flex-wrap: wrap;
      }

      .spacer {
        flex: 1;
      }

      .tracking-toggle {
        margin-right: 0.4rem;
        border-color: rgba(255, 255, 255, 0.55);
      }

      .tracking-state {
        font-size: 0.82rem;
        margin-right: 0.5rem;
        opacity: 0.95;
      }

      .user {
        margin-right: 0.5rem;
        font-size: 0.9rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 28ch;
      }

      .active {
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      .mobile-nav {
        width: min(84vw, 320px);
        padding: 0.6rem;
      }

      .mobile-nav-header {
        display: grid;
        gap: 0.2rem;
        margin-bottom: 0.5rem;
      }

      .mobile-nav-header span {
        color: #475569;
        font-size: 0.82rem;
      }

      .mobile-links {
        display: grid;
        gap: 0.2rem;
      }

      .mobile-link {
        justify-content: flex-start;
        text-align: left;
      }

      .mobile-logout {
        margin-top: 0.4rem;
      }

      .app-content {
        min-height: calc(100dvh - var(--app-toolbar-height));
      }

      .tracking-banner {
        border-bottom: 1px solid #bfdbfe;
        background: #eff6ff;
        padding: 0.7rem clamp(0.7rem, 2vw, 1rem);
        display: grid;
        gap: 0.5rem;
      }

      .tracking-banner p {
        margin: 0;
        color: #1e3a8a;
      }

      .tracking-actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .tracking-error {
        color: #b91c1c !important;
        font-weight: 600;
      }

      .ping-banner {
        border-bottom: 1px solid #d9e1ea;
        background: #f8fafc;
        padding: 0.7rem clamp(0.7rem, 2vw, 1rem);
        display: grid;
        gap: 0.4rem;
      }

      .ping-banner p {
        margin: 0;
        color: #0f172a;
      }

      .ping-message {
        color: #334155 !important;
      }

      .tracking-state-ok {
        color: #166534 !important;
        font-weight: 600;
      }

      @media (max-width: 1023px) {
        .title {
          font-size: 1rem;
        }
      }
    `
  ]
})
export class AppComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  readonly liveCamera = inject(LiveCameraService);
  readonly liveTracking = inject(LiveTrackingService);
  readonly trackingPing = inject(TrackingPingService);
  private readonly router = inject(Router);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private breakpointSub?: Subscription;
  private readonly userSyncEffect = effect(() => {
    const user = this.auth.currentUser();
    this.liveTracking.syncAuthenticatedUser(user);
    this.trackingPing.syncAuthenticatedUser(user);
  });

  readonly isMobile = signal(false);
  readonly navItems: NavItem[] = [
    { label: "Dashboard", route: "/dashboard" },
    { label: "Live Tracking", route: "/live-tracking", requiresLiveTracking: true },
    { label: "Live Camera", route: "/live-camera", requiresCameraSender: true },
    { label: "Control Room", route: "/control-room", roles: ["ADMIN", "CASE_WORKER", "POLICE"] },
    { label: "Households", route: "/households" },
    { label: "Incidents", route: "/incidents" },
    { label: "Plans", route: "/emergency-plans", roles: ["ADMIN", "CASE_WORKER"] },
    { label: "Units", route: "/response-units", roles: ["ADMIN", "CASE_WORKER", "POLICE"] },
    { label: "Alerts", route: "/officer-notifications", roles: ["ADMIN", "CASE_WORKER", "POLICE"] },
    { label: "Tracking Ops", route: "/tracking-overview", roles: ["ADMIN", "CASE_WORKER", "POLICE"] },
    { label: "Tracking Logs", route: "/tracking-logs", roles: ["ADMIN", "CASE_WORKER", "POLICE"] },
    { label: "Camera Logs", route: "/live-camera-logs", roles: ["ADMIN", "CASE_WORKER", "POLICE"] },
    { label: "Cars", route: "/cars" },
    { label: "Users", route: "/users", roles: ["ADMIN"] }
  ];

  ngOnInit() {
    this.breakpointSub = this.breakpointObserver
      .observe([Breakpoints.Handset, "(max-width: 1023px)"])
      .subscribe((state) => this.isMobile.set(state.matches));

    if (this.auth.isLoggedIn()) {
      this.auth.me().subscribe({
        error: () => {
          this.liveCamera.prepareForLogout();
          this.liveTracking.prepareForLogout();
          this.trackingPing.prepareForLogout();
          this.auth.logout();
          void this.router.navigateByUrl("/login");
        }
      });
    }
  }

  ngOnDestroy() {
    this.breakpointSub?.unsubscribe();
    this.userSyncEffect.destroy();
  }

  canView(item: NavItem) {
    const user = this.auth.currentUser();
    if (item.requiresCameraSender && (!user?.canSendLiveCamera || !user?.visibleInControlRoom)) {
      return false;
    }

    if (!item.roles?.length) {
      return item.requiresLiveTracking ? Boolean(user?.liveLocationEnabled) : true;
    }
    const role = user?.role;
    if (!role) {
      return false;
    }
    if (!item.roles.includes(role)) {
      return false;
    }
    return item.requiresLiveTracking ? Boolean(this.auth.currentUser()?.liveLocationEnabled) : true;
  }

  closeMobileNav(drawer: MatSidenav) {
    if (this.isMobile()) {
      void drawer.close();
    }
  }

  logout() {
    this.liveCamera.prepareForLogout();
    this.liveTracking.prepareForLogout();
    this.trackingPing.prepareForLogout();
    this.auth.logout();
    void this.router.navigateByUrl("/login");
  }

  toggleLiveTracking() {
    if (this.liveTracking.isSharing()) {
      this.liveTracking.stopSharing();
      return;
    }
    this.liveTracking.startSharing();
  }

  startLiveTrackingFromPrompt() {
    this.liveTracking.startSharing();
  }

  dismissLiveTrackingPrompt() {
    this.liveTracking.dismissPrompt();
  }

  respondToActivePing() {
    const ping = this.trackingPing.activePing();
    if (!ping) {
      return;
    }
    void this.trackingPing.respondNow(ping.id);
  }

  dismissActivePing() {
    const ping = this.trackingPing.activePing();
    if (!ping) {
      return;
    }
    this.trackingPing.dismissPing(ping.id);
  }
}

