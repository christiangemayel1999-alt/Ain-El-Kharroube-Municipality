import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MapLegendComponent } from "../components/map-legend.component";
import {
  DispatchStatus,
  EmergencyPlan,
  IncidentDispatch,
  IncidentRecord,
  IncidentStatus,
  ResponseUnit,
  Role
} from "../models";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";

@Component({
  selector: "app-incident-detail-page",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MapLegendComponent
  ],
  template: `
    <div class="shell" *ngIf="incident() as incident">
      <a routerLink="/incidents">← Back to incidents</a>

      <mat-card>
        <h2>{{ incident.incidentCode }} - {{ incident.title || incident.type }}</h2>
        <p class="muted">
          Status: <strong>{{ incident.status }}</strong> |
          Priority: <strong>{{ incident.priority }}</strong> |
          Severity: <strong>{{ incident.severity }}</strong>
        </p>
        <p><strong>Location:</strong> {{ incident.locationLabel || "-" }} ({{ incident.locationLat ?? "-" }}, {{ incident.locationLng ?? "-" }})</p>
        <p><strong>Accuracy:</strong> {{ incident.locationAccuracyM ?? "-" }} m</p>
        <p><strong>Description:</strong> {{ incident.description }}</p>
      </mat-card>

      <mat-card *ngIf="canManage()">
        <h3>Edit Incident & Vehicle</h3>
        <form [formGroup]="incidentForm" (ngSubmit)="saveIncident()" class="grid">
          <mat-form-field appearance="outline"><mat-label>Title</mat-label><input matInput formControlName="title" /></mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Status</mat-label>
            <mat-select formControlName="status">
              <mat-option *ngFor="let s of incidentStatuses" [value]="s">{{ s }}</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Location label</mat-label><input matInput formControlName="locationLabel" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Latitude</mat-label><input matInput type="number" formControlName="locationLat" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Longitude</mat-label><input matInput type="number" formControlName="locationLng" /></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Accuracy (m)</mat-label><input matInput type="number" formControlName="locationAccuracyM" /></mat-form-field>
          <mat-form-field appearance="outline" class="wide"><mat-label>Description</mat-label><textarea matInput rows="3" formControlName="description"></textarea></mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Vehicle involved?</mat-label>
            <mat-select formControlName="vehicleInvolved">
              <mat-option [value]="false">No</mat-option>
              <mat-option [value]="true">Yes</mat-option>
            </mat-select>
          </mat-form-field>
          <div class="vehicle-grid wide" *ngIf="incidentForm.get('vehicleInvolved')?.value">
            <mat-form-field appearance="outline"><mat-label>Vehicle type</mat-label><input matInput formControlName="vehicleType" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Brand</mat-label><input matInput formControlName="brand" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Model</mat-label><input matInput formControlName="model" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Color</mat-label><input matInput formControlName="color" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Plate number</mat-label><input matInput formControlName="plateNumber" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Registration country</mat-label><input matInput formControlName="registrationCountry" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Direction of travel</mat-label><input matInput formControlName="directionOfTravel" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Passenger count</mat-label><input matInput type="number" formControlName="passengerCount" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Photo URL</mat-label><input matInput formControlName="photoUrl" /></mat-form-field>
            <mat-form-field appearance="outline" class="wide"><mat-label>Vehicle notes</mat-label><textarea matInput rows="2" formControlName="vehicleNotes"></textarea></mat-form-field>
          </div>

          <div class="wide">
            <button mat-raised-button color="primary" [disabled]="savingIncident()">{{ savingIncident() ? 'Saving...' : 'Save incident changes' }}</button>
            <span class="ok" *ngIf="incidentMessage()">{{ incidentMessage() }}</span>
            <span class="err" *ngIf="incidentError()">{{ incidentError() }}</span>
          </div>
        </form>
      </mat-card>

      <mat-card *ngIf="canManage()">
        <h3>Activate Emergency Plan</h3>
        <form [formGroup]="activationForm" (ngSubmit)="activatePlan()" class="grid">
          <mat-form-field appearance="outline">
            <mat-label>Plan</mat-label>
            <mat-select formControlName="emergencyPlanId">
              <mat-option *ngFor="let p of plans()" [value]="p.id">
                {{ p.name }} ({{ p.severity }})
              </mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Units (optional)</mat-label>
            <mat-select formControlName="selectedUnitIds" multiple>
              <mat-option *ngFor="let u of units()" [value]="u.id">
                {{ unitEmoji(u.type) }} {{ u.name }} - {{ u.status }}
              </mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" class="wide">
            <mat-label>Custom message (optional)</mat-label>
            <textarea matInput rows="2" formControlName="customMessage"></textarea>
          </mat-form-field>
          <div class="wide">
            <button mat-raised-button color="primary" [disabled]="activatingPlan() || activationForm.invalid">
              {{ activatingPlan() ? 'Activating...' : 'Activate plan' }}
            </button>
            <span class="ok" *ngIf="activationMessage()">{{ activationMessage() }}</span>
            <span class="err" *ngIf="activationError()">{{ activationError() }}</span>
          </div>
        </form>

        <div class="steps" *ngIf="incident.emergencyPlan?.steps?.length">
          <h4>Plan Steps</h4>
          <div class="step" *ngFor="let step of incident.emergencyPlan?.steps">
            <strong>#{{ step.stepOrder }} {{ step.title }}</strong>
            <span>{{ step.description || '-' }}</span>
            <small>{{ step.isRequired ? 'Required' : 'Optional' }} | {{ step.unitTypeRequired }}</small>
          </div>
        </div>
      </mat-card>

      <mat-card>
        <h3>Dispatches</h3>
        <div class="dispatch-list">
          <div class="dispatch" *ngFor="let d of incident.dispatches || []">
            <div>
              <strong>{{ unitEmoji(d.unit.type) }} {{ d.unit.name }}</strong>
              <div class="muted">Officer: {{ d.officer?.fullName || 'Unassigned' }}</div>
              <div class="muted">Status: {{ d.status }}</div>
            </div>
            <div class="actions" *ngIf="canControlDispatch(d)">
              <button mat-button type="button" (click)="dispatchAction(d.id, 'acknowledge')" [disabled]="dispatchBusyId() === d.id">Acknowledge</button>
              <button mat-button type="button" (click)="dispatchAction(d.id, 'en-route')" [disabled]="dispatchBusyId() === d.id">En route</button>
              <button mat-button type="button" (click)="dispatchAction(d.id, 'arrived')" [disabled]="dispatchBusyId() === d.id">Arrived</button>
              <button mat-button type="button" (click)="dispatchAction(d.id, 'complete')" [disabled]="dispatchBusyId() === d.id">Complete</button>
            </div>
          </div>
          <p class="muted" *ngIf="!(incident.dispatches || []).length">No dispatch records yet.</p>
        </div>
      </mat-card>

      <mat-card>
        <h3>Incident Timeline</h3>
        <div class="timeline">
          <div class="event" *ngFor="let t of incident.timeline || []">
            <strong>{{ timelineIcon(t.eventType) }} {{ t.eventType }}</strong>
            <span>{{ t.message }}</span>
            <small>{{ t.createdAt | date:'yyyy-MM-dd HH:mm' }} by {{ t.createdBy?.fullName || 'System' }}</small>
          </div>
          <p class="muted" *ngIf="!(incident.timeline || []).length">No timeline events yet.</p>
        </div>
      </mat-card>

      <app-map-legend />
    </div>
  `,
  styles: [
    `
      .shell { padding: var(--page-padding); display: grid; gap: 1rem; }
      .grid { display: grid; gap: 0.6rem; grid-template-columns: 1fr; }
      .wide { grid-column: 1 / -1; }
      .vehicle-grid { display: grid; gap: 0.6rem; grid-template-columns: 1fr; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.5rem; }
      .steps, .timeline, .dispatch-list { display: grid; gap: 0.5rem; }
      .step, .event, .dispatch { border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.5rem; display: grid; gap: 0.2rem; }
      .dispatch { grid-template-columns: 1fr auto; align-items: center; }
      .actions { display: flex; gap: 0.3rem; flex-wrap: wrap; }
      .muted { color: #64748b; margin: 0; }
      .ok { color: #166534; margin-left: 0.5rem; }
      .err { color: #b91c1c; margin-left: 0.5rem; }
      @media (min-width: 760px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (min-width: 1080px) {
        .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .vehicle-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      }
      @media (max-width: 900px) { .dispatch { grid-template-columns: 1fr; } }
      @media (max-width: 767px) { .actions button { flex: 1 1 100%; } }
    `
  ]
})
export class IncidentDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly incident = signal<IncidentRecord | null>(null);
  readonly plans = signal<EmergencyPlan[]>([]);
  readonly units = signal<ResponseUnit[]>([]);
  readonly savingIncident = signal(false);
  readonly incidentMessage = signal<string | null>(null);
  readonly incidentError = signal<string | null>(null);
  readonly activatingPlan = signal(false);
  readonly activationMessage = signal<string | null>(null);
  readonly activationError = signal<string | null>(null);
  readonly dispatchBusyId = signal<string | null>(null);

  readonly incidentStatuses: IncidentStatus[] = [
    "DRAFT",
    "REPORTED",
    "ACTIVE_RESPONSE",
    "CONTAINED",
    "RESOLVED",
    "CLOSED",
    "CANCELLED"
  ];

  readonly incidentForm = this.fb.group({
    title: [""],
    status: ["REPORTED", Validators.required],
    locationLabel: [""],
    locationLat: [null as number | null],
    locationLng: [null as number | null],
    locationAccuracyM: [null as number | null],
    description: ["", Validators.required],
    vehicleInvolved: [false],
    vehicleType: [""],
    brand: [""],
    model: [""],
    color: [""],
    plateNumber: [""],
    registrationCountry: [""],
    directionOfTravel: [""],
    passengerCount: [null as number | null],
    vehicleNotes: [""],
    photoUrl: [""]
  });

  readonly activationForm = this.fb.group({
    emergencyPlanId: ["", Validators.required],
    selectedUnitIds: [[] as string[]],
    customMessage: [""]
  });

  constructor() {
    const id = this.route.snapshot.paramMap.get("id");
    if (id) {
      this.loadIncident(id);
    }
    this.api.get<EmergencyPlan[]>("/emergency-plans").subscribe((rows) => this.plans.set(rows));
    this.api.get<ResponseUnit[]>("/response-units").subscribe((rows) => this.units.set(rows));
  }

  canManage() {
    const role = this.auth.currentUser()?.role;
    return role === "ADMIN" || role === "CASE_WORKER";
  }

  canControlDispatch(dispatch: IncidentDispatch) {
    const role = this.auth.currentUser()?.role as Role | undefined;
    if (!role) {
      return false;
    }
    if (role === "ADMIN" || role === "CASE_WORKER") {
      return true;
    }
    if (role === "POLICE") {
      const myId = this.auth.currentUser()?.id;
      return !dispatch.officerId || dispatch.officerId === myId;
    }
    return false;
  }

  saveIncident() {
    const incident = this.incident();
    if (!incident || !this.canManage()) {
      return;
    }
    const value = this.incidentForm.getRawValue();
    const vehicle = value.vehicleInvolved
      ? {
          vehicleType: this.toNullable(value.vehicleType),
          brand: this.toNullable(value.brand),
          model: this.toNullable(value.model),
          color: this.toNullable(value.color),
          plateNumber: this.toNullable(value.plateNumber),
          registrationCountry: this.toNullable(value.registrationCountry),
          directionOfTravel: this.toNullable(value.directionOfTravel),
          passengerCount: value.passengerCount ?? null,
          notes: this.toNullable(value.vehicleNotes),
          photoUrl: this.toNullable(value.photoUrl)
        }
      : null;

    this.savingIncident.set(true);
    this.incidentMessage.set(null);
    this.incidentError.set(null);
    this.api
      .patch<IncidentRecord>(`/incidents/${incident.id}`, {
        title: this.toNullable(value.title),
        status: value.status,
        locationLabel: this.toNullable(value.locationLabel),
        locationLat: value.locationLat,
        locationLng: value.locationLng,
        locationAccuracyM: value.locationAccuracyM,
        description: value.description,
        vehicle
      })
      .subscribe({
        next: (updated) => {
          this.savingIncident.set(false);
          this.incidentMessage.set("Incident updated.");
          this.applyIncident(updated);
        },
        error: (err: { error?: { message?: string } }) => {
          this.savingIncident.set(false);
          this.incidentError.set(err?.error?.message || "Could not save incident.");
        }
      });
  }

  activatePlan() {
    const incident = this.incident();
    if (!incident || !this.canManage()) {
      return;
    }
    const value = this.activationForm.getRawValue();
    this.activatingPlan.set(true);
    this.activationMessage.set(null);
    this.activationError.set(null);
    this.api
      .post<{ incident: IncidentRecord }>(`/incidents/${incident.id}/activate-plan`, {
        emergencyPlanId: value.emergencyPlanId,
        selectedUnitIds: value.selectedUnitIds,
        customMessage: this.toNullable(value.customMessage)
      })
      .subscribe({
        next: () => {
          this.activatingPlan.set(false);
          this.activationMessage.set("Plan activated and dispatches created.");
          this.loadIncident(incident.id);
        },
        error: (err: { error?: { message?: string } }) => {
          this.activatingPlan.set(false);
          this.activationError.set(err?.error?.message || "Could not activate plan.");
        }
      });
  }

  dispatchAction(dispatchId: string, action: "acknowledge" | "en-route" | "arrived" | "complete") {
    const incident = this.incident();
    if (!incident) {
      return;
    }
    this.dispatchBusyId.set(dispatchId);
    this.api.post(`/dispatches/${dispatchId}/${action}`, {}).subscribe({
      next: () => {
        this.dispatchBusyId.set(null);
        this.loadIncident(incident.id);
      },
      error: () => {
        this.dispatchBusyId.set(null);
      }
    });
  }

  timelineIcon(eventType: string) {
    const map: Record<string, string> = {
      INCIDENT_CREATED: "⚠️",
      VEHICLE_UPDATED: "🚘",
      PLAN_ACTIVATED: "📍",
      NOTIFICATIONS_SENT: "🚓",
      OFFICER_ACKNOWLEDGED: "🚓",
      UNIT_EN_ROUTE: "📍",
      UNIT_ARRIVED: "🛑",
      CHECKPOINT_ACTIVATED: "🚧",
      MEDICAL_SUPPORT_REQUESTED: "🚑",
      INCIDENT_RESOLVED: "🟢",
      INCIDENT_CLOSED: "✅"
    };
    return map[eventType] ?? "•";
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

  private loadIncident(id: string) {
    this.api.get<IncidentRecord>(`/incidents/${id}`).subscribe((row) => this.applyIncident(row));
  }

  private applyIncident(incident: IncidentRecord) {
    this.incident.set(incident);
    this.incidentForm.patchValue({
      title: incident.title ?? "",
      status: incident.status,
      locationLabel: incident.locationLabel ?? "",
      locationLat: incident.locationLat,
      locationLng: incident.locationLng,
      locationAccuracyM: incident.locationAccuracyM,
      description: incident.description,
      vehicleInvolved: !!incident.vehicle,
      vehicleType: incident.vehicle?.vehicleType ?? "",
      brand: incident.vehicle?.brand ?? "",
      model: incident.vehicle?.model ?? "",
      color: incident.vehicle?.color ?? "",
      plateNumber: incident.vehicle?.plateNumber ?? "",
      registrationCountry: incident.vehicle?.registrationCountry ?? "",
      directionOfTravel: incident.vehicle?.directionOfTravel ?? "",
      passengerCount: incident.vehicle?.passengerCount ?? null,
      vehicleNotes: incident.vehicle?.notes ?? "",
      photoUrl: incident.vehicle?.photoUrl ?? ""
    });
    if (incident.emergencyPlanId) {
      this.activationForm.patchValue({ emergencyPlanId: incident.emergencyPlanId });
    }
  }

  private toNullable(value: unknown) {
    const text = String(value ?? "").trim();
    return text.length ? text : null;
  }
}
