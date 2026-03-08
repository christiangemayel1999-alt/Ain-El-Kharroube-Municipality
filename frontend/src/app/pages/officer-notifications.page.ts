import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { RouterModule } from "@angular/router";
import { NotificationItem } from "../models";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";

@Component({
  selector: "app-officer-notifications-page",
  standalone: true,
  imports: [CommonModule, RouterModule, MatCardModule, MatButtonModule],
  template: `
    <div class="shell">
      <mat-card>
        <div class="header-row">
          <h2>Officer Notifications</h2>
          <div class="actions">
            <button mat-stroked-button type="button" (click)="loadNotifications(true)">Unread only</button>
            <button mat-button type="button" (click)="loadNotifications(false)">All</button>
          </div>
        </div>
        <p class="err" *ngIf="error()">{{ error() }}</p>
        <div class="list">
          <div class="item" *ngFor="let n of notifications()">
            <div>
              <strong [class.unread]="!n.isRead">{{ n.title }}</strong>
              <div>{{ n.message }}</div>
              <div class="meta">
                <span *ngIf="n.locationLabel">📍 {{ n.locationLabel }}</span>
                <span *ngIf="n.vehicleSummary">🚘 {{ n.vehicleSummary }}</span>
                <span>{{ n.createdAt | date:'yyyy-MM-dd HH:mm' }}</span>
              </div>
              <a *ngIf="n.incidentId" [routerLink]="['/incidents', n.incidentId]">Open incident</a>
            </div>
            <div class="item-actions">
              <button mat-button type="button" *ngIf="!n.isRead" (click)="markRead(n.id)">Mark read</button>
              <button mat-button type="button" *ngIf="n.dispatchId && canDispatchActions()" (click)="dispatchAction(n.dispatchId, 'acknowledge')">Acknowledge</button>
              <button mat-button type="button" *ngIf="n.dispatchId && canDispatchActions()" (click)="dispatchAction(n.dispatchId, 'en-route')">En route</button>
              <button mat-button type="button" *ngIf="n.dispatchId && canDispatchActions()" (click)="dispatchAction(n.dispatchId, 'arrived')">Arrived</button>
              <button mat-button type="button" *ngIf="n.dispatchId && canDispatchActions()" (click)="dispatchAction(n.dispatchId, 'complete')">Complete</button>
            </div>
          </div>
          <p class="muted" *ngIf="!notifications().length">No notifications found.</p>
        </div>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .shell { padding: var(--page-padding); }
      .header-row { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
      .actions { display: flex; gap: 0.4rem; flex-wrap: wrap; }
      .list { display: grid; gap: 0.6rem; }
      .item { border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.6rem; display: flex; justify-content: space-between; align-items: flex-start; gap: 0.6rem; }
      .item-actions { display: flex; flex-wrap: wrap; gap: 0.2rem; }
      .meta { color: #64748b; font-size: 0.82rem; display: flex; gap: 0.7rem; flex-wrap: wrap; margin: 0.25rem 0; }
      .unread { color: #b91c1c; }
      .muted { color: #64748b; }
      .err { color: #b91c1c; }
      @media (max-width: 900px) { .item { flex-direction: column; } }
      @media (max-width: 767px) {
        .actions button,
        .item-actions button {
          width: 100%;
        }
      }
    `
  ]
})
export class OfficerNotificationsPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  readonly notifications = signal<NotificationItem[]>([]);
  readonly error = signal<string | null>(null);

  constructor() {
    this.loadNotifications(false);
  }

  canDispatchActions() {
    return this.auth.currentUser()?.role === "POLICE";
  }

  loadNotifications(unreadOnly: boolean) {
    const params = unreadOnly ? { unreadOnly: "true" } : undefined;
    this.api.get<NotificationItem[]>("/notifications/me", params).subscribe({
      next: (rows) => {
        this.notifications.set(rows);
        this.error.set(null);
      },
      error: (err: { error?: { message?: string } }) => {
        this.error.set(err?.error?.message || "Could not load notifications.");
      }
    });
  }

  markRead(id: string) {
    this.api.patch(`/notifications/${id}/read`, {}).subscribe({
      next: () => this.loadNotifications(false),
      error: () => {}
    });
  }

  dispatchAction(dispatchId: string, action: "acknowledge" | "en-route" | "arrived" | "complete") {
    this.api.post(`/dispatches/${dispatchId}/${action}`, {}).subscribe({
      next: () => this.loadNotifications(false),
      error: () => {}
    });
  }
}
