import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { ResponseUnit } from "../models";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";

@Component({
  selector: "app-response-units-page",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  template: `
    <div class="shell">
      <mat-card *ngIf="canManage()">
        <h2>{{ editingId() ? 'Edit Unit' : 'Create Unit' }}</h2>
        <form [formGroup]="unitForm" (ngSubmit)="saveUnit()" class="grid">
          <mat-form-field appearance="outline"><mat-label>Name</mat-label><input matInput formControlName="name" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Type</mat-label><mat-select formControlName="type"><mat-option value="POLICE">POLICE</mat-option><mat-option value="CHECKPOINT">CHECKPOINT</mat-option><mat-option value="MEDICAL">MEDICAL</mat-option></mat-select></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Status</mat-label><mat-select formControlName="status"><mat-option value="AVAILABLE">AVAILABLE</mat-option><mat-option value="BUSY">BUSY</mat-option><mat-option value="OFFLINE">OFFLINE</mat-option></mat-select></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Latitude</mat-label><input matInput type="number" formControlName="latitude" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Longitude</mat-label><input matInput type="number" formControlName="longitude" /></mat-form-field>
          <div class="wide actions">
            <button mat-raised-button color="primary" [disabled]="saving() || unitForm.invalid">{{ saving() ? 'Saving...' : (editingId() ? 'Update' : 'Create') }}</button>
            <button mat-button type="button" *ngIf="editingId()" (click)="resetForm()">Cancel</button>
            <span class="ok" *ngIf="message()">{{ message() }}</span>
            <span class="err" *ngIf="error()">{{ error() }}</span>
          </div>
        </form>
      </mat-card>

      <mat-card>
        <h2>Response Units</h2>
        <div class="list">
          <div class="row" *ngFor="let u of units()">
            <div>
              <strong>{{ unitEmoji(u.type) }} {{ u.name }}</strong>
              <div class="muted">{{ u.type }} | {{ u.status }} | {{ u.latitude ?? '-' }}, {{ u.longitude ?? '-' }}</div>
              <div class="muted">Officer: {{ u.assignedOfficer?.fullName || 'Unassigned' }}</div>
            </div>
            <div class="row-actions" *ngIf="canManage()">
              <button mat-button type="button" (click)="editUnit(u)">Edit</button>
              <button mat-button color="warn" type="button" (click)="deleteUnit(u.id)">Delete</button>
            </div>
          </div>
        </div>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .shell { padding: var(--page-padding); display: grid; gap: 1rem; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 0.6rem; }
      .wide { grid-column: 1 / -1; }
      .actions { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 0.6rem; }
      .list { display: grid; gap: 0.5rem; }
      .row { border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.6rem; display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; }
      .row-actions { display: flex; gap: 0.3rem; }
      .muted { color: #64748b; font-size: 0.84rem; }
      .ok { color: #166534; }
      .err { color: #b91c1c; }
      @media (min-width: 900px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      @media (max-width: 900px) { .row { flex-direction: column; align-items: flex-start; } }
      @media (max-width: 767px) { .actions button, .row-actions button { width: 100%; } }
    `
  ]
})
export class ResponseUnitsPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly units = signal<ResponseUnit[]>([]);
  readonly editingId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly message = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly unitForm = this.fb.group({
    name: ["", Validators.required],
    type: ["POLICE", Validators.required],
    status: ["AVAILABLE", Validators.required],
    latitude: [null as number | null],
    longitude: [null as number | null]
  });

  constructor() {
    this.loadUnits();
  }

  canManage() {
    const role = this.auth.currentUser()?.role;
    return role === "ADMIN" || role === "CASE_WORKER";
  }

  saveUnit() {
    if (!this.canManage()) {
      return;
    }
    const value = this.unitForm.getRawValue();
    const payload = {
      name: value.name,
      type: value.type,
      status: value.status,
      latitude: value.latitude,
      longitude: value.longitude
    };
    const id = this.editingId();
    this.saving.set(true);
    this.message.set(null);
    this.error.set(null);
    const req = id ? this.api.patch<ResponseUnit>(`/response-units/${id}`, payload) : this.api.post<ResponseUnit>("/response-units", payload);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.message.set(id ? "Unit updated." : "Unit created.");
        this.resetForm();
        this.loadUnits();
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.error.set(err?.error?.message || "Could not save response unit.");
      }
    });
  }

  editUnit(unit: ResponseUnit) {
    this.editingId.set(unit.id);
    this.unitForm.patchValue({
      name: unit.name,
      type: unit.type,
      status: unit.status,
      latitude: unit.latitude,
      longitude: unit.longitude
    });
  }

  deleteUnit(id: string) {
    if (!this.canManage()) {
      return;
    }
    this.api.delete(`/response-units/${id}`).subscribe({
      next: () => this.loadUnits(),
      error: (err: { error?: { message?: string } }) => {
        this.error.set(err?.error?.message || "Could not delete response unit.");
      }
    });
  }

  unitEmoji(type: string) {
    if (type === "POLICE") {
      return "🚓";
    }
    if (type === "CHECKPOINT") {
      return "🚧";
    }
    if (type === "MEDICAL") {
      return "🚑";
    }
    return "📍";
  }

  resetForm() {
    this.editingId.set(null);
    this.unitForm.patchValue({
      name: "",
      type: "POLICE",
      status: "AVAILABLE",
      latitude: null,
      longitude: null
    });
  }

  private loadUnits() {
    this.api.get<ResponseUnit[]>("/response-units").subscribe((rows) => this.units.set(rows));
  }
}
