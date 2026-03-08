import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { ActivatedRoute, RouterModule } from "@angular/router";
import { LiveCameraEventType, LiveCameraLogRow, TrackingOverviewUser } from "../models";
import { ApiService } from "../services/api.service";

@Component({
  selector: "app-live-camera-logs-page",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule
  ],
  template: `
    <div class="shell">
      <mat-card>
        <div class="header">
          <h2>Live Camera Logs</h2>
          <div class="header-actions">
            <button mat-stroked-button type="button" (click)="reload()">Refresh</button>
            <a mat-button routerLink="/control-room">Control Room</a>
          </div>
        </div>

        <div class="filters">
          <mat-form-field appearance="outline">
            <mat-label>User</mat-label>
            <mat-select [(ngModel)]="userId" (selectionChange)="resetAndReload()">
              <mat-option value="">All users</mat-option>
              <mat-option *ngFor="let u of users()" [value]="u.userId">{{ u.name }} ({{ u.role }})</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Event type</mat-label>
            <mat-select [(ngModel)]="eventType" (selectionChange)="resetAndReload()">
              <mat-option value="">All events</mat-option>
              <mat-option *ngFor="let e of eventTypes" [value]="e">{{ e }}</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>From date</mat-label>
            <input matInput type="date" [(ngModel)]="fromDate" (change)="resetAndReload()" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>To date</mat-label>
            <input matInput type="date" [(ngModel)]="toDate" (change)="resetAndReload()" />
          </mat-form-field>
        </div>

        <p class="err" *ngIf="error()">{{ error() }}</p>
        <p class="muted" *ngIf="!rows().length && !error()">No camera logs found for current filters.</p>

        <div class="table-wrap" *ngIf="rows().length">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Actor</th>
                <th>Event</th>
                <th>Summary</th>
                <th>Session</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of rows()">
                <td data-label="Timestamp">{{ row.createdAt | date:'yyyy-MM-dd HH:mm:ss' }}</td>
                <td data-label="User">{{ row.user.fullName }}</td>
                <td data-label="Actor">{{ row.actorUser?.fullName || '-' }}</td>
                <td data-label="Event"><span class="badge">{{ row.eventType }}</span></td>
                <td data-label="Summary">{{ row.eventSummary || '-' }}</td>
                <td data-label="Session">{{ row.liveCameraSessionId ? row.liveCameraSessionId.slice(0, 8) : '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="pager">
          <button mat-stroked-button type="button" [disabled]="page <= 1" (click)="prevPage()">Previous</button>
          <span>Page {{ page }} / {{ totalPages() }}</span>
          <button mat-stroked-button type="button" [disabled]="page >= totalPages()" (click)="nextPage()">Next</button>
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
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
      }

      .header h2 {
        margin: 0;
      }

      .header-actions {
        display: flex;
        gap: 0.4rem;
      }

      .filters {
        margin-top: 0.8rem;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.55rem;
      }

      .table-wrap {
        margin-top: 0.8rem;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        text-align: left;
        border-bottom: 1px solid #e2e8f0;
        padding: 0.5rem;
      }

      .badge {
        border-radius: 999px;
        background: #e2e8f0;
        color: #1e293b;
        padding: 0.18rem 0.52rem;
        font-size: 0.72rem;
        font-weight: 700;
      }

      .pager {
        margin-top: 0.8rem;
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        align-items: center;
      }

      .muted {
        color: #64748b;
      }

      .err {
        color: #b91c1c;
      }

      @media (max-width: 1200px) {
        .filters {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 767px) {
        .filters {
          grid-template-columns: 1fr;
        }

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

        td {
          border: 0;
          display: flex;
          justify-content: space-between;
          gap: 0.6rem;
        }

        td::before {
          content: attr(data-label);
          font-weight: 700;
          color: #334155;
        }
      }
    `
  ]
})
export class LiveCameraLogsPageComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  readonly users = signal<TrackingOverviewUser[]>([]);
  readonly rows = signal<LiveCameraLogRow[]>([]);
  readonly error = signal<string | null>(null);
  readonly total = signal(0);

  readonly eventTypes: LiveCameraEventType[] = [
    "CAMERA_SESSION_STARTED",
    "CAMERA_SESSION_STOPPED",
    "CAMERA_PERMISSION_DENIED",
    "CAMERA_STREAM_ENDED_UNEXPECTEDLY",
    "VIEWER_OPENED_STREAM",
    "VIEWER_SWITCHED_STREAM",
    "STREAM_SELECTED_IN_CONTROL_ROOM",
    "TRUSTED_DEVICE_MISMATCH_BLOCKED_CAMERA_START",
    "CAMERA_STATE_UPDATED"
  ];

  userId = "";
  eventType = "";
  fromDate = "";
  toDate = "";
  page = 1;
  readonly pageSize = 50;

  constructor() {
    this.userId = String(this.route.snapshot.queryParamMap.get("userId") ?? "");
    this.loadUsers();
    this.reload();
  }

  totalPages() {
    const value = Math.ceil(this.total() / this.pageSize);
    return Math.max(1, value);
  }

  resetAndReload() {
    this.page = 1;
    this.reload();
  }

  prevPage() {
    if (this.page <= 1) {
      return;
    }
    this.page -= 1;
    this.reload();
  }

  nextPage() {
    if (this.page >= this.totalPages()) {
      return;
    }
    this.page += 1;
    this.reload();
  }

  reload() {
    this.error.set(null);
    this.api
      .getLiveCameraLogs({
        userId: this.userId || undefined,
        eventType: this.eventType || undefined,
        from: this.toIsoStart(this.fromDate),
        to: this.toIsoEnd(this.toDate),
        page: this.page,
        pageSize: this.pageSize
      })
      .subscribe({
        next: (response) => {
          this.rows.set(response.items);
          this.total.set(response.total);
        },
        error: (err) => {
          this.rows.set([]);
          this.total.set(0);
          this.error.set(String(err?.error?.message ?? "Could not load live camera logs."));
        }
      });
  }

  private loadUsers() {
    this.api.getTrackingUsersOverview({ limit: 300 }).subscribe({
      next: (response) => this.users.set(response.users),
      error: () => this.users.set([])
    });
  }

  private toIsoStart(date: string) {
    if (!date) {
      return undefined;
    }
    return `${date}T00:00:00.000Z`;
  }

  private toIsoEnd(date: string) {
    if (!date) {
      return undefined;
    }
    return `${date}T23:59:59.999Z`;
  }
}

