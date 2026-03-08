import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { ActivatedRoute, RouterModule } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { TrackingPingRequest } from "../models";
import { ApiService } from "../services/api.service";
import { TrackingPingService } from "../services/tracking-ping.service";

@Component({
  selector: "app-respond-tracking-ping-page",
  standalone: true,
  imports: [CommonModule, RouterModule, MatCardModule, MatButtonModule],
  template: `
    <div class="shell">
      <mat-card class="card">
        <h1>Location Requested by Municipality</h1>
        <p class="muted">
          This web flow captures and sends one current GPS point while the page is open.
        </p>

        <p class="error" *ngIf="error()">{{ error() }}</p>
        <p class="ok" *ngIf="message()">{{ message() }}</p>

        <ng-container *ngIf="ping() as row; else loadingTemplate">
          <div class="status-row">
            <span class="label">Status</span>
            <span class="badge" [class]="statusClass(row.status)">{{ row.status }}</span>
          </div>
          <div class="status-row">
            <span class="label">Requested at</span>
            <span>{{ row.createdAt | date:'yyyy-MM-dd HH:mm:ss' }}</span>
          </div>
          <div class="status-row">
            <span class="label">Expires at</span>
            <span>{{ row.expiresAt | date:'yyyy-MM-dd HH:mm:ss' }}</span>
          </div>
          <div class="status-row" *ngIf="row.respondedAt">
            <span class="label">Responded at</span>
            <span>{{ row.respondedAt | date:'yyyy-MM-dd HH:mm:ss' }}</span>
          </div>
          <p class="muted" *ngIf="row.requestMessage">{{ row.requestMessage }}</p>

          <div class="actions">
            <button
              mat-raised-button
              color="primary"
              type="button"
              (click)="sendLocationNow()"
              [disabled]="trackingPing.sending() || isResponseClosed(row)"
            >
              {{ trackingPing.sending() ? 'Sending...' : 'Send my location now' }}
            </button>
            <button mat-stroked-button type="button" (click)="reload()">Refresh status</button>
            <a mat-button routerLink="/live-tracking">Open live tracking</a>
          </div>

          <p class="muted" *ngIf="isResponseClosed(row)">
            This ping is no longer open for a fresh response.
          </p>
        </ng-container>
      </mat-card>
    </div>

    <ng-template #loadingTemplate>
      <p class="muted">Loading ping details...</p>
    </ng-template>
  `,
  styles: [
    `
      .shell {
        min-height: calc(100dvh - var(--app-toolbar-height));
        padding: clamp(0.8rem, 3vw, 1.4rem);
        display: grid;
        place-items: center;
        background: linear-gradient(165deg, #f8fafc 0%, #e8f4ff 100%);
      }

      .card {
        width: min(680px, 100%);
        display: grid;
        gap: 0.75rem;
      }

      h1 {
        margin: 0;
        font-size: 1.35rem;
      }

      .status-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.8rem;
        border-bottom: 1px dashed #dbe3ef;
        padding-bottom: 0.35rem;
      }

      .label {
        color: #475569;
        font-weight: 600;
      }

      .badge {
        border-radius: 999px;
        padding: 0.2rem 0.6rem;
        font-size: 0.75rem;
        font-weight: 700;
      }

      .badge.pending,
      .badge.opened {
        background: #dbeafe;
        color: #1e40af;
      }

      .badge.responded {
        background: #dcfce7;
        color: #166534;
      }

      .badge.failed {
        background: #fef3c7;
        color: #92400e;
      }

      .badge.expired,
      .badge.cancelled {
        background: #fee2e2;
        color: #991b1b;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem;
      }

      .muted {
        margin: 0;
        color: #475569;
      }

      .ok {
        margin: 0;
        color: #166534;
      }

      .error {
        margin: 0;
        color: #b91c1c;
      }

      @media (max-width: 700px) {
        .status-row {
          flex-direction: column;
          align-items: flex-start;
        }

        .actions button,
        .actions a {
          width: 100%;
        }
      }
    `
  ]
})
export class RespondTrackingPingPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  readonly trackingPing = inject(TrackingPingService);

  readonly ping = signal<TrackingPingRequest | null>(null);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);

  constructor() {
    void this.reload();
  }

  async reload() {
    const pingId = String(this.route.snapshot.paramMap.get("id") ?? "").trim();
    if (!pingId) {
      this.error.set("Missing ping identifier.");
      return;
    }

    try {
      const row = await firstValueFrom(this.api.getTrackingPing(pingId));
      this.ping.set(row);
      this.error.set(null);
      this.message.set(null);
      await this.trackingPing.markOpened(pingId);

      if (!this.isResponseClosed(row) && row.status !== "RESPONDED") {
        void this.tryAutoSend(row.id);
      }
    } catch (error: any) {
      this.ping.set(null);
      this.error.set(String(error?.error?.message ?? "Could not load tracking ping."));
    }
  }

  async sendLocationNow() {
    const row = this.ping();
    if (!row || this.isResponseClosed(row)) {
      return;
    }

    const ok = await this.trackingPing.respondNow(row.id);
    if (ok) {
      this.message.set("Location response sent.");
      this.error.set(null);
      await this.reload();
      return;
    }

    this.error.set(this.trackingPing.error() ?? "Could not send location.");
  }

  statusClass(status: string) {
    return status.toLowerCase();
  }

  isResponseClosed(row: TrackingPingRequest) {
    return row.status === "CANCELLED" || row.status === "EXPIRED" || row.status === "RESPONDED";
  }

  private async tryAutoSend(pingId: string) {
    try {
      if (!("permissions" in navigator) || !navigator.permissions?.query) {
        return;
      }
      const permissionStatus = await navigator.permissions.query({ name: "geolocation" as PermissionName });
      if (permissionStatus.state !== "granted") {
        return;
      }
      await this.trackingPing.respondNow(pingId);
      await this.reload();
    } catch {
      // Keep manual action available.
    }
  }
}
