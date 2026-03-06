import { CommonModule } from "@angular/common";
import { AfterViewInit, Component, ViewChild, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatPaginator, MatPaginatorModule } from "@angular/material/paginator";
import { MatSelectModule } from "@angular/material/select";
import { MatTableDataSource, MatTableModule } from "@angular/material/table";
import { RouterModule } from "@angular/router";
import { Household, HouseholdImportSummary, Zone } from "../models";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";

@Component({
  selector: "app-households-page",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    MatTableModule,
    MatPaginatorModule
  ],
  template: `
    <div class="shell">
      <mat-card>
        <div class="header-row">
          <h2>Households</h2>
          <div class="actions">
            <input #importFileInput type="file" accept=".xlsx,.xls" (change)="onImportFileSelected($event)" hidden />
            <button mat-button color="primary" type="button" *ngIf="canImportExcel()" (click)="downloadImportTemplate()" [disabled]="importing() || downloadingTemplate()">
              {{ downloadingTemplate() ? 'Downloading template...' : 'Download Template' }}
            </button>
            <button mat-stroked-button color="primary" type="button" *ngIf="canImportExcel()" (click)="importFileInput.click()" [disabled]="importing()">
              {{ importing() ? 'Importing...' : 'Import Excel' }}
            </button>
          </div>
        </div>

        <form class="filters" [formGroup]="filterForm" (ngSubmit)="applyFilters()">
          <mat-form-field appearance="outline">
            <mat-label>Zone</mat-label>
            <mat-select formControlName="zoneId">
              <mat-option value="">All</mat-option>
              <mat-option *ngFor="let zone of zones()" [value]="zone.id">{{ zone.name }}</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Status</mat-label>
            <mat-select formControlName="status">
              <mat-option value="">All</mat-option>
              <mat-option value="ACTIVE">ACTIVE</mat-option>
              <mat-option value="MOVED_OUT">MOVED_OUT</mat-option>
              <mat-option value="CLOSED">CLOSED</mat-option>
            </mat-select>
          </mat-form-field>

          <button mat-raised-button color="primary" type="submit">Apply</button>
          <button mat-button type="button" (click)="resetFilters()">Reset</button>
        </form>

        <div class="import-summary ok" *ngIf="importSummary() as summary">
          <p>
            Imported households: {{ summary.householdsImported }} (created {{ summary.householdsCreated }}, updated {{ summary.householdsUpdated }})
            | members: {{ summary.membersImported }} | rows with warnings: {{ summary.rowsWithWarnings }} | rows skipped: {{ summary.rowsSkipped }}
          </p>
          <p *ngIf="summary.warnings.length" class="small">
            Warnings: {{ formatIssueList(summary.warnings) }}
          </p>
          <p *ngIf="summary.skipped.length" class="small">
            Skipped: {{ formatIssueList(summary.skipped) }}
          </p>
        </div>

        <p class="import-summary err" *ngIf="importError()">{{ importError() }}</p>
        <p class="import-summary err" *ngIf="deleteError()">{{ deleteError() }}</p>

        <div class="table-wrap">
          <table mat-table [dataSource]="dataSource">
            <ng-container matColumnDef="householdCode">
              <th mat-header-cell *matHeaderCellDef>Code</th>
              <td mat-cell *matCellDef="let row">{{ row.householdCode }}</td>
            </ng-container>

            <ng-container matColumnDef="headName">
              <th mat-header-cell *matHeaderCellDef>Head</th>
              <td mat-cell *matCellDef="let row">{{ displayFamilyName(row) }}</td>
            </ng-container>

            <ng-container matColumnDef="originArea">
              <th mat-header-cell *matHeaderCellDef>Family origin</th>
              <td mat-cell *matCellDef="let row">{{ row.originArea || '-' }}</td>
            </ng-container>

            <ng-container matColumnDef="zone">
              <th mat-header-cell *matHeaderCellDef>Zone</th>
              <td mat-cell *matCellDef="let row">{{ row.zone?.name || row.zoneId }}</td>
            </ng-container>

            <ng-container matColumnDef="familySize">
              <th mat-header-cell *matHeaderCellDef>Family size</th>
              <td mat-cell *matCellDef="let row">{{ row.familySize }}</td>
            </ng-container>

            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let row">{{ row.status }}</td>
            </ng-container>

            <ng-container matColumnDef="safetyCheckStatus">
              <th mat-header-cell *matHeaderCellDef>Safety check</th>
              <td mat-cell *matCellDef="let row" [ngClass]="row.safetyCheckStatus === 'CHECKED_SAFE' ? 'status-safe' : 'status-pending'">
                {{ row.safetyCheckStatus === 'CHECKED_SAFE' ? 'Checked and safe' : 'Not checked (pending)' }}
              </td>
            </ng-container>

            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef>Actions</th>
              <td mat-cell *matCellDef="let row">
                <a mat-button color="primary" [routerLink]="['/households', row.id]">Open</a>
                <button
                  mat-button
                  color="warn"
                  type="button"
                  *ngIf="canDeleteHousehold() && pendingDeleteId() !== row.id"
                  (click)="armDeleteHousehold(row.id)"
                >
                  Delete
                </button>
                <button
                  mat-raised-button
                  color="warn"
                  type="button"
                  *ngIf="canDeleteHousehold() && pendingDeleteId() === row.id"
                  (click)="deleteHousehold(row.id)"
                >
                  Confirm delete
                </button>
                <button mat-button type="button" *ngIf="canDeleteHousehold() && pendingDeleteId() === row.id" (click)="cancelDeleteHousehold()">
                  Cancel
                </button>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
          </table>
        </div>

        <mat-paginator [pageSize]="10" [pageSizeOptions]="[10, 20, 50]"></mat-paginator>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .shell {
        padding: 1rem;
      }

      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }

      .header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .import-summary {
        margin: 0.5rem 0 0.75rem;
        padding: 0.6rem 0.75rem;
        border-radius: 0.5rem;
      }

      .import-summary.ok {
        border: 1px solid #86efac;
        background: #f0fdf4;
      }

      .import-summary.err {
        border: 1px solid #fecaca;
        background: #fef2f2;
        color: #b91c1c;
        font-weight: 600;
      }

      .import-summary p {
        margin: 0;
      }

      .import-summary .small {
        margin-top: 0.25rem;
        font-size: 0.85rem;
      }

      .table-wrap {
        overflow-x: auto;
      }

      table {
        width: 100%;
      }

      .status-pending {
        color: #b91c1c;
        font-weight: 600;
      }

      .status-safe {
        color: #15803d;
        font-weight: 600;
      }
    `
  ]
})
export class HouseholdsPageComponent implements AfterViewInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly zones = signal<Zone[]>([]);
  readonly displayedColumns = ["householdCode", "headName", "originArea", "zone", "familySize", "status", "safetyCheckStatus", "actions"];
  readonly dataSource = new MatTableDataSource<Household>([]);
  readonly importing = signal(false);
  readonly downloadingTemplate = signal(false);
  readonly importSummary = signal<HouseholdImportSummary | null>(null);
  readonly importError = signal<string | null>(null);
  readonly deleteError = signal<string | null>(null);
  readonly pendingDeleteId = signal<string | null>(null);

  readonly filterForm = this.fb.nonNullable.group({
    zoneId: [""],
    status: [""]
  });

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  ngAfterViewInit() {
    this.dataSource.paginator = this.paginator;
    this.loadZones();
    this.loadHouseholds();
  }

  applyFilters() {
    this.loadHouseholds();
  }

  resetFilters() {
    this.filterForm.setValue({ zoneId: "", status: "" });
    this.loadHouseholds();
  }

  canDeleteHousehold() {
    return this.auth.currentUser()?.role === "ADMIN";
  }

  canImportExcel() {
    const role = this.auth.currentUser()?.role;
    return role === "ADMIN" || role === "CASE_WORKER";
  }

  armDeleteHousehold(id: string) {
    if (!this.canDeleteHousehold()) {
      return;
    }
    this.deleteError.set(null);
    this.pendingDeleteId.set(id);
  }

  cancelDeleteHousehold() {
    this.pendingDeleteId.set(null);
  }

  deleteHousehold(id: string) {
    if (!this.canDeleteHousehold()) {
      return;
    }
    if (this.pendingDeleteId() !== id) {
      this.pendingDeleteId.set(id);
      return;
    }
    this.deleteError.set(null);
    this.api.delete(`/households/${id}`).subscribe({
      next: () => {
        this.pendingDeleteId.set(null);
        this.loadHouseholds();
      },
      error: (err: { error?: { message?: string } }) => {
        this.deleteError.set(err?.error?.message || "Could not delete family record.");
      }
    });
  }

  displayFamilyName(row: Household) {
    const full = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
    return full || row.headName || "-";
  }

  onImportFileSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file, file.name);

    this.importing.set(true);
    this.importError.set(null);
    this.importSummary.set(null);

    this.api.postForm<HouseholdImportSummary>("/households/import-excel", formData).subscribe({
      next: (summary) => {
        this.importing.set(false);
        this.importSummary.set(summary);
        this.importError.set(null);
        this.loadHouseholds();
        if (input) {
          input.value = "";
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.importing.set(false);
        this.importError.set(err?.error?.message || "Could not import Excel file.");
        if (input) {
          input.value = "";
        }
      }
    });
  }

  downloadImportTemplate() {
    if (!this.canImportExcel()) {
      return;
    }

    this.downloadingTemplate.set(true);
    this.importError.set(null);

    this.api.getBlob("/households/import-excel/template").subscribe({
      next: (blob) => {
        this.downloadingTemplate.set(false);
        const fileUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = fileUrl;
        anchor.download = "household-import-template.xlsx";
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(fileUrl);
      },
      error: (err: { error?: { message?: string } }) => {
        this.downloadingTemplate.set(false);
        this.importError.set(err?.error?.message || "Could not download Excel template.");
      }
    });
  }

  formatIssueList(items: Array<{ rowNumber: number; message: string }>) {
    return items
      .slice(0, 5)
      .map((issue) => `row ${issue.rowNumber}: ${issue.message}`)
      .join(" | ");
  }

  private loadZones() {
    this.api.get<Zone[]>("/zones").subscribe((zones) => this.zones.set(zones));
  }

  private loadHouseholds() {
    const filter = this.filterForm.getRawValue();
    const params: Record<string, string> = {};

    if (filter.zoneId) {
      params["zoneId"] = filter.zoneId;
    }
    if (filter.status) {
      params["status"] = filter.status;
    }

    this.api.get<Household[]>("/households", params).subscribe((rows) => {
      this.dataSource.data = rows;
    });
  }
}

