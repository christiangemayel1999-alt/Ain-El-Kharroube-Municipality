import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { Router, RouterModule } from "@angular/router";
import { TrackingHealthState, TrackingOverviewUser } from "../models";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";

@Component({
  selector: "app-tracking-overview-page",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule
  ],
  template: `
    <div class="shell">
      <mat-card>
        <div class="header">
          <div>
            <h2>Tracking Overview</h2>
            <p class="muted">Live tracking operations panel with ping controls and health indicators.</p>
          </div>
          <div class="header-actions">
            <button mat-stroked-button type="button" (click)="refresh()">Refresh</button>
            <a mat-button routerLink="/tracking-logs">Open tracking logs</a>
          </div>
        </div>

        <div class="filters">
          <mat-form-field appearance="outline">
            <mat-label>Search user</mat-label>
            <input matInput [(ngModel)]="search" (ngModelChange)="refresh()" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Health filter</mat-label>
            <mat-select [(ngModel)]="healthFilter" (selectionChange)="refresh()">
              <mat-option value="ALL">All</mat-option>
              <mat-option value="ACTIVE">Active</mat-option>
              <mat-option value="STALE">Stale</mat-option>
              <mat-option value="OFFLINE">Offline</mat-option>
              <mat-option value="NOT_ENABLED">Not enabled</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Ping message (optional)</mat-label>
            <input matInput [(ngModel)]="pingMessage" />
          </mat-form-field>
        </div>

        <p class="ok" *ngIf="message()">{{ message() }}</p>
        <p class="error" *ngIf="error()">{{ error() }}</p>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Account</th>
                <th>Trusted device</th>
                <th>Tracking sender</th>
                <th>Visible on map</th>
                <th>Sharing</th>
                <th>Health</th>
                <th>Last location</th>
                <th>Last ping</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of users()">
                <td data-label="User">
                  <div><strong>{{ row.name }}</strong></div>
                  <div class="muted small">{{ row.role }} | {{ row.email }}</div>
                  <div class="muted small">Last online: {{ row.lastSeenOnlineAt ? (row.lastSeenOnlineAt | date:'yyyy-MM-dd HH:mm') : '-' }}</div>
                </td>
                <td data-label="Account">
                  <span class="badge" [class.ok-badge]="row.accountStatus === 'ACTIVE'" [class.err-badge]="row.accountStatus !== 'ACTIVE'">
                    {{ row.accountStatus }}
                  </span>
                </td>
                <td data-label="Trusted device">
                  <span class="badge" [class.ok-badge]="row.trustedDeviceAssigned" [class.warn-badge]="!row.trustedDeviceAssigned">
                    {{ row.trustedDeviceAssigned ? 'Assigned' : 'Not assigned' }}
                  </span>
                  <div class="muted small" *ngIf="row.trustedDevice">
                    {{ row.trustedDevice.deviceLabel || row.trustedDevice.platform || 'Browser device' }}
                  </div>
                </td>
                <td data-label="Tracking sender">{{ row.liveTrackingSenderEnabled ? 'Enabled' : 'Disabled' }}</td>
                <td data-label="Visible on map">{{ row.visibleOnLiveMap ? 'Yes' : 'No' }}</td>
                <td data-label="Sharing">{{ row.currentlySharing ? 'Yes' : 'No' }}</td>
                <td data-label="Health">
                  <span class="badge" [class]="healthClass(row.trackingHealthState)">{{ row.trackingHealthState }}</span>
                </td>
                <td data-label="Last location">
                  <div>{{ row.lastKnownLocationTime ? (row.lastKnownLocationTime | date:'yyyy-MM-dd HH:mm:ss') : '-' }}</div>
                  <div class="muted small">
                    {{ row.lastKnownLocation.latitude ?? '-' }}, {{ row.lastKnownLocation.longitude ?? '-' }}
                  </div>
                </td>
                <td data-label="Last ping">
                  <div>{{ row.lastPingStatus || '-' }}</div>
                  <div class="muted small">Requested: {{ row.lastPingRequestedAt ? (row.lastPingRequestedAt | date:'HH:mm:ss') : '-' }}</div>
                  <div class="muted small">Responded: {{ row.lastPingRespondedAt ? (row.lastPingRespondedAt | date:'HH:mm:ss') : '-' }}</div>
                </td>
                <td data-label="Actions" class="actions-cell">
                  <button mat-stroked-button type="button" [disabled]="busyUserId() === row.userId" (click)="pingUser(row.userId)">
                    Ping for location
                  </button>
                  <button mat-stroked-button type="button" (click)="openLogs(row.userId)">Logs</button>
                  <button
                    mat-stroked-button
                    type="button"
                    *ngIf="canManageConfig()"
                    [disabled]="busyUserId() === row.userId"
                    (click)="toggleLiveSender(row)"
                  >
                    {{ row.liveTrackingSenderEnabled ? 'Disable sender' : 'Enable sender' }}
                  </button>
                  <button
                    mat-stroked-button
                    type="button"
                    *ngIf="canManageConfig()"
                    [disabled]="busyUserId() === row.userId"
                    (click)="toggleLiveMap(row)"
                  >
                    {{ row.visibleOnLiveMap ? 'Hide on map' : 'Show on map' }}
                  </button>
                  <button
                    mat-stroked-button
                    color="warn"
                    type="button"
                    *ngIf="canManageConfig()"
                    [disabled]="busyUserId() === row.userId"
                    (click)="resetTrustedDevice(row.userId)"
                  >
                    Reset trusted device
                  </button>
                  <button
                    mat-stroked-button
                    type="button"
                    *ngIf="canManageConfig()"
                    [disabled]="busyUserId() === row.userId || !row.currentlySharing"
                    (click)="stopSession(row.userId)"
                  >
                    Stop session
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .shell {
        padding: var(--page-padding);
      }

      .header {
        display: flex;
        justify-content: space-between;
        gap: 0.8rem;
        flex-wrap: wrap;
      }

      .header h2 {
        margin: 0;
      }

      .header-actions {
        display: flex;
        gap: 0.4rem;
        align-items: center;
      }

      .filters {
        margin-top: 0.8rem;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.55rem;
      }

      .table-wrap {
        margin-top: 0.8rem;
        overflow-x: auto;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        border-bottom: 1px solid #e2e8f0;
        padding: 0.5rem;
        text-align: left;
        vertical-align: top;
      }

      .actions-cell {
        display: grid;
        gap: 0.35rem;
        min-width: 190px;
      }

      .badge {
        border-radius: 999px;
        font-size: 0.73rem;
        font-weight: 700;
        padding: 0.2rem 0.55rem;
      }

      .ok-badge {
        background: #dcfce7;
        color: #166534;
      }

      .warn-badge {
        background: #ffedd5;
        color: #9a3412;
      }

      .err-badge {
        background: #fee2e2;
        color: #991b1b;
      }

      .health-active {
        background: #dcfce7;
        color: #166534;
      }

      .health-stale {
        background: #fef3c7;
        color: #92400e;
      }

      .health-offline {
        background: #fee2e2;
        color: #991b1b;
      }

      .health-not_enabled {
        background: #e2e8f0;
        color: #334155;
      }

      .muted {
        color: #64748b;
      }

      .small {
        font-size: 0.76rem;
      }

      .ok {
        color: #166534;
      }

      .error {
        color: #b91c1c;
      }

      @media (max-width: 1080px) {
        .filters {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 767px) {
        table,
        tbody,
        tr,
        td {
          display: block;
          width: 100%;
        }

        thead {
          display: none;
        }

        tr {
          border-bottom: 1px solid #e2e8f0;
          padding: 0.55rem;
        }

        td {
          border: 0;
          padding: 0.35rem 0;
          display: flex;
          justify-content: space-between;
          gap: 0.6rem;
        }

        td::before {
          content: attr(data-label);
          font-weight: 700;
          color: #334155;
          font-size: 0.82rem;
        }
      }
    `
  ]
})
export class TrackingOverviewPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly users = signal<TrackingOverviewUser[]>([]);
  readonly busyUserId = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  search = "";
  healthFilter: TrackingHealthState | "ALL" = "ALL";
  pingMessage = "";

  constructor() {
    this.refresh();
  }

  canManageConfig() {
    return this.auth.currentUser()?.role === "ADMIN";
  }

  refresh() {
    this.error.set(null);
    this.api
      .getTrackingUsersOverview({
        search: this.search.trim() || undefined,
        health: this.healthFilter === "ALL" ? undefined : this.healthFilter
      })
      .subscribe({
        next: (response) => this.users.set(response.users),
        error: (err) => {
          this.error.set(String(err?.error?.message ?? "Could not load tracking overview."));
        }
      });
  }

  pingUser(userId: string) {
    this.busyUserId.set(userId);
    this.error.set(null);
    this.message.set(null);
    this.api.createTrackingPing(userId, this.pingMessage.trim() || undefined).subscribe({
      next: () => {
        this.busyUserId.set(null);
        this.message.set("Location ping sent.");
        this.refresh();
      },
      error: (err) => {
        this.busyUserId.set(null);
        this.error.set(String(err?.error?.message ?? "Could not send location ping."));
      }
    });
  }

  toggleLiveSender(row: TrackingOverviewUser) {
    this.updateUser(row.userId, { liveLocationEnabled: !row.liveTrackingSenderEnabled });
  }

  toggleLiveMap(row: TrackingOverviewUser) {
    this.updateUser(row.userId, { liveLocationVisible: !row.visibleOnLiveMap });
  }

  resetTrustedDevice(userId: string) {
    this.busyUserId.set(userId);
    this.error.set(null);
    this.message.set(null);
    this.api.resetTrustedDevice(userId).subscribe({
      next: () => {
        this.busyUserId.set(null);
        this.message.set("Trusted device reset.");
        this.refresh();
      },
      error: (err) => {
        this.busyUserId.set(null);
        this.error.set(String(err?.error?.message ?? "Could not reset trusted device."));
      }
    });
  }

  stopSession(userId: string) {
    this.busyUserId.set(userId);
    this.error.set(null);
    this.message.set(null);
    this.api.stopTrackingSession(userId).subscribe({
      next: () => {
        this.busyUserId.set(null);
        this.message.set("Active session stopped.");
        this.refresh();
      },
      error: (err) => {
        this.busyUserId.set(null);
        this.error.set(String(err?.error?.message ?? "Could not stop tracking session."));
      }
    });
  }

  openLogs(userId: string) {
    void this.router.navigate(["/tracking-logs"], { queryParams: { userId } });
  }

  healthClass(state: TrackingHealthState) {
    return `health-${state.toLowerCase()}`;
  }

  private updateUser(userId: string, payload: { liveLocationEnabled?: boolean; liveLocationVisible?: boolean }) {
    this.busyUserId.set(userId);
    this.error.set(null);
    this.message.set(null);

    this.api.updateUser(userId, payload).subscribe({
      next: () => {
        this.busyUserId.set(null);
        this.message.set("User tracking settings updated.");
        this.refresh();
      },
      error: (err) => {
        this.busyUserId.set(null);
        this.error.set(String(err?.error?.message ?? "Could not update user settings."));
      }
    });
  }
}
