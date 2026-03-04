import { CommonModule } from "@angular/common";
import { Component, OnInit, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { ApiService } from "../services/api.service";
import { Role, User } from "../models";

type AdminUser = User & { createdAt?: string; updatedAt?: string };

@Component({
  selector: "app-users-page",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  template: `
    <div class="shell">
      <mat-card>
        <h2>User Management</h2>
        <p class="muted">Admin can create users and assign role (including police accounts).</p>

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
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let user of users()">
                <td>{{ user.fullName }}</td>
                <td>{{ user.email }}</td>
                <td>{{ user.role }}</td>
                <td>{{ user.isActive ? 'Active' : 'Disabled' }}</td>
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
        padding: 1rem;
        display: grid;
        gap: 1rem;
      }
      .muted {
        color: #64748b;
      }
      .form-grid {
        margin-top: 0.75rem;
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
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
      }
      @media (max-width: 900px) {
        .form-grid {
          grid-template-columns: 1fr;
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
  readonly message = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly roles: Role[] = ["ADMIN", "CASE_WORKER", "FINANCE", "VIEWER", "POLICE"];

  readonly createForm = this.fb.nonNullable.group({
    fullName: ["", [Validators.required, Validators.minLength(2)]],
    email: ["", [Validators.required, Validators.email]],
    password: ["", [Validators.required, Validators.minLength(8)]],
    role: ["VIEWER" as Role, Validators.required],
    isActive: [true]
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
      next: () => {
        this.saving.set(false);
        this.message.set("User created.");
        this.createForm.patchValue({
          fullName: "",
          email: "",
          password: "",
          role: "VIEWER",
          isActive: true
        });
        this.loadUsers();
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(String(err?.error?.message ?? "Could not create user."));
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
