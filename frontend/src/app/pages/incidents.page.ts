import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { ActivatedRoute, RouterModule } from "@angular/router";
import { IncidentLocationSource, IncidentRecord, IncidentStatus, IncidentVehicle } from "../models";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";
import { LiveTrackingService } from "../services/live-tracking.service";

@Component({
  selector: "app-incidents-page",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule
  ],
  template: `
    <div class="shell">
      <mat-card class="create-card" *ngIf="canManage()">
        <h2>Create Incident</h2>
        <form [formGroup]="incidentForm" (ngSubmit)="createIncident()" class="form-grid">
          <mat-form-field appearance="outline">
            <mat-label>Title</mat-label>
            <input matInput formControlName="title" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Type</mat-label>
            <mat-select formControlName="type">
              <mat-option value="PROTECTION">PROTECTION</mat-option>
              <mat-option value="MEDICAL">MEDICAL</mat-option>
              <mat-option value="HOUSING">HOUSING</mat-option>
              <mat-option value="UTILITY">UTILITY</mat-option>
              <mat-option value="OTHER">OTHER</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Priority</mat-label>
            <mat-select formControlName="priority">
              <mat-option value="LOW">LOW</mat-option>
              <mat-option value="MEDIUM">MEDIUM</mat-option>
              <mat-option value="HIGH">HIGH</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Severity</mat-label>
            <mat-select formControlName="severity">
              <mat-option value="LOW">LOW</mat-option>
              <mat-option value="MEDIUM">MEDIUM</mat-option>
              <mat-option value="HIGH">HIGH</mat-option>
              <mat-option value="CRITICAL">CRITICAL</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="wide">
            <mat-label>Description</mat-label>
            <textarea matInput rows="3" formControlName="description"></textarea>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Status</mat-label>
            <mat-select formControlName="status">
              <mat-option *ngFor="let s of incidentStatuses" [value]="s">{{ s }}</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Location label</mat-label>
            <input matInput formControlName="locationLabel" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Latitude</mat-label>
            <input matInput type="number" formControlName="locationLat" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Longitude</mat-label>
            <input matInput type="number" formControlName="locationLng" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Accuracy (meters)</mat-label>
            <input matInput type="number" formControlName="locationAccuracyM" />
          </mat-form-field>

          <div class="location-actions wide">
            <button
              mat-stroked-button
              type="button"
              (click)="useCurrentLocation()"
              [disabled]="locating()"
            >
              {{ locating() ? 'Getting GPS...' : 'Use my current location' }}
            </button>
            <p class="ok" *ngIf="locationMessage()">{{ locationMessage() }}</p>
            <p class="err" *ngIf="locationError()">{{ locationError() }}</p>
          </div>

          <mat-form-field appearance="outline">
            <mat-label>Due date</mat-label>
            <input matInput type="date" formControlName="dueDate" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Vehicle involved?</mat-label>
            <mat-select formControlName="vehicleInvolved">
              <mat-option [value]="false">No</mat-option>
              <mat-option [value]="true">Yes</mat-option>
            </mat-select>
          </mat-form-field>

          <div class="vehicle-grid wide" *ngIf="incidentForm.get('vehicleInvolved')?.value">
            <mat-form-field appearance="outline">
              <mat-label>Vehicle type</mat-label>
              <input matInput formControlName="vehicleType" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Brand</mat-label>
              <input matInput formControlName="brand" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Model</mat-label>
              <input matInput formControlName="model" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Color</mat-label>
              <input matInput formControlName="color" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Plate number</mat-label>
              <input matInput formControlName="plateNumber" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Registration country</mat-label>
              <input matInput formControlName="registrationCountry" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Direction of travel</mat-label>
              <input matInput formControlName="directionOfTravel" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Passenger count</mat-label>
              <input matInput type="number" formControlName="passengerCount" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Photo URL</mat-label>
              <input matInput formControlName="photoUrl" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="wide">
              <mat-label>Vehicle notes</mat-label>
              <textarea matInput rows="2" formControlName="vehicleNotes"></textarea>
            </mat-form-field>
          </div>

          <div class="actions wide">
            <button mat-raised-button color="primary" [disabled]="saving() || incidentForm.invalid">
              {{ saving() ? 'Saving...' : 'Create incident' }}
            </button>
            <p class="ok" *ngIf="message()">{{ message() }}</p>
            <p class="err" *ngIf="error()">{{ error() }}</p>
          </div>
        </form>
      </mat-card>

      <mat-card>
        <h2>Incidents</h2>
        <div class="list">
          <a class="row" *ngFor="let incident of incidents()" [routerLink]="['/incidents', incident.id]">
            <div>
              <strong>{{ incident.incidentCode }}</strong> - {{ incident.title || incident.type }}
              <div class="muted">{{ incident.description }}</div>
            </div>
            <div class="badge">{{ incident.status }}</div>
          </a>
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
      .create-card h2,
      mat-card h2 {
        margin-top: 0;
      }
      .form-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.6rem;
      }
      .wide {
        grid-column: 1 / -1;
      }
      .vehicle-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.6rem;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 0.5rem;
      }
      .location-actions {
        display: flex;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 0.6rem;
      }
      .actions {
        display: flex;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 0.8rem;
      }
      .list {
        display: grid;
        gap: 0.5rem;
      }
      .row {
        text-decoration: none;
        color: inherit;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 0.6rem;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 0.6rem;
      }
      .muted {
        color: #64748b;
        font-size: 0.85rem;
      }
      .badge {
        background: #e2e8f0;
        border-radius: 999px;
        padding: 0.2rem 0.55rem;
        font-size: 0.75rem;
        font-weight: 600;
      }
      .ok {
        color: #166534;
        margin: 0;
      }
      .err {
        color: #b91c1c;
        margin: 0;
      }
      @media (min-width: 760px) {
        .form-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (min-width: 1080px) {
        .form-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .vehicle-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      @media (max-width: 767px) {
        .row {
          flex-direction: column;
        }
      }
    `
  ]
})
export class IncidentsPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly liveTracking = inject(LiveTrackingService);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);

  readonly incidentStatuses: IncidentStatus[] = [
    "DRAFT",
    "REPORTED",
    "ACTIVE_RESPONSE",
    "CONTAINED",
    "RESOLVED",
    "CLOSED",
    "CANCELLED"
  ];

  readonly incidents = signal<IncidentRecord[]>([]);
  readonly saving = signal(false);
  readonly locating = signal(false);
  readonly message = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly locationMessage = signal<string | null>(null);
  readonly locationError = signal<string | null>(null);
  private locationSourceOverride: IncidentLocationSource | null = null;
  private prefilledFromCamera = false;

  readonly incidentForm = this.fb.group({
    title: [""],
    type: ["PROTECTION", Validators.required],
    priority: ["HIGH", Validators.required],
    severity: ["HIGH", Validators.required],
    description: ["", [Validators.required, Validators.minLength(3)]],
    status: ["REPORTED", Validators.required],
    locationLabel: [""],
    locationLat: [null as number | null],
    locationLng: [null as number | null],
    locationAccuracyM: [null as number | null],
    dueDate: [""],
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

  constructor() {
    this.loadIncidents();
    this.applyPrefillFromQuery();
    this.tryAutoAttachLocation();
  }

  canManage() {
    const role = this.auth.currentUser()?.role;
    return role === "ADMIN" || role === "CASE_WORKER";
  }

  useCurrentLocation() {
    this.locating.set(true);
    this.locationMessage.set(null);
    this.locationError.set(null);

    this.liveTracking
      .captureCurrentLocation(true)
      .then((snapshot) => {
        this.applyLocationSnapshot(snapshot, "Current location attached.", "GPS_FRESH");
        this.locating.set(false);
      })
      .catch((err) => {
        this.locating.set(false);
        this.locationError.set(String(err?.message ?? "Could not access current location."));
      });
  }

  createIncident() {
    if (!this.canManage()) {
      return;
    }
    const value = this.incidentForm.getRawValue();
    const hasCoordinates = value.locationLat != null && value.locationLng != null;
    const locationSource: IncidentLocationSource | null = hasCoordinates
      ? this.locationSourceOverride ?? "MANUAL"
      : null;
    const vehicleInvolved = !!value.vehicleInvolved;
    const vehicle: IncidentVehicle | null = vehicleInvolved
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

    this.saving.set(true);
    this.error.set(null);
    this.message.set(null);
    this.api
      .post<IncidentRecord>("/incidents", {
        title: this.toNullable(value.title),
        type: value.type,
        priority: value.priority,
        severity: value.severity,
        description: value.description,
        status: value.status,
        locationLabel: this.toNullable(value.locationLabel),
        locationLat: value.locationLat,
        locationLng: value.locationLng,
        locationAccuracyM: value.locationAccuracyM,
        locationSource,
        dueDate: this.toNullable(value.dueDate),
        vehicle
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.message.set("Incident created.");
          this.incidentForm.patchValue({
            title: "",
            description: "",
            locationLabel: "",
            locationLat: null,
            locationLng: null,
            locationAccuracyM: null,
            dueDate: "",
            vehicleInvolved: false,
            vehicleType: "",
            brand: "",
            model: "",
            color: "",
            plateNumber: "",
            registrationCountry: "",
            directionOfTravel: "",
            passengerCount: null,
            vehicleNotes: "",
            photoUrl: ""
          });
          this.locationSourceOverride = null;
          this.loadIncidents();
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.error.set(err?.error?.message || "Could not create incident.");
        }
      });
  }

  private tryAutoAttachLocation() {
    if (this.prefilledFromCamera) {
      return;
    }

    const fresh = this.liveTracking.getFreshLocation(120_000);
    if (fresh) {
      this.applyLocationSnapshot(fresh, "Latest location auto-attached.", "GPS_RECENT");
      return;
    }

    if (!("permissions" in navigator) || !navigator.permissions?.query) {
      return;
    }

    void navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (status.state !== "granted") {
          return;
        }

        return this.liveTracking.captureCurrentLocation(false).then((snapshot) => {
          this.applyLocationSnapshot(snapshot, "Current location auto-attached.", "GPS_FRESH");
        });
      })
      .catch(() => {
        // Ignore permissions API failures and keep manual capture available.
      });
  }

  private applyLocationSnapshot(
    snapshot: { latitude: number; longitude: number; accuracyM: number },
    message: string,
    source: IncidentLocationSource
  ) {
    const currentLabel = String(this.incidentForm.get("locationLabel")?.value ?? "").trim();
    this.incidentForm.patchValue({
      locationLat: snapshot.latitude,
      locationLng: snapshot.longitude,
      locationAccuracyM: Math.round(snapshot.accuracyM),
      locationLabel: currentLabel || "Current device location"
    });
    this.locationSourceOverride = source;
    this.locationMessage.set(message);
    this.locationError.set(null);
  }

  private loadIncidents() {
    this.api.get<IncidentRecord[]>("/incidents").subscribe((rows) => this.incidents.set(rows));
  }

  private toNullable(value: unknown) {
    const text = String(value ?? "").trim();
    return text.length ? text : null;
  }

  private applyPrefillFromQuery() {
    const query = this.route.snapshot.queryParamMap;
    const source = String(query.get("source") ?? "").trim().toLowerCase();
    if (source !== "live_camera") {
      return;
    }

    const title = String(query.get("title") ?? "").trim();
    const locationLabel = String(query.get("locationLabel") ?? "").trim();
    const rawLocationSource = String(query.get("locationSource") ?? "").trim().toUpperCase();
    const locationSource: IncidentLocationSource =
      rawLocationSource === "GPS_FRESH" ||
      rawLocationSource === "GPS_RECENT" ||
      rawLocationSource === "MANUAL" ||
      rawLocationSource === "LIVE_TRACKING_RECENT"
        ? (rawLocationSource as IncidentLocationSource)
        : "LIVE_TRACKING_RECENT";

    const lat = this.parseNumber(query.get("locationLat"));
    const lng = this.parseNumber(query.get("locationLng"));

    this.incidentForm.patchValue({
      title: title || this.incidentForm.get("title")?.value || "",
      locationLabel: locationLabel || this.incidentForm.get("locationLabel")?.value || "",
      locationLat: lat,
      locationLng: lng
    });
    this.locationSourceOverride = lat != null && lng != null ? locationSource : null;
    this.locationMessage.set("Incident form prefilled from selected live camera stream.");
    this.locationError.set(null);
    this.prefilledFromCamera = true;
  }

  private parseNumber(value: string | null) {
    if (!value) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
