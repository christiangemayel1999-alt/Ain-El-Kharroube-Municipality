import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { RouterModule } from "@angular/router";
import { CarRecord } from "../models";
import { ApiService } from "../services/api.service";

@Component({
  selector: "app-cars-page",
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
      <mat-card>
        <h2>Cars Registry</h2>
        <form class="filters" [formGroup]="filterForm" (ngSubmit)="applyFilters()">
          <mat-form-field appearance="outline">
            <mat-label>Search</mat-label>
            <input matInput formControlName="q" placeholder="Plate, model, member, civil ID" />
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
            <mat-label>Safety check</mat-label>
            <mat-select formControlName="safetyCheckStatus">
              <mat-option value="">All</mat-option>
              <mat-option value="PENDING">Pending</mat-option>
              <mat-option value="CHECKED_SAFE">Checked safe</mat-option>
            </mat-select>
          </mat-form-field>

          <button mat-raised-button color="primary" type="submit">Search</button>
          <button mat-button type="button" (click)="resetFilters()">Reset</button>
        </form>

        <div class="content-grid">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Model</th>
                  <th>Color</th>
                  <th>Member</th>
                  <th>Relationship</th>
                  <th>Section</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  *ngFor="let car of cars()"
                  (click)="selectCar(car)"
                  [class.active]="selectedCar()?.recordId === car.recordId"
                >
                  <td data-label="Plate">{{ car.carPlate || "-" }}</td>
                  <td data-label="Model">{{ car.carModel || "-" }}</td>
                  <td data-label="Color">{{ car.carColor || "-" }}</td>
                  <td data-label="Member">{{ displayMemberName(car) }}</td>
                  <td data-label="Relationship">{{ car.memberRelationshipToHead || "-" }}</td>
                  <td data-label="Section">{{ car.zone.name || "-" }}</td>
                </tr>
              </tbody>
            </table>
            <p class="muted" *ngIf="!cars().length">No cars found with current filters.</p>
          </div>

          <mat-card class="detail-card" *ngIf="selectedCar() as car">
            <h3>Member Car Details</h3>
            <p><strong>Household:</strong> {{ car.householdCode }}</p>
            <p><strong>Member #:</strong> {{ car.memberIndex }}</p>
            <p><strong>Name:</strong> {{ displayMemberName(car) }}</p>
            <p><strong>Father:</strong> {{ car.memberFatherName || "-" }}</p>
            <p><strong>Mother:</strong> {{ car.memberMotherName || "-" }}</p>
            <p><strong>Civil ID:</strong> {{ car.memberCivilIdentityNumber || "-" }}</p>
            <p><strong>Phone:</strong> {{ car.memberPhoneNumber || "-" }}</p>
            <p><strong>Relationship:</strong> {{ car.memberRelationshipToHead || "-" }}</p>
            <p><strong>Family origin:</strong> {{ car.originArea || "-" }}</p>
            <p [ngClass]="car.safetyCheckStatus === 'CHECKED_SAFE' ? 'status-safe' : 'status-pending'">
              <strong>Safety check:</strong>
              {{ car.safetyCheckStatus === "CHECKED_SAFE" ? "Checked and safe" : "Not checked (pending)" }}
            </p>
            <p><strong>Car:</strong> {{ car.carModel || "-" }} | {{ car.carColor || "-" }} | {{ car.carPlate || "-" }}</p>
            <a mat-button color="primary" [routerLink]="['/households', car.householdId]">Open household</a>
          </mat-card>
        </div>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .shell {
        padding: var(--page-padding);
      }

      .filters {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: 1fr;
        margin-bottom: 0.75rem;
        align-items: center;
      }

      .content-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: 1fr;
      }

      .table-wrap {
        border: 1px solid #e2e8f0;
        border-radius: 0.5rem;
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 760px;
      }

      th,
      td {
        border-bottom: 1px solid #d9e2e8;
        text-align: left;
        padding: 0.5rem;
        overflow-wrap: anywhere;
      }

      tbody tr {
        cursor: pointer;
      }

      tbody tr.active {
        background: #e9f4fb;
      }

      .detail-card {
        align-self: start;
        background: #f8fafc;
        border: 1px solid #d6e0e7;
      }

      .detail-card p {
        margin: 0.35rem 0;
      }

      .muted {
        color: #64748b;
      }

      .status-pending {
        color: #b91c1c;
        font-weight: 600;
      }

      .status-safe {
        color: #15803d;
        font-weight: 600;
      }

      @media (min-width: 760px) {
        .filters {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (min-width: 1200px) {
        .filters {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .content-grid {
          grid-template-columns: 2fr 1fr;
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

        table {
          min-width: 0;
        }

        tr {
          border: 1px solid #d9e2e8;
          border-radius: 0.55rem;
          margin-bottom: 0.65rem;
          padding: 0.2rem 0.65rem;
          background: #fff;
        }

        td {
          border-bottom: 1px dashed #dbe1ea;
          padding: 0.5rem 0;
          display: flex;
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
      }
    `
  ]
})
export class CarsPageComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);

  readonly cars = signal<CarRecord[]>([]);
  readonly selectedCar = signal<CarRecord | null>(null);

  readonly filterForm = this.fb.nonNullable.group({
    q: [""],
    model: [""],
    color: [""],
    safetyCheckStatus: [""]
  });

  constructor() {
    this.loadCars();
  }

  applyFilters() {
    this.loadCars();
  }

  resetFilters() {
    this.filterForm.setValue({
      q: "",
      model: "",
      color: "",
      safetyCheckStatus: ""
    });
    this.loadCars();
  }

  selectCar(car: CarRecord) {
    this.selectedCar.set(car);
  }

  displayMemberName(car: CarRecord) {
    const first = String(car.memberFirstName ?? "").trim();
    const last = String(car.memberLastName ?? "").trim();
    const full = `${first} ${last}`.trim();
    if (full) {
      return full;
    }
    return car.memberName || "-";
  }

  private loadCars() {
    const form = this.filterForm.getRawValue();
    const params: Record<string, string> = {};

    if (form.q) {
      params["q"] = form.q;
    }
    if (form.model) {
      params["model"] = form.model;
    }
    if (form.color) {
      params["color"] = form.color;
    }
    if (form.safetyCheckStatus) {
      params["safetyCheckStatus"] = form.safetyCheckStatus;
    }

    this.api.get<CarRecord[]>("/cars", params).subscribe((rows) => {
      this.cars.set(rows);
      const current = this.selectedCar();
      if (!current) {
        this.selectedCar.set(rows[0] ?? null);
        return;
      }
      const next = rows.find((row) => row.recordId === current.recordId) ?? rows[0] ?? null;
      this.selectedCar.set(next);
    });
  }
}
