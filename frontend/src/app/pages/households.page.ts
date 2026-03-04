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
import { Household, Zone } from "../models";
import { ApiService } from "../services/api.service";

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
        <h2>Households</h2>

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

        <div class="table-wrap">
          <table mat-table [dataSource]="dataSource">
            <ng-container matColumnDef="householdCode">
              <th mat-header-cell *matHeaderCellDef>Code</th>
              <td mat-cell *matCellDef="let row">{{ row.householdCode }}</td>
            </ng-container>

            <ng-container matColumnDef="headName">
              <th mat-header-cell *matHeaderCellDef>Head</th>
              <td mat-cell *matCellDef="let row">{{ row.headName || '-' }}</td>
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
  private readonly fb = inject(FormBuilder);

  readonly zones = signal<Zone[]>([]);
  readonly displayedColumns = ["householdCode", "headName", "originArea", "zone", "familySize", "status", "safetyCheckStatus", "actions"];
  readonly dataSource = new MatTableDataSource<Household>([]);

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

