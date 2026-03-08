import { CommonModule } from "@angular/common";
import { Component, OnInit, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { RouterModule } from "@angular/router";
import { Role, TrustedDeviceSummary, User } from "../models";
import { ApiService } from "../services/api.service";

type AdminUser = User & {
  createdAt?: string;
  updatedAt?: string;
  trustedDevice?: TrustedDeviceSummary | null;
};

@Component({
  selector: "app-users-page",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    RouterModule
  ],
  template: `
    <div class="shell">
      <mat-card>
        <h2>User Management</h2>
        <p class="muted">Admin can create users, configure live tracking/camera access, and reset trusted devices.</p>

        <form [formGroup]="createForm" (ngSubmit)="createUser()" class="form-grid">
          <mat-form-field appearance="outline">
            <mat-label>Full name</mat-label>
            <input matInput formControlName="fullName" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Email</mat-label>
            <input matInput type="email" formControlName="email" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Password</mat-label>
            <input matInput type="password" formControlName="password" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Role</mat-label>
            <mat-select formControlName="role">
              <mat-option *ngFor="let role of roles" [value]="role">{{ role }}</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Status</mat-label>
            <mat-select formControlName="isActive">
              <mat-option [value]="true">Active</mat-option>
              <mat-option [value]="false">Disabled</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Live tracking sender</mat-label>
            <mat-select formControlName="liveLocationEnabled">
              <mat-option [value]="true">Enabled</mat-option>
              <mat-option [value]="false">Disabled</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Visible on live map</mat-label>
            <mat-select formControlName="liveLocationVisible">
              <mat-option [value]="true">Visible</mat-option>
              <mat-option [value]="false">Hidden</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Live camera sender</mat-label>
            <mat-select formControlName="canSendLiveCamera">
              <mat-option [value]="true">Enabled</mat-option>
              <mat-option [value]="false">Disabled</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Visible in Control Room</mat-label>
            <mat-select formControlName="visibleInControlRoom">
              <mat-option [value]="true">Visible</mat-option>
              <mat-option [value]="false">Hidden</mat-option>
            </mat-select>
          </mat-form-field>

          <div class="actions">
            <button mat-raised-button color="primary" [disabled]="saving() || createForm.invalid">
              {{ saving() ? 'Creating...' : 'Create User' }}
            </button>
          </div>
        </form>

        <p class="ok" *ngIf="message()">{{ message() }}</p>
        <p class="error" *ngIf="error()">{{ error() }}</p>
      </mat-card>

      <mat-card>
        <h3>Existing users</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Live sender</th>
                <th>Live map</th>
                <th>Camera sender</th>
                <th>Control Room</th>
                <th>Trusted device</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let user of users()">
                <td data-label="Name">{{ user.fullName }}</td>
                <td data-label="Email">{{ user.email }}</td>
                <td data-label="Role">{{ user.role }}</td>
                <td data-label="Status">{{ user.isActive ? 'Active' : 'Disabled' }}</td>
                <td data-label="Live sender">{{ user.liveLocationEnabled ? 'Enabled' : 'Disabled' }}</td>
                <td data-label="Live map">{{ user.liveLocationVisible ? 'Visible' : 'Hidden' }}</td>
                <td data-label="Camera sender">{{ user.canSendLiveCamera ? 'Enabled' : 'Disabled' }}</td>
                <td data-label="Control Room">{{ user.visibleInControlRoom ? 'Visible' : 'Hidden' }}</td>
                <td data-label="Trusted device">
                  <ng-container *ngIf="user.trustedDevice?.isActive; else noTrustedDevice">
                    <div><strong>Assigned</strong></div>
                    <div class="muted small">{{ user.trustedDevice?.deviceLabel || user.trustedDevice?.platform || 'Browser device' }}</div>
                    <div class="muted small">Last seen: {{ user.trustedDevice?.lastSeenAt | date:'yyyy-MM-dd HH:mm' }}</div>
                  </ng-container>
                  <ng-template #noTrustedDevice>
                    <span class="muted">Not assigned</span>
                  </ng-template>
                </td>
                <td data-label="Actions" class="row-actions">
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busyUserId() === user.id"
                    (click)="toggleLiveSender(user)"
                  >
                    {{ user.liveLocationEnabled ? 'Disable sender' : 'Enable sender' }}
                  </button>
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busyUserId() === user.id"
                    (click)="toggleLiveMap(user)"
                  >
                    {{ user.liveLocationVisible ? 'Hide on map' : 'Show on map' }}
                  </button>
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busyUserId() === user.id"
                    (click)="toggleCameraSender(user)"
                  >
                    {{ user.canSendLiveCamera ? 'Disable camera sender' : 'Enable camera sender' }}
                  </button>
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busyUserId() === user.id"
                    (click)="toggleControlRoomVisibility(user)"
                  >
                    {{ user.visibleInControlRoom ? 'Hide from Control Room' : 'Show in Control Room' }}
                  </button>
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busyUserId() === user.id"
                    (click)="toggleAccountStatus(user)"
                  >
                    {{ user.isActive ? 'Disable account' : 'Enable account' }}
                  </button>
                  <button
                    mat-stroked-button
                    color="warn"
                    type="button"
                    [disabled]="busyUserId() === user.id"
                    (click)="resetTrustedDevice(user)"
                  >
                    Reset trusted device
                  </button>
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busyUserId() === user.id"
                    (click)="pingForLocation(user.id)"
                  >
                    Ping for location
                  </button>
                  <a mat-button [routerLink]="['/tracking-logs']" [queryParams]="{ userId: user.id }">Tracking logs</a>
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
        display: grid;
        gap: 1rem;
      }
      .muted {
        color: #64748b;
      }
      .small {
        font-size: 0.75rem;
      }
      .form-grid {
        margin-top: 0.75rem;
        display: grid;
        gap: 0.75rem;
        grid-template-columns: 1fr;
      }
      .actions {
        grid-column: 1 / -1;
      }
      .ok {
        color: #166534;
        font-weight: 600;
      }
      .error {
        color: #b91c1c;
        font-weight: 600;
      }
      .table-wrap {
        border: 1px solid #e2e8f0;
        border-radius: 0.5rem;
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        text-align: left;
        padding: 0.5rem;
        border-bottom: 1px solid #e2e8f0;
        overflow-wrap: anywhere;
        vertical-align: top;
      }
      .row-actions {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.35rem;
        min-width: 180px;
      }

      @media (min-width: 820px) {
        .form-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 767px) {
        .table-wrap {
          border: 0;
          overflow: visible;
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

        tr {
          border: 1px solid #e2e8f0;
          border-radius: 0.6rem;
          background: #fff;
          margin-bottom: 0.7rem;
          padding: 0.2rem 0.65rem;
        }

        td {
          border-bottom: 1px dashed #dbe1ea;
          padding: 0.5rem 0;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.6rem;
        }

        td::before {
          content: attr(data-label);
          font-weight: 600;
          color: #475569;
          font-size: 0.82rem;
          flex: 0 0 auto;
        }

        td:last-child {
          border-bottom: 0;
        }

        td[data-label="Actions"] {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0.35rem;
        }

        td[data-label="Actions"]::before {
          margin-bottom: 0.2rem;
        }
      }
    `
  ]
})
export class UsersPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);

  readonly users = signal<AdminUser[]>([]);
  readonly saving = signal(false);
  readonly busyUserId = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly roles: Role[] = ["ADMIN", "CASE_WORKER", "FINANCE", "VIEWER", "POLICE"];

  readonly createForm = this.fb.nonNullable.group({
    fullName: ["", [Validators.required, Validators.minLength(2)]],
    email: ["", [Validators.required, Validators.email]],
    password: ["", [Validators.required, Validators.minLength(8)]],
    role: ["VIEWER" as Role, Validators.required],
    isActive: [true],
    liveLocationEnabled: [false],
    liveLocationVisible: [false],
    canSendLiveCamera: [false],
    visibleInControlRoom: [true]
  });

  ngOnInit() {
    this.loadUsers();
  }

  createUser() {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.message.set(null);
    this.error.set(null);
    this.api.post<AdminUser>("/users", this.createForm.getRawValue()).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.message.set(`User ${created.fullName} created.`);
        this.createForm.patchValue({
          fullName: "",
          email: "",
          password: "",
          role: "VIEWER",
          isActive: true,
          liveLocationEnabled: false,
          liveLocationVisible: false,
          canSendLiveCamera: false,
          visibleInControlRoom: true
        });
        this.loadUsers();
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(String(err?.error?.message ?? "Could not create user."));
      }
    });
  }

  toggleLiveSender(user: AdminUser) {
    this.updateUser(user, { liveLocationEnabled: !user.liveLocationEnabled }, user.liveLocationEnabled ? "Live sender disabled." : "Live sender enabled.");
  }

  toggleLiveMap(user: AdminUser) {
    this.updateUser(user, { liveLocationVisible: !user.liveLocationVisible }, user.liveLocationVisible ? "Live map visibility disabled." : "Live map visibility enabled.");
  }

  toggleCameraSender(user: AdminUser) {
    this.updateUser(
      user,
      { canSendLiveCamera: !user.canSendLiveCamera },
      user.canSendLiveCamera ? "Camera sender disabled." : "Camera sender enabled."
    );
  }

  toggleControlRoomVisibility(user: AdminUser) {
    this.updateUser(
      user,
      { visibleInControlRoom: !user.visibleInControlRoom },
      user.visibleInControlRoom ? "Control Room visibility disabled." : "Control Room visibility enabled."
    );
  }

  toggleAccountStatus(user: AdminUser) {
    this.updateUser(user, { isActive: !user.isActive }, user.isActive ? "User disabled." : "User enabled.");
  }

  resetTrustedDevice(user: AdminUser) {
    this.busyUserId.set(user.id);
    this.error.set(null);
    this.message.set(null);

    this.api.resetTrustedDevice(user.id).subscribe({
      next: (response) => {
        this.busyUserId.set(null);
        this.message.set(
          response.hadTrustedDevice
            ? `Trusted device reset for ${user.fullName}.`
            : `${user.fullName} has no active trusted device to reset.`
        );
        this.loadUsers();
      },
      error: (err) => {
        this.busyUserId.set(null);
        this.error.set(String(err?.error?.message ?? "Could not reset trusted device."));
      }
    });
  }

  pingForLocation(userId: string) {
    this.busyUserId.set(userId);
    this.error.set(null);
    this.message.set(null);
    this.api.createTrackingPing(userId).subscribe({
      next: () => {
        this.busyUserId.set(null);
        this.message.set("Location ping sent.");
      },
      error: (err) => {
        this.busyUserId.set(null);
        this.error.set(String(err?.error?.message ?? "Could not send location ping."));
      }
    });
  }

  private updateUser(user: AdminUser, payload: Partial<User>, successMessage: string) {
    this.busyUserId.set(user.id);
    this.error.set(null);
    this.message.set(null);

    this.api.updateUser(user.id, payload).subscribe({
      next: (updated) => {
        this.busyUserId.set(null);
        this.message.set(successMessage);
        this.users.update((rows) => rows.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
      },
      error: (err) => {
        this.busyUserId.set(null);
        this.error.set(String(err?.error?.message ?? "Could not update user."));
      }
    });
  }

  private loadUsers() {
    this.api.get<AdminUser[]>("/users").subscribe({
      next: (users) => this.users.set(users),
      error: () => this.error.set("Could not load users.")
    });
  }
}
