import { CommonModule, DatePipe } from "@angular/common";
import { Component, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { AuthService } from "../services/auth.service";
import { LiveTrackingService } from "../services/live-tracking.service";

@Component({
  selector: "app-share-location-page",
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, DatePipe],
  template: `
    <div class="share-shell">
      <mat-card class="share-card">
        <h1>Live Tracking</h1>
        <p class="muted">
          Start or stop your in-app GPS sharing for the operations dashboard.
        </p>

        <ng-container *ngIf="auth.currentUser()?.liveLocationEnabled; else notEligible">
          <p class="status-badge" [class.active]="liveTracking.isSharing()" [class.inactive]="!liveTracking.isSharing()">
            {{ liveTracking.isSharing() ? 'Tracking is active' : 'Tracking is stopped' }}
          </p>

          <p class="meta" *ngIf="liveTracking.lastSentAt(); else noSentYet">
            Last sent at: {{ liveTracking.lastSentAt() | date:'HH:mm:ss' }}
          </p>
          <ng-template #noSentYet>
            <p class="meta">Last sent at: not sent yet</p>
          </ng-template>

          <p class="error" *ngIf="liveTracking.permissionError()">{{ liveTracking.permissionError() }}</p>
          <p class="error" *ngIf="liveTracking.error()">{{ liveTracking.error() }}</p>
          <p class="ok" *ngIf="liveTracking.message()">{{ liveTracking.message() }}</p>

          <div class="actions">
            <button
              mat-raised-button
              color="primary"
              type="button"
              (click)="liveTracking.startSharing()"
              [disabled]="liveTracking.loading() || liveTracking.isSharing()"
            >
              {{ liveTracking.loading() ? 'Starting...' : 'Start sharing location' }}
            </button>
            <button
              mat-stroked-button
              color="warn"
              type="button"
              (click)="liveTracking.stopSharing()"
              [disabled]="liveTracking.loading() || !liveTracking.isSharing()"
            >
              Stop sharing
            </button>
          </div>

          <p class="footnote">
            Keep this page or the app open on your device for more reliable GPS updates.
          </p>
        </ng-container>

        <ng-template #notEligible>
          <p class="error">Live tracking is not enabled for your account.</p>
          <p class="muted">Contact an administrator to enable live tracking sender access.</p>
        </ng-template>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .share-shell {
        min-height: calc(100dvh - var(--app-toolbar-height));
        padding: clamp(0.75rem, 4vw, 1.5rem);
        display: grid;
        place-items: center;
        background: linear-gradient(160deg, #f5faf7 0%, #e6f2ff 100%);
      }

      .share-card {
        width: min(560px, 100%);
        padding: clamp(0.85rem, 2.4vw, 1.3rem);
        display: grid;
        gap: 0.75rem;
      }

      h1 {
        margin: 0;
        font-size: 1.45rem;
      }

      .muted {
        margin: 0;
        color: #475569;
      }

      .status-badge {
        margin: 0;
        border-radius: 999px;
        padding: 0.5rem 0.8rem;
        font-weight: 600;
        display: inline-flex;
      }

      .status-badge.active {
        background: #dcfce7;
        color: #166534;
      }

      .status-badge.inactive {
        background: #fee2e2;
        color: #991b1b;
      }

      .meta {
        margin: 0;
        color: #0f172a;
        font-size: 0.95rem;
      }

      .actions {
        display: grid;
        gap: 0.6rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .actions button {
        min-height: 44px;
      }

      .error {
        margin: 0;
        color: #b91c1c;
        font-weight: 600;
      }

      .ok {
        margin: 0;
        color: #166534;
        font-weight: 600;
      }

      .footnote {
        margin: 0;
        font-size: 0.86rem;
        color: #334155;
      }

      @media (max-width: 600px) {
        .actions {
          grid-template-columns: 1fr;
        }

        h1 {
          font-size: 1.3rem;
        }
      }
    `
  ]
})
export class ShareLocationPageComponent {
  readonly auth = inject(AuthService);
  readonly liveTracking = inject(LiveTrackingService);
}
