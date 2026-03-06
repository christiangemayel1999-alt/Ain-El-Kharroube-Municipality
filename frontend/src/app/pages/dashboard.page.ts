import { CommonModule } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import { AfterViewInit, Component, OnDestroy, inject, signal } from "@angular/core";
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ChartData, ChartOptions, ChartType, registerables } from "chart.js";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatDividerModule } from "@angular/material/divider";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatListModule } from "@angular/material/list";
import { MatSelectModule } from "@angular/material/select";
import { MatSidenavModule } from "@angular/material/sidenav";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import { BaseChartDirective } from "ng2-charts";
import * as L from "leaflet";
import { DashboardSummary, EmergencyPlan, MapReference, MapReferenceType, NotificationItem, Zone } from "../models";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";
import { Chart } from "chart.js";

Chart.register(...registerables);
type MapMarker = DashboardSummary["mapMarkers"][number];
type HoveredPolicePoint = {
  label: string;
  officersCount: number;
  lat: number;
  lng: number;
  planName: string;
};

type ReferenceCategoryOption = {
  value: MapReferenceType;
  label: string;
  shortIcon: string;
  defaultColor: string;
};

type ReportZoneRow = {
  zone: string;
  households: number;
  individuals: number;
  avgFamilySize: number;
  populationSharePct: number;
};

type ReportVm = {
  generatedAt: string;
  totalHouseholds: number;
  totalIndividuals: number;
  averageFamilySize: number;
  pendingChecks: number;
  pendingChecksPct: number;
  checkedSafePct: number;
  highPriorityCases: number;
  highPriorityPct: number;
  householdsWithCars: number;
  householdsWithCarsPct: number;
  topNeed: string | null;
  topZoneByIndividuals: string | null;
  zoneRows: ReportZoneRow[];
};

const referenceCategoryOptions: ReferenceCategoryOption[] = [
  { value: "ROAD", label: "Road", shortIcon: "R", defaultColor: "#0ea5e9" },
  { value: "IMPORTANT_BUILDING", label: "Important building", shortIcon: "B", defaultColor: "#8b5cf6" },
  { value: "MUNICIPALITY_POINT", label: "Municipality point", shortIcon: "M", defaultColor: "#f97316" },
  { value: "CHECKPOINT", label: "Checkpoint", shortIcon: "C", defaultColor: "#dc2626" },
  { value: "SCHOOL", label: "School", shortIcon: "S", defaultColor: "#2563eb" },
  { value: "CHURCH_MOSQUE", label: "Church / mosque", shortIcon: "CM", defaultColor: "#7c3aed" },
  { value: "SHELTER", label: "Shelter", shortIcon: "SH", defaultColor: "#16a34a" },
  { value: "WATER_POINT", label: "Water point", shortIcon: "W", defaultColor: "#0891b2" },
  { value: "LANDMARK", label: "Landmark", shortIcon: "L", defaultColor: "#ca8a04" },
  { value: "CUSTOM", label: "Custom", shortIcon: "*", defaultColor: "#475569" }
];

@Component({
  selector: "app-dashboard-page",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatSidenavModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatListModule,
    MatSlideToggleModule,
    MatDividerModule,
    BaseChartDirective
  ],
  template: `
    <mat-drawer-container class="drawer-container" [hasBackdrop]="false">
      <mat-drawer #drawer position="end" mode="over" [opened]="drawerOpen()" [disableClose]="true">
        <div class="drawer-content">
          <h2>Pin New Family Arrival</h2>
          <p class="muted">Select exact or privacy-grid pin precision for storage.</p>
          <div class="step-state">
            <span [class.done]="locationStepDone()">1. Pin selected</span>
            <span [class.done]="householdStepDone()">2. Details complete</span>
            <span [class.done]="membersStepDone()">3. Members complete</span>
          </div>
          <p class="error-text" *ngIf="saveError()">{{ saveError() }}</p>

          <form [formGroup]="arrivalForm" (ngSubmit)="submitArrival()" class="arrival-form">
            <section class="drawer-section">
              <h3>1. Location pin</h3>
              <mat-form-field appearance="outline">
                <mat-label>Location input</mat-label>
                <mat-select formControlName="locationMethod">
                  <mat-option value="MAP">Pin on map</mat-option>
                  <mat-option value="GOOGLE_LINK">Google Maps shared link</mat-option>
                  <mat-option value="MANUAL">Latitude / Longitude</mat-option>
                </mat-select>
              </mat-form-field>

              <div *ngIf="locationMethod() === 'MAP'" class="location-input-block">
                <button mat-stroked-button type="button" (click)="enablePickLocation()">
                  {{ pickingLocation() ? 'Click on map...' : 'Pick location on map' }}
                </button>
                <p class="picked" *ngIf="clickedCoord() as c">Pin selected: {{ c.lat | number:'1.5-5' }}, {{ c.lng | number:'1.5-5' }}</p>
              </div>

              <div *ngIf="locationMethod() === 'GOOGLE_LINK'" class="location-input-block">
                <mat-form-field appearance="outline">
                  <mat-label>Google Maps link</mat-label>
                  <input matInput formControlName="googleMapsUrl" placeholder="Paste long link with coordinates" />
                </mat-form-field>
                <button mat-stroked-button type="button" (click)="applyGoogleLinkLocation()">Use this link</button>
              </div>

              <div *ngIf="locationMethod() === 'MANUAL'" class="location-input-block">
                <div class="coord-grid">
                  <mat-form-field appearance="outline">
                    <mat-label>Latitude</mat-label>
                    <input matInput type="number" formControlName="manualLat" />
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>Longitude</mat-label>
                    <input matInput type="number" formControlName="manualLng" />
                  </mat-form-field>
                </div>
                <button mat-stroked-button type="button" (click)="applyManualCoordinates()">Use these coordinates</button>
              </div>

              <mat-form-field appearance="outline">
                <mat-label>Pin precision</mat-label>
                <mat-select formControlName="precisionMode">
                  <mat-option value="EXACT">Exact location (100%)</mat-option>
                  <mat-option value="GRID_500M">Privacy grid (500m)</mat-option>
                </mat-select>
              </mat-form-field>
              <p class="picked" *ngIf="selectedSectionLabel() as sectionLabel">Auto section: {{ sectionLabel }}</p>
            </section>

            <section class="drawer-section">
              <h3>2. Household details</h3>
              <mat-form-field appearance="outline">
                <mat-label>Household full name</mat-label>
                <input matInput formControlName="headName" />
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Phone number</mat-label>
                <input matInput formControlName="phoneNumber" />
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Map pin label</mat-label>
                <input matInput formControlName="pinLabel" placeholder="e.g. Near Church Street" />
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Preferred language</mat-label>
                <input matInput formControlName="preferredLanguage" />
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Housing type</mat-label>
                <mat-select formControlName="housingType">
                  <mat-option value="RENTAL">RENTAL</mat-option>
                  <mat-option value="HOST">HOST</mat-option>
                  <mat-option value="SHELTER">SHELTER</mat-option>
                  <mat-option value="OTHER">OTHER</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Arrival date</mat-label>
                <input matInput type="date" formControlName="arrivalDate" />
              </mat-form-field>

              <div class="contact-block">
                <h4>Emergency contact</h4>
                <div class="coord-grid">
                  <mat-form-field appearance="outline">
                    <mat-label>Name</mat-label>
                    <input matInput formControlName="emergencyName" />
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Phone</mat-label>
                    <input matInput formControlName="emergencyPhone" />
                  </mat-form-field>
                </div>

                <mat-form-field appearance="outline">
                  <mat-label>Relation</mat-label>
                  <input matInput formControlName="emergencyRelation" />
                </mat-form-field>
              </div>
            </section>

            <section class="drawer-section" formArrayName="members">
              <h3>3. Family members</h3>
              <p class="muted">Enter full member identity details for each person.</p>

              <div class="member-card" *ngFor="let member of membersArray.controls; let i = index" [formGroupName]="i">
                <div class="member-row">
                  <mat-form-field appearance="outline">
                    <mat-label>First name {{ i + 1 }}</mat-label>
                    <input matInput formControlName="firstName" />
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Last name</mat-label>
                    <input matInput formControlName="lastName" />
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Gender</mat-label>
                    <mat-select formControlName="gender">
                      <mat-option value="MALE">Male</mat-option>
                      <mat-option value="FEMALE">Female</mat-option>
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Age</mat-label>
                    <input matInput type="number" formControlName="age" />
                  </mat-form-field>

                  <button mat-stroked-button type="button" (click)="removeMember(i)" [disabled]="membersArray.length <= 1">
                    Remove
                  </button>
                </div>

                <div class="member-extra-row">
                  <div class="member-extra-grid">
                    <mat-form-field appearance="outline">
                      <mat-label>Father name</mat-label>
                      <input matInput formControlName="fatherName" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Mother name</mat-label>
                      <input matInput formControlName="motherName" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Civil identity number</mat-label>
                      <input matInput formControlName="civilIdentityNumber" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Phone number</mat-label>
                      <input matInput formControlName="phoneNumber" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Origin area</mat-label>
                      <input matInput formControlName="originArea" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Nationality</mat-label>
                      <input matInput formControlName="nationality" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Relation to head</mat-label>
                      <input matInput formControlName="relationshipToHead" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Member safety check</mat-label>
                      <mat-select formControlName="safetyCheckStatus">
                        <mat-option value="PENDING">NOT CHECKED (PENDING)</mat-option>
                        <mat-option value="CHECKED_SAFE">CHECKED AND SAFE</mat-option>
                      </mat-select>
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Has car?</mat-label>
                      <mat-select formControlName="hasCar">
                        <mat-option [value]="false">No</mat-option>
                        <mat-option [value]="true">Yes</mat-option>
                      </mat-select>
                    </mat-form-field>

                    <div class="member-car-grid" *ngIf="member.get('hasCar')?.value">
                      <mat-form-field appearance="outline">
                        <mat-label>Car model</mat-label>
                        <input matInput formControlName="carModel" />
                      </mat-form-field>

                      <mat-form-field appearance="outline">
                        <mat-label>Car color</mat-label>
                        <input matInput formControlName="carColor" />
                      </mat-form-field>

                      <mat-form-field appearance="outline">
                        <mat-label>Car number</mat-label>
                        <input matInput formControlName="carPlate" />
                      </mat-form-field>
                    </div>

                    <mat-form-field appearance="outline">
                      <mat-label>Year of birth</mat-label>
                      <input matInput type="number" formControlName="yearOfBirth" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>ID status</mat-label>
                      <mat-select formControlName="idDocStatus">
                        <mat-option value="UNKNOWN">UNKNOWN</mat-option>
                        <mat-option value="HAS_ID">HAS ID</mat-option>
                        <mat-option value="NO_ID">NO ID</mat-option>
                      </mat-select>
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>ID type</mat-label>
                      <input matInput formControlName="idDocType" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>ID last 4</mat-label>
                      <input matInput formControlName="idDocLast4" />
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>School enrollment</mat-label>
                      <mat-select formControlName="schoolEnrollment">
                        <mat-option value="ENROLLED">ENROLLED</mat-option>
                        <mat-option value="NOT_ENROLLED">NOT_ENROLLED</mat-option>
                        <mat-option value="NA">N/A</mat-option>
                      </mat-select>
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Employment</mat-label>
                      <mat-select formControlName="employmentStatus">
                        <mat-option value="EMPLOYED">EMPLOYED</mat-option>
                        <mat-option value="UNEMPLOYED">UNEMPLOYED</mat-option>
                        <mat-option value="NA">N/A</mat-option>
                      </mat-select>
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Disability</mat-label>
                      <mat-select formControlName="hasDisability">
                        <mat-option [value]="false">No</mat-option>
                        <mat-option [value]="true">Yes</mat-option>
                      </mat-select>
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Chronic condition</mat-label>
                      <mat-select formControlName="hasChronicCondition">
                        <mat-option [value]="false">No</mat-option>
                        <mat-option [value]="true">Yes</mat-option>
                      </mat-select>
                    </mat-form-field>

                    <mat-form-field appearance="outline">
                      <mat-label>Pregnant / lactating</mat-label>
                      <mat-select formControlName="pregnantOrLactating">
                        <mat-option [value]="false">No</mat-option>
                        <mat-option [value]="true">Yes</mat-option>
                      </mat-select>
                    </mat-form-field>
                  </div>
                </div>
              </div>

              <button mat-button type="button" (click)="addMember()">+ Add person</button>
              <p class="muted summary-line">
                Family size: {{ membersArray.length }} | 0-4: {{ ageSummary().age0_4 }} | 5-17: {{ ageSummary().age5_17 }} |
                18-59: {{ ageSummary().age18_59 }} | 60+: {{ ageSummary().age60plus }}
              </p>
            </section>

            <div class="button-row">
              <button mat-raised-button color="primary" [disabled]="arrivalForm.invalid || !locationStepDone() || submitting() || membersArray.length < 1">
                {{ submitting() ? 'Saving...' : 'Save family pin' }}
              </button>
              <button mat-button type="button" (click)="closeDrawer()">Cancel</button>
            </div>
          </form>
        </div>
      </mat-drawer>

      <mat-drawer-content>
        <div class="dashboard-shell">
          <div class="top-grid">
            <mat-card class="map-card">
              <div class="card-title-row">
                <h2>Command Map</h2>
                <div class="map-actions">
                  <button mat-raised-button color="primary" (click)="openDrawer()">Pin New Family</button>
                  <button mat-stroked-button type="button" (click)="toggleEmergencyBuilder()">
                    {{ emergencyBuilderOpen() ? 'Hide emergency plan' : 'Emergency plan' }}
                  </button>
                  <button mat-stroked-button type="button" *ngIf="!borderDrawing()" (click)="startBorderDrawing()">
                    Draw Border
                  </button>
                  <button mat-stroked-button type="button" *ngIf="borderDrawing()" (click)="finishBorderDrawing()">
                    Finish Border
                  </button>
                  <button mat-button type="button" [disabled]="borderPointsCount() === 0" (click)="clearBorder()">
                    Clear Border
                  </button>
                </div>
              </div>
              <div id="dashboard-map"></div>
              <p class="muted">Satellite view centered on Ain El Kharroube (33.93444, 35.69972)</p>
              <div class="overlay-toggles">
                <mat-slide-toggle [checked]="householdPinsEnabled()" (change)="setHouseholdPinsEnabled($event.checked)">
                  Household pins
                </mat-slide-toggle>
                <mat-slide-toggle [checked]="householdLabelsEnabled()" (change)="setHouseholdLabelsEnabled($event.checked)">
                  Household labels
                </mat-slide-toggle>
                <mat-slide-toggle [checked]="mapReferencesEnabled()" (change)="setMapReferencesEnabled($event.checked)">
                  References
                </mat-slide-toggle>
                <mat-slide-toggle [checked]="referenceLabelsEnabled()" (change)="setReferenceLabelsEnabled($event.checked)">
                  Reference labels
                </mat-slide-toggle>
                <mat-slide-toggle [checked]="zoneLabelsEnabled()" (change)="setZoneLabelsEnabled($event.checked)">
                  Zone labels
                </mat-slide-toggle>
                <mat-slide-toggle [checked]="heatmapEnabled()" (change)="setHeatmapEnabled($event.checked)">
                  Heat map
                </mat-slide-toggle>
                <mat-slide-toggle [checked]="zoneGuidesEnabled()" (change)="setZoneGuidesEnabled($event.checked)">
                  Zone guide lines
                </mat-slide-toggle>
              </div>
              <p class="muted">
                Heat map shows household density and priority. References include roads/buildings/checkpoints. Labels appear automatically when zooming in.
              </p>
              <div class="reference-search" *ngIf="summary()">
                <div class="reference-search-row">
                  <mat-form-field appearance="outline" class="reference-search-field">
                    <mat-label>Find family/member on map</mat-label>
                    <input
                      #searchFamilyInput
                      matInput
                      [value]="householdSearchQuery()"
                      (input)="setHouseholdSearchQuery(searchFamilyInput.value)"
                      placeholder="Search by family code, name, phone, or member name"
                    />
                  </mat-form-field>
                  <button mat-stroked-button type="button" (click)="clearHouseholdSearch()" [disabled]="!householdSearchQuery().trim().length">
                    Clear
                  </button>
                </div>
                <div class="reference-search-results" *ngIf="householdSearchQuery().trim().length > 0">
                  <button mat-button type="button" class="reference-hit" *ngFor="let marker of searchedHouseholdMarkers().slice(0, 8)" (click)="focusHouseholdOnMap(marker)">
                    {{ marker.householdCode }} - {{ marker.headName || ((marker.firstName || '-') + ' ' + (marker.lastName || '')) }}
                  </button>
                  <p class="muted" *ngIf="!searchedHouseholdMarkers().length">No matching family/member found.</p>
                </div>
              </div>
              <div class="reference-search" *ngIf="summary()">
                <div class="reference-search-row">
                  <mat-form-field appearance="outline" class="reference-search-field">
                    <mat-label>Find reference on map</mat-label>
                    <input
                      #searchReferenceInput
                      matInput
                      [value]="referenceSearchQuery()"
                      (input)="setReferenceSearchQuery(searchReferenceInput.value)"
                      placeholder="Search by name, category, or note"
                    />
                  </mat-form-field>
                  <button mat-stroked-button type="button" (click)="clearReferenceSearch()" [disabled]="!referenceSearchQuery().trim().length">
                    Clear
                  </button>
                </div>
                <div class="reference-search-results" *ngIf="referenceSearchQuery().trim().length > 0">
                  <button mat-button type="button" class="reference-hit" *ngFor="let reference of searchedMapReferences().slice(0, 8)" (click)="focusReferenceOnMap(reference)">
                    {{ reference.name }} - {{ mapReferenceTypeLabel(reference.type) }}
                  </button>
                  <p class="muted" *ngIf="!searchedMapReferences().length">No matching reference found.</p>
                </div>
              </div>
              <p class="muted" *ngIf="borderDrawing()">
                Border drawing mode is active: click map points around the village, then press "Finish Border".
                Points: {{ borderPointsCount() }}
              </p>
              <p class="success-text" *ngIf="borderMessage()">{{ borderMessage() }}</p>
              <p class="muted" *ngIf="activeEmergencyPlan() as plan">
                Active emergency plan: <strong>{{ plan.name }}</strong>
              </p>
              <p class="success-text" *ngIf="saveSuccess()">{{ saveSuccess() }}</p>
              <p class="success-text" *ngIf="emergencySuccess()">{{ emergencySuccess() }}</p>
              <p class="error-text" *ngIf="emergencyError()">{{ emergencyError() }}</p>
              <mat-card class="hover-family-card" *ngIf="activeMapMarker() as marker">
                <div class="card-title-row">
                  <h3>{{ selectedMarker()?.id === marker.id ? 'Family at selected pin' : 'Family at hovered pin' }}</h3>
                  <button mat-button type="button" *ngIf="selectedMarker()?.id === marker.id" (click)="clearSelectedMarker()">
                    Clear pin
                  </button>
                </div>
                <p><strong>Label:</strong> {{ marker.pinLabel || "-" }}</p>
                <p><strong>Code:</strong> {{ marker.householdCode }}</p>
                <p><strong>Name:</strong> {{ marker.firstName || "-" }} {{ marker.lastName || "" }}</p>
                <p><strong>Father / Mother:</strong> {{ marker.fatherName || "-" }} / {{ marker.motherName || "-" }}</p>
                <p><strong>Civil ID:</strong> {{ marker.civilIdentityNumber || "-" }}</p>
                <p><strong>Phone:</strong> {{ marker.phoneNumber || "-" }}</p>
                <p><strong>Head:</strong> {{ marker.headName || '-' }}</p>
                <p><strong>Family origin:</strong> {{ marker.originArea || '-' }}</p>
                <p><strong>Arrival:</strong> {{ marker.arrivalDate | date:'yyyy-MM-dd' }}</p>
                <p><strong>Family size:</strong> {{ marker.familySize }}</p>
                <p>
                  <strong>Ages:</strong>
                  0-4: {{ marker.age0_4 }},
                  5-17: {{ marker.age5_17 }},
                  18-59: {{ marker.age18_59 }},
                  60+: {{ marker.age60plus }}
                </p>
                <p [ngClass]="safetyClass(marker.safetyCheckStatus)">
                  <strong>Safety check:</strong> {{ marker.safetyCheckStatus === 'CHECKED_SAFE' ? 'Checked and safe' : 'Not checked (pending)' }}
                </p>
                <p><strong>Has car:</strong> {{ marker.hasCar ? 'Yes' : 'No' }}</p>
                <p *ngIf="marker.hasCar"><strong>Car:</strong> {{ marker.carModel || '-' }} | {{ marker.carColor || '-' }} | {{ marker.carPlate || '-' }}</p>
                <p><strong>Pin precision:</strong> {{ marker.pinPrecisionM === 0 ? 'Exact' : '+/-' + marker.pinPrecisionM + 'm' }}</p>
              </mat-card>
              <mat-card class="hover-family-card" *ngIf="hoveredPolicePoint() as post">
                <h3>Security point at hovered marker</h3>
                <p><strong>Plan:</strong> {{ post.planName }}</p>
                <p><strong>Post:</strong> {{ post.label }}</p>
                <p><strong>Officers:</strong> {{ post.officersCount }}</p>
                <p><strong>Coordinates:</strong> {{ post.lat | number:'1.5-5' }}, {{ post.lng | number:'1.5-5' }}</p>
              </mat-card>
              <mat-card class="hover-family-card" *ngIf="activeMapReference() as reference">
                <div class="card-title-row">
                  <h3>{{ selectedMapReference()?.id === reference.id ? 'Selected reference' : 'Hovered reference' }}</h3>
                  <button mat-button type="button" *ngIf="selectedMapReference()?.id === reference.id" (click)="clearSelectedMapReference()">
                    Clear reference
                  </button>
                </div>
                <p><strong>Name:</strong> {{ reference.name }}</p>
                <p><strong>Category:</strong> {{ mapReferenceTypeLabel(reference.type) }}</p>
                <p><strong>Description:</strong> {{ reference.description || '-' }}</p>
                <p><strong>Coordinates:</strong> {{ reference.lat | number:'1.5-5' }}, {{ reference.lng | number:'1.5-5' }}</p>
                <p><strong>Visibility:</strong> {{ reference.visible ? 'Visible on map' : 'Hidden' }}</p>
              </mat-card>
            </mat-card>

            <mat-card class="queue-card" *ngIf="summary() as s">
              <h2>Work Queue</h2>

              <div class="kpi-grid">
                <div class="kpi"><span>Active households</span><strong>{{ s.kpis.totalHouseholdsActive }}</strong></div>
                <div class="kpi"><span>Individuals</span><strong>{{ s.kpis.totalIndividuals }}</strong></div>
                <div class="kpi"><span>Occupied units</span><strong>{{ s.kpis.occupiedUnits }}</strong></div>
                <div class="kpi"><span>Available units</span><strong>{{ s.kpis.availableUnits }}</strong></div>
                <div class="kpi"><span>Children (0-17)</span><strong>{{ s.kpis.children0_17 }}</strong></div>
                <div class="kpi"><span>Elderly (60+)</span><strong>{{ s.kpis.elderly60plus }}</strong></div>
              </div>

              <mat-divider></mat-divider>
              <h3>Pending safety checks</h3>
              <mat-list>
                <mat-list-item *ngFor="let h of s.workQueue.pendingChecks.slice(0, 8)">
                  {{ h.householdCode }} - {{ h.firstName || '' }} {{ h.lastName || '' }} - {{ h.zoneName || h.zoneId }}
                  - {{ h.phoneNumber || 'No phone' }}
                </mat-list-item>
              </mat-list>

              <mat-divider *ngIf="isPoliceUser()"></mat-divider>
              <div class="emergency-panel" *ngIf="isPoliceUser()">
                <h3>Police Notifications</h3>
                <p class="muted" *ngIf="notificationError()">{{ notificationError() }}</p>
                <p class="muted" *ngIf="!notificationError() && !notifications().length">No notifications.</p>
                <mat-list>
                  <mat-list-item *ngFor="let n of notifications().slice(0, 8)">
                    <div class="notif-line">
                      <span [class.status-pending]="!n.isRead"><strong>{{ n.title }}</strong> - {{ n.message }}</span>
                      <button mat-button type="button" *ngIf="!n.isRead" (click)="markNotificationRead(n.id)">Mark read</button>
                    </div>
                  </mat-list-item>
                </mat-list>
              </div>

              <mat-divider></mat-divider>
              <div class="emergency-panel">
                <h3>Emergency Plan Overlay</h3>
                <mat-slide-toggle
                  [checked]="emergencyOverlayEnabled()"
                  (change)="setEmergencyOverlayEnabled($event.checked)"
                >
                  Enable emergency plan on map
                </mat-slide-toggle>

                <p class="muted" *ngIf="activeEmergencyPlan() as plan">
                  Active: {{ plan.name }} | Police posts: {{ plan.policePosts.length }}
                </p>
                <p class="muted" *ngIf="!activeEmergencyPlan()">No active emergency plan yet.</p>

                <form *ngIf="emergencyBuilderOpen()" [formGroup]="emergencyPlanForm" (ngSubmit)="saveEmergencyPlan()" class="emergency-form">
                  <mat-form-field appearance="outline">
                    <mat-label>Plan name</mat-label>
                    <input matInput formControlName="name" />
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Description</mat-label>
                    <input matInput formControlName="description" />
                  </mat-form-field>

                  <mat-slide-toggle formControlName="isActive">Set as active plan</mat-slide-toggle>

                  <section formArrayName="policePosts" class="emergency-section">
                    <h4>Police positions</h4>
                    <div class="emergency-item" *ngFor="let post of policePostsArray.controls; let i = index" [formGroupName]="i">
                      <mat-form-field appearance="outline">
                        <mat-label>Post label</mat-label>
                        <input matInput formControlName="label" />
                      </mat-form-field>
                      <div class="coord-grid">
                        <mat-form-field appearance="outline">
                          <mat-label>Lat</mat-label>
                          <input matInput type="number" formControlName="lat" />
                        </mat-form-field>
                        <mat-form-field appearance="outline">
                          <mat-label>Lng</mat-label>
                          <input matInput type="number" formControlName="lng" />
                        </mat-form-field>
                      </div>
                      <mat-form-field appearance="outline">
                        <mat-label>Officers count</mat-label>
                        <input matInput type="number" formControlName="officersCount" />
                      </mat-form-field>
                      <div class="button-row left">
                        <button mat-stroked-button type="button" (click)="pickPolicePoint(i)">
                          Pick point on map
                        </button>
                        <button mat-button type="button" (click)="removePolicePost(i)" [disabled]="policePostsArray.length <= 1">
                          Remove
                        </button>
                      </div>
                    </div>
                    <button mat-button type="button" (click)="addPolicePost()">+ Add police post</button>
                  </section>

                  <div class="button-row left">
                    <button mat-raised-button color="primary" [disabled]="emergencySaving() || emergencyPlanForm.invalid">
                      {{ emergencySaving() ? 'Saving...' : 'Save emergency plan' }}
                    </button>
                    <button mat-button type="button" (click)="resetEmergencyPlanForm()">Reset</button>
                  </div>
                </form>
              </div>

              <mat-divider *ngIf="isAdminUser()"></mat-divider>
              <div class="reference-panel" *ngIf="isAdminUser()">
                <h3>Map References</h3>
                <p class="muted">Create landmarks, checkpoints, roads, and orientation points. Click map to place coordinates quickly.</p>
                <p class="success-text" *ngIf="referenceSuccess()">{{ referenceSuccess() }}</p>
                <p class="error-text" *ngIf="referenceError()">{{ referenceError() }}</p>

                <form [formGroup]="mapReferenceForm" (ngSubmit)="saveMapReference()" class="reference-form">
                  <mat-form-field appearance="outline">
                    <mat-label>Reference name</mat-label>
                    <input matInput formControlName="name" />
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Category</mat-label>
                    <mat-select formControlName="type">
                      <mat-option *ngFor="let option of mapReferenceTypes" [value]="option.value">
                        {{ option.label }}
                      </mat-option>
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Description (optional)</mat-label>
                    <input matInput formControlName="description" />
                  </mat-form-field>

                  <div class="coord-grid">
                    <mat-form-field appearance="outline">
                      <mat-label>Latitude</mat-label>
                      <input matInput type="number" formControlName="lat" />
                    </mat-form-field>
                    <mat-form-field appearance="outline">
                      <mat-label>Longitude</mat-label>
                      <input matInput type="number" formControlName="lng" />
                    </mat-form-field>
                  </div>

                  <div class="coord-grid">
                    <mat-form-field appearance="outline">
                      <mat-label>Color (#RRGGBB)</mat-label>
                      <input matInput formControlName="color" placeholder="#2563eb" />
                    </mat-form-field>
                    <mat-form-field appearance="outline">
                      <mat-label>Marker icon text</mat-label>
                      <input matInput formControlName="icon" placeholder="e.g. H1" />
                    </mat-form-field>
                  </div>

                  <mat-slide-toggle formControlName="visible">Visible on dashboard map</mat-slide-toggle>

                  <div class="button-row left">
                    <button mat-stroked-button type="button" (click)="pickMapReferencePoint()">
                      {{ referencePickMode() ? 'Click on map...' : 'Pick point on map' }}
                    </button>
                    <button mat-raised-button color="primary" [disabled]="referenceSaving() || mapReferenceForm.invalid">
                      {{ referenceSaving() ? 'Saving...' : (editingReferenceId() ? 'Update reference' : 'Create reference') }}
                    </button>
                    <button mat-button type="button" (click)="resetMapReferenceForm()">Reset</button>
                  </div>
                </form>

                <mat-form-field appearance="outline">
                  <mat-label>Filter references</mat-label>
                  <mat-select [value]="referenceFilterType()" (selectionChange)="referenceFilterType.set($event.value)">
                    <mat-option value="ALL">All categories</mat-option>
                    <mat-option *ngFor="let option of mapReferenceTypes" [value]="option.value">
                      {{ option.label }}
                    </mat-option>
                  </mat-select>
                </mat-form-field>

                <div class="reference-list">
                  <div class="reference-item" *ngFor="let reference of filteredMapReferences()">
                    <div class="reference-item-main">
                      <strong>{{ reference.name }}</strong>
                      <span>{{ mapReferenceTypeLabel(reference.type) }}</span>
                      <span class="muted">{{ reference.lat | number:'1.5-5' }}, {{ reference.lng | number:'1.5-5' }}</span>
                    </div>
                    <div class="button-row left">
                      <button mat-button type="button" (click)="editMapReference(reference)">Edit</button>
                      <button mat-button type="button" color="warn" (click)="deleteMapReference(reference)">Delete</button>
                    </div>
                  </div>
                  <p class="muted" *ngIf="!filteredMapReferences().length">No references in this filter.</p>
                </div>
              </div>
            </mat-card>
          </div>

          <div class="charts-grid">
            <mat-card class="chart-card">
              <h3>Households by zone</h3>
              <div class="chart-wrap">
                <canvas baseChart [data]="householdsByZoneChart" [type]="'bar'" [options]="chartOptions"></canvas>
              </div>
            </mat-card>

            <mat-card class="chart-card">
              <h3>Individuals by zone</h3>
              <div class="chart-wrap">
                <canvas baseChart [data]="individualsByZoneChart" [type]="'bar'" [options]="chartOptions"></canvas>
              </div>
            </mat-card>

            <mat-card class="chart-card">
              <h3>Needs breakdown</h3>
              <div class="chart-wrap">
                <canvas baseChart [data]="needsChart" [type]="'pie'" [options]="pieOptions"></canvas>
              </div>
            </mat-card>

            <mat-card class="chart-card">
              <h3>New arrivals per week</h3>
              <div class="chart-wrap">
                <canvas baseChart [data]="arrivalsLineChart" [type]="'line'" [options]="chartOptions"></canvas>
              </div>
            </mat-card>
          </div>

          <mat-card *ngIf="summary() as s">
            <h3>Recent arrivals</h3>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Head</th>
                    <th>Family origin</th>
                    <th>Arrival</th>
                    <th>Family size</th>
                    <th>Safety check</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let h of s.recentArrivals.slice(0, 10)">
                    <td>{{ h.householdCode }}</td>
                    <td>{{ h.headName || '-' }}</td>
                    <td>{{ h.originArea || '-' }}</td>
                    <td>{{ h.arrivalDate | date:'yyyy-MM-dd' }}</td>
                    <td>{{ h.familySize }}</td>
                    <td [ngClass]="safetyClass(h.safetyCheckStatus)">
                      {{ h.safetyCheckStatus === 'CHECKED_SAFE' ? 'Checked and safe' : 'Not checked (pending)' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </mat-card>

          <mat-card class="report-card" *ngIf="reportVm() as report">
            <div class="report-header">
              <div>
                <h3>Executive Report</h3>
                <p class="muted">Generated: {{ report.generatedAt | date:'yyyy-MM-dd HH:mm' }} | Scope: active households</p>
              </div>
              <div class="button-row left">
                <button mat-stroked-button type="button" (click)="downloadOperationsReportWorkbook()">Export Excel (2 sheets)</button>
                <button mat-button type="button" (click)="printExecutiveReport()">Print</button>
              </div>
            </div>

            <div class="report-metrics">
              <div class="metric-tile">
                <span>Average family size</span>
                <strong>{{ report.averageFamilySize | number:'1.1-2' }}</strong>
              </div>
              <div class="metric-tile">
                <span>Checked safe</span>
                <strong>{{ report.checkedSafePct | number:'1.0-1' }}%</strong>
              </div>
              <div class="metric-tile">
                <span>Pending checks</span>
                <strong>{{ report.pendingChecks }} ({{ report.pendingChecksPct | number:'1.0-1' }}%)</strong>
              </div>
              <div class="metric-tile">
                <span>High priority cases</span>
                <strong>{{ report.highPriorityCases }} ({{ report.highPriorityPct | number:'1.0-1' }}%)</strong>
              </div>
              <div class="metric-tile">
                <span>Households with cars</span>
                <strong>{{ report.householdsWithCars }} ({{ report.householdsWithCarsPct | number:'1.0-1' }}%)</strong>
              </div>
              <div class="metric-tile">
                <span>Top zone by individuals</span>
                <strong>{{ report.topZoneByIndividuals || '-' }}</strong>
              </div>
            </div>

            <p class="muted">Top need reported: <strong>{{ report.topNeed || '-' }}</strong></p>

            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>Households</th>
                    <th>Individuals</th>
                    <th>Avg family size</th>
                    <th>Population share</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of report.zoneRows">
                    <td>{{ row.zone }}</td>
                    <td>{{ row.households }}</td>
                    <td>{{ row.individuals }}</td>
                    <td>{{ row.avgFamilySize | number:'1.1-2' }}</td>
                    <td>{{ row.populationSharePct | number:'1.0-1' }}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </mat-card>
        </div>
      </mat-drawer-content>
    </mat-drawer-container>
  `,
  styles: [
    `
      .drawer-container {
        min-height: calc(100vh - 64px);
      }

      .dashboard-shell {
        display: grid;
        gap: 1rem;
        padding: 1rem;
      }

      .top-grid {
        display: grid;
        gap: 1rem;
        grid-template-columns: 2fr 1fr;
      }

      .card-title-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
      }

      .map-actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      #dashboard-map {
        width: 100%;
        height: 420px;
        border-radius: 0.5rem;
      }

      .queue-card {
        overflow: auto;
      }

      .emergency-panel {
        margin-top: 0.75rem;
        display: grid;
        gap: 0.6rem;
      }

      .emergency-form {
        display: grid;
        gap: 0.6rem;
        background: #f8fafc;
        border: 1px solid #d6e0e7;
        border-radius: 0.5rem;
        padding: 0.75rem;
      }

      .emergency-section {
        display: grid;
        gap: 0.5rem;
        border-top: 1px solid #e2e8f0;
        padding-top: 0.5rem;
      }

      .emergency-section h4 {
        margin: 0;
        font-size: 0.9rem;
      }

      .emergency-item {
        display: grid;
        gap: 0.5rem;
        border: 1px dashed #cbd5e1;
        border-radius: 0.5rem;
        padding: 0.6rem;
      }

      .reference-panel {
        margin-top: 0.75rem;
        display: grid;
        gap: 0.6rem;
      }

      .reference-form {
        display: grid;
        gap: 0.6rem;
        background: #f8fafc;
        border: 1px solid #d6e0e7;
        border-radius: 0.5rem;
        padding: 0.75rem;
      }

      .reference-list {
        display: grid;
        gap: 0.45rem;
      }

      .reference-item {
        display: flex;
        justify-content: space-between;
        gap: 0.5rem;
        align-items: center;
        border: 1px solid #d6e0e7;
        border-radius: 0.5rem;
        padding: 0.55rem 0.65rem;
        background: #fbfdff;
      }

      .reference-item-main {
        display: grid;
        gap: 0.12rem;
      }

      .notif-line {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }

      .kpi-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .kpi {
        background: #edf4f2;
        border-radius: 0.5rem;
        padding: 0.75rem;
        display: grid;
      }

      .kpi span {
        font-size: 0.8rem;
        color: #333;
      }

      .kpi strong {
        font-size: 1.25rem;
      }

      .charts-grid {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .chart-card {
        display: flex;
        flex-direction: column;
        min-height: 340px;
      }

      .chart-wrap {
        position: relative;
        height: 260px;
        width: 100%;
      }

      .drawer-content {
        padding: 1rem;
        width: min(500px, 92vw);
      }

      .arrival-form {
        display: grid;
        gap: 0.75rem;
      }

      .step-state {
        display: grid;
        gap: 0.3rem;
        margin-bottom: 0.6rem;
        font-size: 0.85rem;
      }

      .step-state span {
        color: #6b7280;
      }

      .step-state span.done {
        color: #166534;
        font-weight: 600;
      }

      .drawer-section {
        display: grid;
        gap: 0.6rem;
        padding: 0.8rem;
        background: #f7faf9;
        border: 1px solid #dbe5e2;
        border-radius: 0.6rem;
      }

      .drawer-section h3 {
        margin: 0;
        font-size: 0.95rem;
        color: #15584d;
      }

      .member-row {
        display: grid;
        grid-template-columns: 1.3fr 1.2fr 0.8fr 0.8fr auto;
        gap: 0.5rem;
        align-items: start;
      }

      .member-card {
        border: 1px solid #dbe5e2;
        border-radius: 0.6rem;
        background: #fcfffe;
        padding: 0.7rem;
        margin-bottom: 0.6rem;
      }

      .member-extra-row {
        margin-top: 0.2rem;
      }

      .member-extra-grid {
        display: grid;
        gap: 0.5rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .member-car-grid {
        display: grid;
        gap: 0.5rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        grid-column: 1 / -1;
      }

      .location-input-block {
        display: grid;
        gap: 0.5rem;
      }

      .coord-grid {
        display: grid;
        gap: 0.5rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .car-grid {
        display: grid;
        gap: 0.5rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .contact-block {
        border-top: 1px solid #d6e0e7;
        padding-top: 0.5rem;
      }

      .contact-block h4 {
        margin: 0 0 0.5rem;
        font-size: 0.9rem;
        color: #334155;
      }

      .button-row {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
      }

      .button-row.left {
        justify-content: flex-start;
        flex-wrap: wrap;
      }

      .summary-line {
        margin: 0;
        font-size: 0.8rem;
      }

      .muted {
        color: #555;
      }

      .overlay-toggles {
        margin-top: 0.5rem;
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .reference-search {
        margin-top: 0.6rem;
        display: grid;
        gap: 0.45rem;
        border: 1px solid #d6e0e7;
        border-radius: 0.5rem;
        background: #f8fafc;
        padding: 0.6rem;
      }

      .reference-search-row {
        display: flex;
        gap: 0.5rem;
        align-items: flex-start;
      }

      .reference-search-field {
        flex: 1;
      }

      .reference-search-results {
        display: grid;
        gap: 0.2rem;
        max-height: 170px;
        overflow-y: auto;
      }

      .reference-hit {
        justify-content: flex-start;
        text-align: left;
        white-space: normal;
      }

      .picked {
        margin-top: 0.5rem;
        color: #1c7d4d;
        font-weight: 500;
      }

      .error-text {
        margin: 0 0 0.35rem;
        color: #b91c1c;
        font-size: 0.85rem;
      }

      .success-text {
        margin-top: 0.5rem;
        color: #166534;
        font-weight: 600;
      }

      .hover-family-card {
        margin-top: 0.75rem;
        padding: 0.75rem;
        background: #f7fafc;
        border: 1px solid #d6e0e7;
      }

      .hover-family-card h3 {
        margin: 0 0 0.5rem;
        font-size: 1rem;
      }

      .hover-family-card p {
        margin: 0.2rem 0;
      }

      .status-pending {
        color: #b91c1c;
        font-weight: 600;
      }

      .status-safe {
        color: #15803d;
        font-weight: 600;
      }

      .table-wrap {
        overflow-x: auto;
      }

      .report-card {
        display: grid;
        gap: 0.85rem;
      }

      .report-header {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        align-items: flex-start;
        flex-wrap: wrap;
      }

      .report-header h3 {
        margin: 0;
      }

      .report-header p {
        margin: 0.25rem 0 0;
      }

      .report-metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.65rem;
      }

      .metric-tile {
        padding: 0.75rem;
        border: 1px solid #d6e0e7;
        border-radius: 0.5rem;
        background: #f8fafc;
        display: grid;
        gap: 0.25rem;
      }

      .metric-tile span {
        font-size: 0.8rem;
        color: #475569;
      }

      .metric-tile strong {
        font-size: 1.05rem;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        padding: 0.5rem;
        border-bottom: 1px solid #ddd;
        text-align: left;
      }

      @media (max-width: 1024px) {
        .top-grid,
        .charts-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 640px) {
        .coord-grid,
        .car-grid,
        .member-row,
        .member-extra-grid,
        .member-car-grid {
          grid-template-columns: 1fr;
        }

        .map-actions {
          flex-direction: column;
          align-items: stretch;
        }

        .overlay-toggles {
          flex-direction: column;
          gap: 0.35rem;
        }

        .reference-search-row {
          flex-direction: column;
          align-items: stretch;
        }

        .reference-item {
          flex-direction: column;
          align-items: flex-start;
        }

        .chart-card {
          min-height: 300px;
        }

        .chart-wrap {
          height: 220px;
        }

        .report-metrics {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class DashboardPageComponent implements AfterViewInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  readonly summary = signal<DashboardSummary | null>(null);
  readonly zones = signal<Zone[]>([]);
  readonly drawerOpen = signal(false);
  readonly pickingLocation = signal(false);
  readonly clickedCoord = signal<{ lat: number; lng: number } | null>(null);
  readonly submitting = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly saveSuccess = signal<string | null>(null);
  readonly hoveredMarker = signal<MapMarker | null>(null);
  readonly selectedMarker = signal<MapMarker | null>(null);
  readonly hoveredMapReference = signal<MapReference | null>(null);
  readonly selectedMapReference = signal<MapReference | null>(null);
  readonly hoveredPolicePoint = signal<HoveredPolicePoint | null>(null);
  readonly emergencyBuilderOpen = signal(false);
  readonly emergencyOverlayEnabled = signal(true);
  readonly emergencySaving = signal(false);
  readonly emergencyError = signal<string | null>(null);
  readonly emergencySuccess = signal<string | null>(null);
  readonly activeEmergencyPlan = signal<EmergencyPlan | null>(null);
  readonly notifications = signal<NotificationItem[]>([]);
  readonly notificationError = signal<string | null>(null);
  readonly borderDrawing = signal(false);
  readonly borderPointsCount = signal(0);
  readonly borderMessage = signal<string | null>(null);
  readonly householdPinsEnabled = signal(true);
  readonly householdLabelsEnabled = signal(true);
  readonly mapReferencesEnabled = signal(true);
  readonly referenceLabelsEnabled = signal(true);
  readonly zoneLabelsEnabled = signal(true);
  readonly heatmapEnabled = signal(true);
  readonly zoneGuidesEnabled = signal(true);
  readonly reportVm = signal<ReportVm | null>(null);
  readonly mapReferenceTypes = referenceCategoryOptions;
  readonly allMapReferences = signal<MapReference[]>([]);
  readonly editingReferenceId = signal<string | null>(null);
  readonly referencePickMode = signal(false);
  readonly referenceSaving = signal(false);
  readonly referenceError = signal<string | null>(null);
  readonly referenceSuccess = signal<string | null>(null);
  readonly referenceFilterType = signal<MapReferenceType | "ALL">("ALL");
  readonly householdSearchQuery = signal("");
  readonly referenceSearchQuery = signal("");

  householdsByZoneChart: ChartData<"bar"> = { labels: [], datasets: [{ data: [], label: "Households" }] };
  individualsByZoneChart: ChartData<"bar"> = { labels: [], datasets: [{ data: [], label: "Individuals" }] };
  needsChart: ChartData<"pie"> = { labels: [], datasets: [{ data: [] }] };
  arrivalsLineChart: ChartData<"line"> = { labels: [], datasets: [{ data: [], label: "New arrivals" }] };

  readonly chartOptions: ChartOptions = { responsive: true, maintainAspectRatio: false };
  readonly pieOptions: ChartOptions<ChartType> = { responsive: true, maintainAspectRatio: false };

  readonly arrivalForm = this.fb.group({
    locationMethod: ["MAP", Validators.required],
    googleMapsUrl: [""],
    manualLat: [null as number | null],
    manualLng: [null as number | null],
    precisionMode: ["EXACT", Validators.required],
    headName: ["", [Validators.required, Validators.maxLength(160)]],
    phoneNumber: ["", [Validators.required, Validators.maxLength(40)]],
    pinLabel: ["", [Validators.maxLength(120)]],
    preferredLanguage: ["Arabic"],
    emergencyName: [""],
    emergencyPhone: [""],
    emergencyRelation: [""],
    housingType: ["HOST", Validators.required],
    arrivalDate: [new Date().toISOString().slice(0, 10), Validators.required],
    members: this.fb.array([this.createMemberGroup()], Validators.minLength(1))
  });

  readonly emergencyPlanForm = this.fb.group({
    name: ["Village Protection Plan", [Validators.required, Validators.maxLength(120)]],
    description: [""],
    isActive: [true, Validators.required],
    policePosts: this.fb.array([this.createPolicePostGroup()])
  });

  readonly mapReferenceForm = this.fb.group({
    name: ["", [Validators.required, Validators.maxLength(160)]],
    type: ["LANDMARK" as MapReferenceType, Validators.required],
    description: [""],
    lat: [null as number | null, [Validators.required, Validators.min(-90), Validators.max(90)]],
    lng: [null as number | null, [Validators.required, Validators.min(-180), Validators.max(180)]],
    color: [""],
    icon: [""],
    visible: [true]
  });

  private map?: L.Map;
  private markerLayer = L.layerGroup();
  private householdLabelLayer = L.layerGroup();
  private referenceLayer = L.layerGroup();
  private referenceLabelLayer = L.layerGroup();
  private zoneLabelLayer = L.layerGroup();
  private heatLayer = L.layerGroup();
  private tempLayer = L.layerGroup();
  private emergencyLayer = L.layerGroup();
  private villageBorderLayer = L.layerGroup();
  private zoneGuidesLayer = L.layerGroup();
  private readonly householdMarkersById = new Map<string, L.Marker>();
  private readonly referenceMarkersById = new Map<string, L.Marker>();
  private emergencyPickMode: { index: number } | null = null;
  private villageBorderPoints: L.LatLngTuple[] = [];
  private readonly mapCenter: L.LatLngTuple = [33.93444, 35.69972];
  private readonly sectionCount = 10;
  private readonly borderStorageKey = "ain_el_kharroube_manual_border_points_v1";
  private resizeHandler = () => this.map?.invalidateSize();

  ngAfterViewInit() {
    this.loadZones();
    this.loadDashboard();
    this.loadNotifications();
    if (this.isAdminUser()) {
      this.loadMapReferencesForAdmin();
    }
    this.initMap();
    window.addEventListener("resize", this.resizeHandler);
  }

  ngOnDestroy() {
    window.removeEventListener("resize", this.resizeHandler);
    this.map?.remove();
  }

  openDrawer() {
    this.drawerOpen.set(true);
    this.emergencyPickMode = null;
    this.emergencySuccess.set(null);
    this.saveError.set(null);
    this.deferMapResize();
  }

  closeDrawer() {
    this.drawerOpen.set(false);
    this.pickingLocation.set(false);
    this.clickedCoord.set(null);
    this.tempLayer.clearLayers();
    this.saveError.set(null);
    this.resetArrivalForm();
    this.deferMapResize();
  }

  enablePickLocation() {
    this.arrivalForm.patchValue({ locationMethod: "MAP" });
    this.emergencyPickMode = null;
    this.emergencySuccess.set(null);
    this.borderDrawing.set(false);
    this.borderMessage.set(null);
    this.pickingLocation.set(true);
    this.saveError.set(null);
  }

  applyGoogleLinkLocation() {
    const link = String(this.arrivalForm.get("googleMapsUrl")?.value ?? "").trim();
    const coords = this.parseGoogleMapsLink(link);

    if (!coords) {
      this.saveError.set("Could not read coordinates from this Google Maps link. Use a full link containing coordinates.");
      return;
    }

    this.arrivalForm.patchValue({ locationMethod: "GOOGLE_LINK" });
    this.setSelectedCoordinate(coords.lat, coords.lng);
    this.saveError.set(null);
  }

  applyManualCoordinates() {
    const lat = Number(this.arrivalForm.get("manualLat")?.value);
    const lng = Number(this.arrivalForm.get("manualLng")?.value);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      this.saveError.set("Latitude must be between -90 and 90, and longitude between -180 and 180.");
      return;
    }

    this.arrivalForm.patchValue({ locationMethod: "MANUAL" });
    this.setSelectedCoordinate(lat, lng);
    this.saveError.set(null);
  }

  submitArrival() {
    this.saveError.set(null);
    this.saveSuccess.set(null);

    const selectedCoord = this.resolveSelectedCoordinate();
    if (!selectedCoord) {
      this.saveError.set("Step 1 is missing: choose a map pin, Google Maps link, or manual latitude/longitude.");
      return;
    }

    if (this.arrivalForm.invalid || this.membersArray.length < 1) {
      this.arrivalForm.markAllAsTouched();
      this.saveError.set("Please complete all required fields before saving.");
      return;
    }

    const form = this.arrivalForm.getRawValue();
    const members = this.membersArray.controls
      .map((control) => {
        const firstName = String(control.get("firstName")?.value ?? "").trim();
        const lastName = String(control.get("lastName")?.value ?? "").trim();
        const fatherName = String(control.get("fatherName")?.value ?? "").trim();
        const motherName = String(control.get("motherName")?.value ?? "").trim();
        const civilIdentityNumber = String(control.get("civilIdentityNumber")?.value ?? "").trim();
        const phoneNumber = String(control.get("phoneNumber")?.value ?? "").trim();
        const originArea = String(control.get("originArea")?.value ?? "").trim();
        const nationality = String(control.get("nationality")?.value ?? "").trim();
        const age = Number(control.get("age")?.value);
        const gender = String(control.get("gender")?.value ?? "") as "MALE" | "FEMALE";
        const relationshipToHead = String(control.get("relationshipToHead")?.value ?? "").trim();
        const yearOfBirthRaw = control.get("yearOfBirth")?.value;
        const yearOfBirth = yearOfBirthRaw === null || yearOfBirthRaw === "" ? null : Number(yearOfBirthRaw);
        const idDocStatus = String(control.get("idDocStatus")?.value ?? "UNKNOWN");
        const idDocType = String(control.get("idDocType")?.value ?? "").trim();
        const idDocLast4 = String(control.get("idDocLast4")?.value ?? "").trim();
        const schoolEnrollment = String(control.get("schoolEnrollment")?.value ?? "NA");
        const employmentStatus = String(control.get("employmentStatus")?.value ?? "NA");
        const safetyCheckStatus =
          String(control.get("safetyCheckStatus")?.value ?? "PENDING") === "CHECKED_SAFE"
            ? "CHECKED_SAFE"
            : "PENDING";
        const hasDisability = !!control.get("hasDisability")?.value;
        const hasChronicCondition = !!control.get("hasChronicCondition")?.value;
        const pregnantOrLactating = !!control.get("pregnantOrLactating")?.value;
        const hasCar = !!control.get("hasCar")?.value;
        const carModel = String(control.get("carModel")?.value ?? "").trim();
        const carColor = String(control.get("carColor")?.value ?? "").trim();
        const carPlate = String(control.get("carPlate")?.value ?? "").trim();
        return {
          name: `${firstName} ${lastName}`.trim(),
          firstName,
          lastName,
          fatherName,
          motherName,
          civilIdentityNumber,
          phoneNumber,
          originArea,
          nationality,
          age,
          gender,
          relationshipToHead: relationshipToHead || null,
          yearOfBirth: Number.isFinite(yearOfBirth) ? yearOfBirth : null,
          idDocStatus,
          idDocType: idDocType || null,
          idDocLast4: idDocLast4 || null,
          schoolEnrollment,
          employmentStatus,
          safetyCheckStatus,
          hasDisability,
          hasChronicCondition,
          pregnantOrLactating,
          hasCar,
          carModel: hasCar ? carModel : null,
          carColor: hasCar ? carColor : null,
          carPlate: hasCar ? carPlate : null
        };
      })
      .filter((member) => member.name.length > 0 && Number.isFinite(member.age) && (member.gender === "MALE" || member.gender === "FEMALE"));

    if (!members.length) {
      this.saveError.set("Please enter at least one family member with full details.");
      return;
    }

    for (const member of members) {
      if (member.idDocStatus === "HAS_ID" && (!member.idDocType || !member.idDocLast4 || !/^\d{4}$/.test(member.idDocLast4))) {
        this.saveError.set("For members with HAS ID, ID type and last 4 digits are required.");
        return;
      }

      if (member.hasCar && (!member.carModel || !member.carColor || !member.carPlate)) {
        this.saveError.set("For members with car, car model, color and number are required.");
        return;
      }
    }

    const ageSummary = this.computeAgeBuckets(members);
    const pinPrecisionM = this.arrivalForm.get("precisionMode")?.value === "GRID_500M" ? 500 : 0;
    const primaryMember = members[0];
    const firstName = primaryMember.firstName;
    const lastName = primaryMember.lastName;
    const headName = String(form.headName ?? "").trim() || `${firstName} ${lastName}`.trim();
    const firstCarMember = members.find((member) => member.hasCar);

    this.submitting.set(true);
    this.api
      .post("/households", {
        firstName,
        lastName,
        fatherName: primaryMember.fatherName,
        motherName: primaryMember.motherName,
        civilIdentityNumber: primaryMember.civilIdentityNumber,
        phoneNumber: String(form.phoneNumber ?? "").trim(),
        pinLabel: String(form.pinLabel ?? "").trim() || null,
        headName,
        originArea: primaryMember.originArea,
        nationality: primaryMember.nationality || null,
        preferredLanguage: String(form.preferredLanguage ?? "").trim() || null,
        casePriority: "MEDIUM",
        emergencyName: String(form.emergencyName ?? "").trim() || null,
        emergencyPhone: String(form.emergencyPhone ?? "").trim() || null,
        emergencyRelation: String(form.emergencyRelation ?? "").trim() || null,
        familySize: members.length,
        arrivalDate: form.arrivalDate,
        housingType: form.housingType,
        hasCar: !!firstCarMember,
        carModel: firstCarMember?.carModel ?? null,
        carColor: firstCarMember?.carColor ?? null,
        carPlate: firstCarMember?.carPlate ?? null,
        status: "ACTIVE",
        age0_4: ageSummary.age0_4,
        age5_17: ageSummary.age5_17,
        age18_59: ageSummary.age18_59,
        age60plus: ageSummary.age60plus,
        vulnerabilityFlags: ["new_arrival"],
        needs: [],
        members,
        clickedLat: selectedCoord.lat,
        clickedLng: selectedCoord.lng,
        pinPrecisionM
      })
      .subscribe({
        next: (created: any) => this.afterSuccessfulSave(String(created.householdCode ?? "")),
        error: (err: HttpErrorResponse) => {
          this.submitting.set(false);
          const formError =
            Array.isArray(err?.error?.issues?.formErrors) && err.error.issues.formErrors.length
              ? String(err.error.issues.formErrors[0])
              : null;
          const fieldErrors = err?.error?.issues?.fieldErrors as Record<string, string[] | undefined> | undefined;
          const firstFieldError = fieldErrors
            ? Object.values(fieldErrors)
                .flatMap((value) => (Array.isArray(value) ? value : []))
                .find((value) => typeof value === "string" && value.trim().length > 0) ?? null
            : null;
          const message = String(err?.error?.message ?? "").trim();

          if (err.status === 401) {
            this.saveError.set("Session expired. Please log in again.");
            return;
          }

          if (formError) {
            this.saveError.set(formError);
            return;
          }

          if (firstFieldError) {
            this.saveError.set(firstFieldError);
            return;
          }

          if (message) {
            this.saveError.set(message);
            return;
          }

          this.saveError.set("Could not save this family. Please review the form and try again.");
        }
      });
  }

  get membersArray() {
    return this.arrivalForm.get("members") as FormArray;
  }

  addMember() {
    this.membersArray.push(this.createMemberGroup());
  }

  removeMember(index: number) {
    if (this.membersArray.length <= 1) {
      return;
    }
    this.membersArray.removeAt(index);
  }

  startBorderDrawing() {
    this.borderDrawing.set(true);
    this.borderMessage.set("Click points on map to draw the village border.");
    this.pickingLocation.set(false);
    this.emergencyPickMode = null;
    this.villageBorderPoints = [];
    this.borderPointsCount.set(0);
    this.renderVillageBorder();
  }

  finishBorderDrawing() {
    if (this.villageBorderPoints.length < 3) {
      this.borderMessage.set("Need at least 3 points to finish the border.");
      return;
    }
    this.borderDrawing.set(false);
    this.saveBorderToStorage();
    this.renderVillageBorder();
    this.borderMessage.set("Village border saved.");
  }

  clearBorder() {
    this.borderDrawing.set(false);
    this.villageBorderPoints = [];
    this.borderPointsCount.set(0);
    this.borderMessage.set("Village border cleared.");
    this.villageBorderLayer.clearLayers();
    try {
      localStorage.removeItem(this.borderStorageKey);
    } catch {
      // Ignore storage issues and keep UI responsive.
    }
  }

  get policePostsArray() {
    return this.emergencyPlanForm.get("policePosts") as FormArray;
  }

  toggleEmergencyBuilder() {
    this.emergencyBuilderOpen.set(!this.emergencyBuilderOpen());
    this.emergencyError.set(null);
    this.emergencySuccess.set(null);
  }

  setEmergencyOverlayEnabled(enabled: boolean) {
    this.emergencyOverlayEnabled.set(enabled);
    const summary = this.summary();
    if (summary) {
      this.refreshEmergencyOverlay(summary);
    }
  }

  setHouseholdPinsEnabled(enabled: boolean) {
    this.householdPinsEnabled.set(enabled);
    const summary = this.summary();
    if (summary) {
      this.refreshMapMarkers(summary);
      this.refreshZoneLabels(summary);
    }
  }

  setHouseholdLabelsEnabled(enabled: boolean) {
    this.householdLabelsEnabled.set(enabled);
    const summary = this.summary();
    if (summary) {
      this.refreshMapMarkers(summary);
    }
  }

  setMapReferencesEnabled(enabled: boolean) {
    this.mapReferencesEnabled.set(enabled);
    const summary = this.summary();
    if (summary) {
      this.refreshMapReferences(summary);
    }
  }

  setReferenceLabelsEnabled(enabled: boolean) {
    this.referenceLabelsEnabled.set(enabled);
    const summary = this.summary();
    if (summary) {
      this.refreshMapReferences(summary);
    }
  }

  setZoneLabelsEnabled(enabled: boolean) {
    this.zoneLabelsEnabled.set(enabled);
    const summary = this.summary();
    if (summary) {
      this.refreshZoneLabels(summary);
    }
  }

  setHeatmapEnabled(enabled: boolean) {
    this.heatmapEnabled.set(enabled);
    const summary = this.summary();
    if (summary) {
      this.refreshHeatMap(summary);
    }
  }

  setZoneGuidesEnabled(enabled: boolean) {
    this.zoneGuidesEnabled.set(enabled);
    this.renderZoneGuides();
  }

  addPolicePost() {
    this.policePostsArray.push(this.createPolicePostGroup());
  }

  removePolicePost(index: number) {
    if (this.policePostsArray.length <= 1) {
      return;
    }
    this.policePostsArray.removeAt(index);
  }

  pickPolicePoint(index: number) {
    this.borderDrawing.set(false);
    this.borderMessage.set(null);
    this.emergencyPickMode = { index };
    this.emergencySuccess.set("Click on the map to set police point.");
    this.emergencyError.set(null);
  }

  resetEmergencyPlanForm() {
    this.emergencyPlanForm.patchValue({
      name: "Village Protection Plan",
      description: "",
      isActive: true
    });
    this.policePostsArray.clear();
    this.policePostsArray.push(this.createPolicePostGroup());
    this.emergencyPickMode = null;
    this.emergencySuccess.set(null);
    this.emergencyError.set(null);
  }

  saveEmergencyPlan() {
    this.emergencyError.set(null);
    this.emergencySuccess.set(null);

    if (this.emergencyPlanForm.invalid) {
      this.emergencyPlanForm.markAllAsTouched();
      this.emergencyError.set("Please complete required emergency plan fields.");
      return;
    }

    const form = this.emergencyPlanForm.getRawValue();

    const policePosts = this.policePostsArray.controls
      .map((control) => ({
        label: String(control.get("label")?.value ?? "").trim(),
        lat: Number(control.get("lat")?.value),
        lng: Number(control.get("lng")?.value),
        officersCount: Number(control.get("officersCount")?.value) || 1
      }))
      .filter(
        (post) =>
          post.label &&
          Number.isFinite(post.lat) &&
          Number.isFinite(post.lng) &&
          Number.isFinite(post.officersCount) &&
          post.officersCount > 0
      );

    if (!policePosts.length) {
      this.emergencyError.set("Add at least one police post.");
      return;
    }

    this.emergencySaving.set(true);
    this.api
      .post("/emergency-plans", {
        name: String(form.name ?? "").trim(),
        description: String(form.description ?? "").trim() || null,
        isActive: !!form.isActive,
        policePosts
      })
      .subscribe({
        next: () => {
          this.emergencySaving.set(false);
          this.emergencySuccess.set("Emergency plan saved.");
          this.emergencyOverlayEnabled.set(true);
          this.loadDashboard();
        },
        error: () => {
          this.emergencySaving.set(false);
          this.emergencyError.set("Could not save emergency plan.");
        }
      });
  }

  ageSummary() {
    const members = this.membersArray.controls
      .map((control) => ({
        name: `${String(control.get("firstName")?.value ?? "").trim()} ${String(control.get("lastName")?.value ?? "").trim()}`.trim(),
        age: Number(control.get("age")?.value)
      }))
      .filter((member) => member.name.length > 0 && Number.isFinite(member.age));
    return this.computeAgeBuckets(members);
  }

  locationMethod() {
    return String(this.arrivalForm.get("locationMethod")?.value ?? "MAP");
  }

  locationStepDone() {
    return !!this.resolveSelectedCoordinate();
  }

  householdStepDone() {
    return (
      !!this.arrivalForm.get("headName")?.valid &&
      !!this.arrivalForm.get("phoneNumber")?.valid &&
      !!this.arrivalForm.get("housingType")?.valid &&
      !!this.arrivalForm.get("arrivalDate")?.valid
    );
  }

  membersStepDone() {
    return this.membersArray.length > 0 && this.membersArray.valid;
  }

  isPoliceUser() {
    return this.auth.currentUser()?.role === "POLICE";
  }

  isAdminUser() {
    return this.auth.currentUser()?.role === "ADMIN";
  }

  mapReferenceTypeLabel(type: MapReferenceType) {
    return this.mapReferenceTypes.find((option) => option.value === type)?.label ?? type;
  }

  setHouseholdSearchQuery(query: string) {
    this.householdSearchQuery.set(query);
  }

  clearHouseholdSearch() {
    this.householdSearchQuery.set("");
  }

  searchedHouseholdMarkers() {
    const query = this.householdSearchQuery().trim().toLowerCase();
    const markers = this.summary()?.mapMarkers ?? [];
    if (!query) {
      return markers
        .slice()
        .sort((a, b) => String(a.householdCode ?? "").localeCompare(String(b.householdCode ?? ""), undefined, { numeric: true }));
    }

    return markers
      .filter((marker) => this.markerSearchText(marker).includes(query))
      .sort((a, b) => String(a.householdCode ?? "").localeCompare(String(b.householdCode ?? ""), undefined, { numeric: true }));
  }

  focusHouseholdOnMap(marker: MapMarker) {
    if (!this.householdPinsEnabled()) {
      this.householdPinsEnabled.set(true);
      const summary = this.summary();
      if (summary) {
        this.refreshMapMarkers(summary);
      }
    }

    this.selectedMapReference.set(null);
    this.hoveredMapReference.set(null);
    this.hoveredPolicePoint.set(null);
    this.selectedMarker.set(marker);
    this.hoveredMarker.set(marker);

    if (this.map) {
      const targetZoom = Math.max(this.map.getZoom(), 17);
      this.map.flyTo([marker.approxLat, marker.approxLng], targetZoom, { duration: 0.45 });
    }

    setTimeout(() => {
      this.householdMarkersById.get(marker.id)?.openPopup();
    }, 220);
  }

  setReferenceSearchQuery(query: string) {
    this.referenceSearchQuery.set(query);
  }

  clearReferenceSearch() {
    this.referenceSearchQuery.set("");
  }

  searchedMapReferences() {
    const query = this.referenceSearchQuery().trim().toLowerCase();
    const references = this.summary()?.mapReferences ?? [];
    if (!query) {
      return references
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    }

    return references
      .filter((reference) => {
        const typeLabel = this.mapReferenceTypeLabel(reference.type).toLowerCase();
        return (
          reference.name.toLowerCase().includes(query) ||
          typeLabel.includes(query) ||
          (reference.description ?? "").toLowerCase().includes(query)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  focusReferenceOnMap(reference: MapReference) {
    if (!this.mapReferencesEnabled()) {
      this.mapReferencesEnabled.set(true);
      const summary = this.summary();
      if (summary) {
        this.refreshMapReferences(summary);
      }
    }

    this.selectedMarker.set(null);
    this.hoveredMarker.set(null);
    this.hoveredPolicePoint.set(null);
    this.selectedMapReference.set(reference);
    this.hoveredMapReference.set(reference);

    if (this.map) {
      const targetZoom = Math.max(this.map.getZoom(), 17);
      this.map.flyTo([reference.lat, reference.lng], targetZoom, { duration: 0.45 });
    }

    setTimeout(() => {
      this.referenceMarkersById.get(reference.id)?.openPopup();
    }, 220);
  }

  filteredMapReferences() {
    const filter = this.referenceFilterType();
    const references = this.allMapReferences();
    const filtered = filter === "ALL" ? references : references.filter((reference) => reference.type === filter);
    return filtered
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }

  activeMapReference() {
    return this.selectedMapReference() ?? this.hoveredMapReference();
  }

  clearSelectedMapReference() {
    this.selectedMapReference.set(null);
  }

  editMapReference(reference: MapReference) {
    this.editingReferenceId.set(reference.id);
    this.mapReferenceForm.patchValue({
      name: reference.name,
      type: reference.type,
      description: reference.description ?? "",
      lat: reference.lat,
      lng: reference.lng,
      color: reference.color ?? "",
      icon: reference.icon ?? "",
      visible: reference.visible
    });
    this.referencePickMode.set(false);
    this.referenceError.set(null);
    this.referenceSuccess.set(`Editing reference: ${reference.name}`);
    this.selectedMapReference.set(reference);
    if (this.map) {
      this.map.panTo([reference.lat, reference.lng]);
    }
  }

  resetMapReferenceForm() {
    this.editingReferenceId.set(null);
    this.referencePickMode.set(false);
    this.referenceError.set(null);
    this.referenceSuccess.set(null);
    this.mapReferenceForm.reset({
      name: "",
      type: "LANDMARK" as MapReferenceType,
      description: "",
      lat: null,
      lng: null,
      color: "",
      icon: "",
      visible: true
    });
  }

  pickMapReferencePoint() {
    this.borderDrawing.set(false);
    this.borderMessage.set(null);
    this.pickingLocation.set(false);
    this.emergencyPickMode = null;
    this.referencePickMode.set(true);
    this.referenceError.set(null);
    this.referenceSuccess.set("Click on the map to set reference coordinates.");
  }

  saveMapReference() {
    this.referenceError.set(null);
    this.referenceSuccess.set(null);

    if (this.mapReferenceForm.invalid) {
      this.mapReferenceForm.markAllAsTouched();
      this.referenceError.set("Please complete the required reference fields.");
      return;
    }

    const raw = this.mapReferenceForm.getRawValue();
    const color = String(raw.color ?? "").trim();
    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      this.referenceError.set("Color must use #RRGGBB format.");
      return;
    }

    const payload = {
      name: String(raw.name ?? "").trim(),
      type: raw.type as MapReferenceType,
      description: String(raw.description ?? "").trim() || null,
      lat: Number(raw.lat),
      lng: Number(raw.lng),
      color: color || null,
      icon: String(raw.icon ?? "").trim() || null,
      visible: !!raw.visible
    };

    const id = this.editingReferenceId();
    this.referenceSaving.set(true);
    const request = id
      ? this.api.patch<MapReference>(`/map-references/${id}`, payload)
      : this.api.post<MapReference>("/map-references", payload);

    request.subscribe({
      next: (saved) => {
        this.referenceSaving.set(false);
        this.referencePickMode.set(false);
        this.referenceSuccess.set(id ? "Map reference updated." : "Map reference created.");
        this.editingReferenceId.set(saved.id);
        this.selectedMapReference.set(saved);
        this.loadDashboard();
        this.loadMapReferencesForAdmin();
      },
      error: (err: HttpErrorResponse) => {
        this.referenceSaving.set(false);
        const formError =
          Array.isArray(err?.error?.issues?.formErrors) && err.error.issues.formErrors.length
            ? String(err.error.issues.formErrors[0])
            : null;
        const message = String(err?.error?.message ?? "").trim();
        this.referenceError.set(formError || message || "Could not save map reference.");
      }
    });
  }

  deleteMapReference(reference: MapReference) {
    if (!window.confirm(`Delete reference "${reference.name}"?`)) {
      return;
    }

    this.referenceError.set(null);
    this.referenceSuccess.set(null);
    this.api.delete(`/map-references/${reference.id}`).subscribe({
      next: () => {
        if (this.editingReferenceId() === reference.id) {
          this.resetMapReferenceForm();
        }
        if (this.selectedMapReference()?.id === reference.id) {
          this.selectedMapReference.set(null);
        }
        this.referenceSuccess.set("Map reference deleted.");
        this.loadDashboard();
        this.loadMapReferencesForAdmin();
      },
      error: (err: HttpErrorResponse) => {
        const message = String(err?.error?.message ?? "").trim();
        this.referenceError.set(message || "Could not delete map reference.");
      }
    });
  }

  markNotificationRead(notificationId: string) {
    this.api.patch(`/notifications/${notificationId}/read`, {}).subscribe({
      next: () => this.loadNotifications(),
      error: () => {
        this.notificationError.set("Could not mark notification as read.");
      }
    });
  }

  printExecutiveReport() {
    window.print();
  }

  downloadOperationsReportWorkbook() {
    this.api.getBlob("/exports/operations-report.xlsx").subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `operations-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.saveError.set("Could not export operations workbook.");
      }
    });
  }

  activeMapMarker() {
    return this.selectedMarker() ?? this.hoveredMarker();
  }

  clearSelectedMarker() {
    this.selectedMarker.set(null);
  }

  selectedSectionLabel() {
    const coord = this.resolveSelectedCoordinate();
    if (!coord) {
      return null;
    }
    const section = this.sectionFromCoordinates(coord.lat, coord.lng);
    return `Section ${section}`;
  }

  safetyClass(status: string | null | undefined) {
    return status === "CHECKED_SAFE" ? "status-safe" : "status-pending";
  }

  private resolveSelectedCoordinate() {
    const method = this.locationMethod();
    if (method === "MAP") {
      return this.clickedCoord();
    }

    if (method === "GOOGLE_LINK") {
      const link = String(this.arrivalForm.get("googleMapsUrl")?.value ?? "").trim();
      return this.parseGoogleMapsLink(link);
    }

    if (method === "MANUAL") {
      const lat = Number(this.arrivalForm.get("manualLat")?.value);
      const lng = Number(this.arrivalForm.get("manualLng")?.value);
      if (Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }

    return null;
  }

  private parseGoogleMapsLink(link: string) {
    if (!link) {
      return null;
    }

    let decoded = link;
    try {
      decoded = decodeURIComponent(link);
    } catch {
      decoded = link;
    }
    const patterns = [
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      /[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      /[?&]query=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/
    ];

    for (const pattern of patterns) {
      const match = decoded.match(pattern);
      if (!match) {
        continue;
      }

      const lat = Number(match[1]);
      const lng = Number(match[2]);

      if (Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }

    return null;
  }

  private setSelectedCoordinate(lat: number, lng: number) {
    this.clickedCoord.set({ lat, lng });
    this.tempLayer.clearLayers();
    L.circleMarker([lat, lng], {
      radius: 9,
      color: "#2e7d32",
      fillColor: "#66bb6a",
      fillOpacity: 0.8
    }).addTo(this.tempLayer);

    if (this.map) {
      this.map.panTo([lat, lng]);
    }
  }

  private afterSuccessfulSave(householdCode?: string) {
    this.submitting.set(false);
    this.saveSuccess.set(householdCode ? `Family ${householdCode} saved and pinned on map.` : "Family saved and pinned on map.");
    this.closeDrawer();
    this.loadDashboard();
  }

  private sectionFromCoordinates(lat: number, lng: number) {
    const centerLat = this.mapCenter[0];
    const centerLng = this.mapCenter[1];
    const latDiff = lat - centerLat;
    const lngDiff = lng - centerLng;
    const bearing = (Math.atan2(lngDiff, latDiff) * 180) / Math.PI;
    const normalized = (bearing + 360) % 360;
    return Math.floor(normalized / (360 / this.sectionCount)) + 1;
  }

  private deferMapResize() {
    setTimeout(() => this.map?.invalidateSize(), 160);
  }

  private loadZones() {
    this.api.get<Zone[]>("/zones").subscribe((zones) => this.zones.set(zones));
  }

  private loadDashboard() {
    this.api.get<DashboardSummary>("/dashboard/summary").subscribe((summary) => {
      this.summary.set(summary);
      this.reportVm.set(this.buildExecutiveReport(summary));
      this.activeEmergencyPlan.set(summary.emergencyPlan ?? null);
      this.refreshMapMarkers(summary);
      this.refreshMapReferences(summary);
      this.refreshZoneLabels(summary);
      this.refreshHeatMap(summary);
      this.refreshEmergencyOverlay(summary);
      this.updateCharts(summary);
      this.deferMapResize();
    });
  }

  private loadMapReferencesForAdmin() {
    if (!this.isAdminUser()) {
      this.allMapReferences.set([]);
      return;
    }

    this.api.get<MapReference[]>("/map-references").subscribe({
      next: (references) => {
        this.allMapReferences.set(references);
      },
      error: () => {
        this.referenceError.set("Could not load map references.");
      }
    });
  }

  private loadNotifications() {
    if (!this.isPoliceUser()) {
      this.notifications.set([]);
      this.notificationError.set(null);
      return;
    }

    this.api.get<NotificationItem[]>("/notifications/me").subscribe({
      next: (items) => {
        this.notifications.set(items);
        this.notificationError.set(null);
      },
      error: () => {
        this.notificationError.set("Could not load notifications.");
      }
    });
  }

  private initMap() {
    if (this.map) {
      return;
    }

    this.map = L.map("dashboard-map", {
      center: this.mapCenter,
      zoom: 15,
      maxZoom: 22
    });

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Tiles &copy; Esri - Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        maxNativeZoom: 19,
        maxZoom: 22
      }
    ).addTo(this.map);

    L.tileLayer(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Labels &copy; Esri",
        maxNativeZoom: 19,
        maxZoom: 22
      }
    ).addTo(this.map);

    this.heatLayer.addTo(this.map);
    this.markerLayer.addTo(this.map);
    this.householdLabelLayer.addTo(this.map);
    this.referenceLayer.addTo(this.map);
    this.referenceLabelLayer.addTo(this.map);
    this.zoneLabelLayer.addTo(this.map);
    this.tempLayer.addTo(this.map);
    this.emergencyLayer.addTo(this.map);
    this.villageBorderLayer.addTo(this.map);
    this.zoneGuidesLayer.addTo(this.map);
    this.loadBorderFromStorage();
    this.renderVillageBorder();
    this.renderZoneGuides();
    const summary = this.summary();
    if (summary) {
      this.refreshMapMarkers(summary);
      this.refreshMapReferences(summary);
      this.refreshZoneLabels(summary);
      this.refreshHeatMap(summary);
      this.refreshEmergencyOverlay(summary);
    }

    this.map.on("click", (event: L.LeafletMouseEvent) => {
      if (this.borderDrawing()) {
        this.villageBorderPoints.push([
          Number(event.latlng.lat.toFixed(6)),
          Number(event.latlng.lng.toFixed(6))
        ]);
        this.borderPointsCount.set(this.villageBorderPoints.length);
        this.renderVillageBorder();
        return;
      }

      if (this.emergencyPickMode) {
        const group = this.policePostsArray.at(this.emergencyPickMode.index);
        if (group) {
          group.patchValue({
            lat: Number(event.latlng.lat.toFixed(6)),
            lng: Number(event.latlng.lng.toFixed(6))
          });
        }
        this.emergencyPickMode = null;
        this.emergencySuccess.set("Point captured from map.");
        return;
      }

      if (this.referencePickMode()) {
        this.mapReferenceForm.patchValue({
          lat: Number(event.latlng.lat.toFixed(6)),
          lng: Number(event.latlng.lng.toFixed(6))
        });
        this.referencePickMode.set(false);
        this.referenceSuccess.set("Reference coordinates captured from map.");
        this.referenceError.set(null);
        return;
      }

      if (!this.pickingLocation()) {
        return;
      }

      this.saveError.set(null);
      this.setSelectedCoordinate(event.latlng.lat, event.latlng.lng);
      this.pickingLocation.set(false);
    });

    this.map.on("zoomend moveend", () => {
      this.renderZoneGuides();
      const summary = this.summary();
      if (!summary) {
        return;
      }
      this.refreshMapMarkers(summary);
      this.refreshMapReferences(summary);
      this.refreshZoneLabels(summary);
    });
  }

  private renderVillageBorder() {
    this.villageBorderLayer.clearLayers();

    if (!this.villageBorderPoints.length) {
      return;
    }

    if (this.borderDrawing()) {
      const draftLine = L.polyline(this.villageBorderPoints, {
        color: "#16a34a",
        weight: 4,
        opacity: 0.95,
        dashArray: "8,6"
      });
      draftLine.bindPopup("Drawing Ain El Kharroube border");
      draftLine.addTo(this.villageBorderLayer);

      for (const point of this.villageBorderPoints) {
        L.circleMarker(point, {
          radius: 5,
          color: "#16a34a",
          fillColor: "#4ade80",
          fillOpacity: 0.9
        }).addTo(this.villageBorderLayer);
      }
      return;
    }

    if (this.villageBorderPoints.length >= 3) {
      const border = L.polygon(this.villageBorderPoints, {
        color: "#16a34a",
        weight: 4,
        opacity: 0.95,
        fillOpacity: 0
      });
      border.bindPopup("Ain El Kharroube border (manual)");
      border.addTo(this.villageBorderLayer);
      return;
    }

    L.polyline(this.villageBorderPoints, {
      color: "#16a34a",
      weight: 4,
      opacity: 0.95
    }).addTo(this.villageBorderLayer);
  }

  private loadBorderFromStorage() {
    try {
      const raw = localStorage.getItem(this.borderStorageKey);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      const points: L.LatLngTuple[] = [];
      for (const point of parsed) {
        if (!Array.isArray(point) || point.length !== 2) {
          continue;
        }
        const lat = Number(point[0]);
        const lng = Number(point[1]);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
          continue;
        }
        points.push([lat, lng]);
      }

      this.villageBorderPoints = points;
      this.borderPointsCount.set(points.length);
    } catch {
      // Ignore storage parsing issues.
    }
  }

  private saveBorderToStorage() {
    try {
      localStorage.setItem(this.borderStorageKey, JSON.stringify(this.villageBorderPoints));
    } catch {
      // Ignore storage write errors.
    }
  }

  private refreshMapMarkers(summary: DashboardSummary) {
    this.markerLayer.clearLayers();
    this.householdLabelLayer.clearLayers();
    this.householdMarkersById.clear();
    this.hoveredMarker.set(null);
    this.hoveredPolicePoint.set(null);
    if (!this.householdPinsEnabled()) {
      this.selectedMarker.set(null);
      return;
    }

    const selectedId = this.selectedMarker()?.id ?? null;
    let selectedFound = false;
    const showLabels = this.householdLabelsEnabled() && (this.map?.getZoom() ?? 0) >= 16;

    const sortedMarkers = summary.mapMarkers
      .slice()
      .sort((a, b) => String(a.householdCode ?? "").localeCompare(String(b.householdCode ?? ""), undefined, { numeric: true }));

    for (const [index, marker] of sortedMarkers.entries()) {
      if (marker.approxLat == null || marker.approxLng == null) {
        continue;
      }

      const isSafe = marker.safetyCheckStatus === "CHECKED_SAFE";
      const pinNumber = this.householdCodeToPinNumber(marker.householdCode, index + 1);
      const icon = this.createFamilyPinIcon(pinNumber, isSafe);
      const pin = L.marker([marker.approxLat, marker.approxLng], {
        icon,
        keyboard: true
      });

      pin.bindPopup(
        `#${pinNumber} ${marker.pinLabel || marker.householdCode} | ${
          `${marker.firstName || ""} ${marker.lastName || ""}`.trim() || marker.headName || "Unknown head"
        } | family size: ${marker.familySize} | safety: ${
          marker.safetyCheckStatus === "CHECKED_SAFE" ? "safe" : "pending"
        } | from: ${marker.originArea || "Unknown"} | ${marker.pinPrecisionM === 0 ? "exact" : `+/-${marker.pinPrecisionM}m`}`
      );

      pin.on("mouseover", () => {
        this.hoveredMapReference.set(null);
        this.hoveredPolicePoint.set(null);
        if (this.selectedMarker()?.id !== marker.id) {
          this.hoveredMarker.set(marker);
        }
        pin.openPopup();
      });

      pin.on("mouseout", () => {
        if (this.selectedMarker()?.id !== marker.id && this.hoveredMarker()?.id === marker.id) {
          this.hoveredMarker.set(null);
        }
        if (this.selectedMarker()?.id !== marker.id) {
          pin.closePopup();
        }
      });

      pin.on("click", () => {
        this.selectedMapReference.set(null);
        this.selectedMarker.set(marker);
        this.hoveredMarker.set(marker);
        pin.openPopup();
      });

      if (selectedId && marker.id === selectedId) {
        this.selectedMarker.set(marker);
        selectedFound = true;
      }

      pin.addTo(this.markerLayer);
      this.householdMarkersById.set(marker.id, pin);

      if (showLabels) {
        const labelText = this.householdLabelText(marker, pinNumber);
        if (labelText) {
          this.createInlineLabelMarker([marker.approxLat, marker.approxLng], labelText, "household").addTo(this.householdLabelLayer);
        }
      }
    }

    if (selectedId && !selectedFound) {
      this.selectedMarker.set(null);
    }
  }

  private householdCodeToPinNumber(householdCode: string | null | undefined, fallbackNumber: number) {
    const code = String(householdCode ?? "").trim();
    const match = code.match(/^HH-(\d+)$/i);
    if (!match) {
      return fallbackNumber;
    }

    const numeric = Number.parseInt(match[1], 10);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackNumber;
  }

  private refreshMapReferences(summary: DashboardSummary) {
    this.referenceLayer.clearLayers();
    this.referenceLabelLayer.clearLayers();
    this.referenceMarkersById.clear();
    this.hoveredMapReference.set(null);
    if (!this.mapReferencesEnabled()) {
      this.selectedMapReference.set(null);
      return;
    }

    const selectedId = this.selectedMapReference()?.id ?? null;
    let selectedFound = false;
    const showLabels = this.referenceLabelsEnabled() && (this.map?.getZoom() ?? 0) >= 15;

    for (const reference of summary.mapReferences) {
      const marker = L.marker([reference.lat, reference.lng], {
        icon: this.createReferenceIcon(reference),
        keyboard: true
      });

      marker.bindPopup(
        `${this.escapeHtml(reference.name)} | ${this.escapeHtml(this.mapReferenceTypeLabel(reference.type))} | ${
          reference.description ? this.escapeHtml(reference.description) : "No description"
        }`
      );

      marker.on("mouseover", () => {
        this.hoveredMarker.set(null);
        this.hoveredPolicePoint.set(null);
        if (this.selectedMapReference()?.id !== reference.id) {
          this.hoveredMapReference.set(reference);
        }
        marker.openPopup();
      });

      marker.on("mouseout", () => {
        if (this.selectedMapReference()?.id !== reference.id && this.hoveredMapReference()?.id === reference.id) {
          this.hoveredMapReference.set(null);
        }
        if (this.selectedMapReference()?.id !== reference.id) {
          marker.closePopup();
        }
      });

      marker.on("click", () => {
        this.selectedMarker.set(null);
        this.selectedMapReference.set(reference);
        this.hoveredMapReference.set(reference);
        marker.openPopup();
      });

      if (selectedId && selectedId === reference.id) {
        this.selectedMapReference.set(reference);
        selectedFound = true;
      }

      marker.addTo(this.referenceLayer);
      this.referenceMarkersById.set(reference.id, marker);

      if (showLabels) {
        this.createInlineLabelMarker([reference.lat, reference.lng], reference.name, "reference").addTo(this.referenceLabelLayer);
      }
    }

    if (selectedId && !selectedFound) {
      this.selectedMapReference.set(null);
    }
  }

  private refreshZoneLabels(summary: DashboardSummary) {
    this.zoneLabelLayer.clearLayers();
    if (!this.zoneLabelsEnabled()) {
      return;
    }

    const zoom = this.map?.getZoom() ?? 0;
    if (zoom < 14) {
      return;
    }

    for (const zone of summary.zoneLabels) {
      this.createInlineLabelMarker([zone.lat, zone.lng], zone.zone, "zone").addTo(this.zoneLabelLayer);
    }
  }

  private refreshHeatMap(summary: DashboardSummary) {
    this.heatLayer.clearLayers();
    if (!this.heatmapEnabled()) {
      return;
    }

    for (const marker of summary.mapMarkers) {
      if (marker.approxLat == null || marker.approxLng == null) {
        continue;
      }

      const priorityBoost = marker.casePriority === "HIGH" ? 0.35 : marker.casePriority === "MEDIUM" ? 0.2 : 0.1;
      const familyBoost = Math.min(0.45, marker.familySize / 24);
      const intensity = Math.min(1, 0.2 + priorityBoost + familyBoost);
      const radiusMeters = Math.max(120, Math.min(420, 120 + marker.familySize * 12));

      L.circle([marker.approxLat, marker.approxLng], {
        radius: radiusMeters,
        color: this.heatColor(intensity),
        fillColor: this.heatColor(intensity),
        fillOpacity: 0.08 + intensity * 0.22,
        weight: 0,
        interactive: false
      }).addTo(this.heatLayer);
    }
  }

  private refreshEmergencyOverlay(summary: DashboardSummary) {
    this.emergencyLayer.clearLayers();
    this.hoveredPolicePoint.set(null);
    if (!this.emergencyOverlayEnabled()) {
      return;
    }

    const plan = summary.emergencyPlan;
    if (!plan) {
      return;
    }

    for (const post of plan.policePosts) {
      const marker = L.circleMarker([post.lat, post.lng], {
        radius: 9,
        color: "#1d4ed8",
        fillColor: "#60a5fa",
        fillOpacity: 0.85,
        weight: 2
      });
      marker.bindPopup(`Police: ${post.label} | Officers: ${post.officersCount}`);

      marker.on("mouseover", () => {
        this.hoveredMarker.set(null);
        this.hoveredPolicePoint.set({
          label: post.label,
          officersCount: post.officersCount,
          lat: post.lat,
          lng: post.lng,
          planName: plan.name
        });
        marker.openPopup();
      });

      marker.on("mouseout", () => {
        const hovered = this.hoveredPolicePoint();
        if (hovered && hovered.label === post.label && hovered.lat === post.lat && hovered.lng === post.lng) {
          this.hoveredPolicePoint.set(null);
        }
        marker.closePopup();
      });

      marker.on("click", () => {
        this.hoveredMarker.set(null);
        this.hoveredPolicePoint.set({
          label: post.label,
          officersCount: post.officersCount,
          lat: post.lat,
          lng: post.lng,
          planName: plan.name
        });
        marker.openPopup();
      });

      marker.addTo(this.emergencyLayer);
    }
  }

  private updateCharts(summary: DashboardSummary) {
    this.householdsByZoneChart = {
      labels: summary.charts.householdsByZone.map((i) => i.zone),
      datasets: [{ data: summary.charts.householdsByZone.map((i) => i.value), label: "Households" }]
    };

    this.individualsByZoneChart = {
      labels: summary.charts.individualsByZone.map((i) => i.zone),
      datasets: [{ data: summary.charts.individualsByZone.map((i) => i.value), label: "Individuals" }]
    };

    this.needsChart = {
      labels: summary.charts.needsBreakdown.map((i) => i.name),
      datasets: [{ data: summary.charts.needsBreakdown.map((i) => i.value) }]
    };

    this.arrivalsLineChart = {
      labels: summary.charts.newArrivalsPerWeek.map((i) => i.week),
      datasets: [{ data: summary.charts.newArrivalsPerWeek.map((i) => i.value), label: "New arrivals" }]
    };
  }

  private renderZoneGuides() {
    this.zoneGuidesLayer.clearLayers();
    if (!this.map || !this.zoneGuidesEnabled()) {
      return;
    }

    const center = L.latLng(this.mapCenter[0], this.mapCenter[1]);
    const meters = this.estimateZoneGuideRadiusMeters();
    const sectorSize = 360 / this.sectionCount;

    for (let i = 0; i < this.sectionCount; i += 1) {
      const bearing = i * sectorSize;
      const edge = this.destinationPoint(center, meters, bearing);
      L.polyline([center, edge], {
        color: "#bfdbfe",
        weight: 1.2,
        opacity: 0.9,
        dashArray: "4,8",
        interactive: false
      }).addTo(this.zoneGuidesLayer);

      const labelBearing = bearing + sectorSize / 2;
      const labelPoint = this.destinationPoint(center, meters * 0.55, labelBearing);
      L.marker(labelPoint, {
        interactive: false,
        icon: L.divIcon({
          className: "",
          iconSize: [36, 14],
          iconAnchor: [18, 7],
          html: `<span style="font-size:11px;color:#dbeafe;font-weight:600;opacity:0.95;">S${i + 1}</span>`
        })
      }).addTo(this.zoneGuidesLayer);
    }
  }

  private estimateZoneGuideRadiusMeters() {
    if (!this.map) {
      return 1300;
    }

    const bounds = this.map.getBounds();
    const center = bounds.getCenter();
    const northEdge = L.latLng(bounds.getNorth(), center.lng);
    const eastEdge = L.latLng(center.lat, bounds.getEast());
    const northDistance = center.distanceTo(northEdge);
    const eastDistance = center.distanceTo(eastEdge);
    return Math.max(600, Math.min(2000, Math.min(northDistance, eastDistance) * 0.95));
  }

  private destinationPoint(center: L.LatLng, distanceMeters: number, bearingDeg: number): L.LatLng {
    const earthRadius = 6371000;
    const angularDistance = distanceMeters / earthRadius;
    const bearing = (bearingDeg * Math.PI) / 180;
    const lat1 = (center.lat * Math.PI) / 180;
    const lng1 = (center.lng * Math.PI) / 180;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) +
        Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
      );

    return L.latLng((lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI);
  }

  private heatColor(intensity: number) {
    if (intensity >= 0.75) {
      return "#dc2626";
    }
    if (intensity >= 0.5) {
      return "#f97316";
    }
    if (intensity >= 0.35) {
      return "#f59e0b";
    }
    return "#84cc16";
  }

  private buildExecutiveReport(summary: DashboardSummary): ReportVm {
    const households = summary.mapMarkers.length;
    const individuals = summary.kpis.totalIndividuals;
    const pendingChecks = summary.mapMarkers.filter((m) => m.safetyCheckStatus === "PENDING").length;
    const checkedSafe = summary.mapMarkers.filter((m) => m.safetyCheckStatus === "CHECKED_SAFE").length;
    const highPriorityCases = summary.mapMarkers.filter((m) => m.casePriority === "HIGH").length;
    const householdsWithCars = summary.mapMarkers.filter((m) => m.hasCar).length;
    const averageFamilySize = households ? individuals / households : 0;
    const pendingChecksPct = households ? (pendingChecks / households) * 100 : 0;
    const checkedSafePct = households ? (checkedSafe / households) * 100 : 0;
    const highPriorityPct = households ? (highPriorityCases / households) * 100 : 0;
    const householdsWithCarsPct = households ? (householdsWithCars / households) * 100 : 0;

    const individualsByZone = new Map(summary.charts.individualsByZone.map((entry) => [entry.zone, entry.value]));
    const totalIndividuals = Math.max(individuals, 1);
    const zoneRows = summary.charts.householdsByZone
      .map((entry) => {
        const zoneIndividuals = Number(individualsByZone.get(entry.zone) ?? 0);
        return {
          zone: entry.zone,
          households: entry.value,
          individuals: zoneIndividuals,
          avgFamilySize: entry.value ? zoneIndividuals / entry.value : 0,
          populationSharePct: (zoneIndividuals / totalIndividuals) * 100
        };
      })
      .sort((a, b) => b.individuals - a.individuals);

    const topNeed = summary.charts.needsBreakdown
      .slice()
      .sort((a, b) => b.value - a.value)
      .map((entry) => entry.name)[0] ?? null;
    const topZoneByIndividuals = zoneRows[0]?.zone ?? null;

    return {
      generatedAt: new Date().toISOString(),
      totalHouseholds: households,
      totalIndividuals: individuals,
      averageFamilySize,
      pendingChecks,
      pendingChecksPct,
      checkedSafePct,
      highPriorityCases,
      highPriorityPct,
      householdsWithCars,
      householdsWithCarsPct,
      topNeed,
      topZoneByIndividuals,
      zoneRows
    };
  }

  private createFamilyPinIcon(pinNumber: number, isSafe: boolean) {
    const background = isSafe ? "#15803d" : "#b91c1c";
    const border = isSafe ? "#86efac" : "#fca5a5";
    return L.divIcon({
      className: "",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -12],
      html: `<div style="width:28px;height:28px;border-radius:999px;background:${background};border:2px solid ${border};color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35);">${pinNumber}</div>`
    });
  }

  private markerSearchText(marker: MapMarker) {
    const memberText = Array.isArray(marker.members)
      ? marker.members
          .map((member) =>
            [
              member.name,
              member.firstName,
              member.lastName,
              member.fatherName,
              member.motherName,
              member.civilIdentityNumber,
              member.phoneNumber
            ]
              .filter((value) => typeof value === "string" && value.trim().length > 0)
              .join(" ")
          )
          .join(" ")
      : "";

    return [
      marker.householdCode,
      marker.pinLabel,
      marker.headName,
      marker.firstName,
      marker.lastName,
      marker.fatherName,
      marker.motherName,
      marker.civilIdentityNumber,
      marker.phoneNumber,
      marker.originArea,
      memberText
    ]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .join(" ")
      .toLowerCase();
  }

  private householdLabelText(marker: MapMarker, pinNumber: number) {
    const primary = marker.pinLabel || marker.headName || `${marker.firstName || ""} ${marker.lastName || ""}`.trim() || marker.householdCode;
    return `#${pinNumber} ${primary}`.trim();
  }

  private createInlineLabelMarker(position: L.LatLngTuple, text: string, kind: "household" | "reference" | "zone") {
    const escaped = this.escapeHtml(text);
    const styles =
      kind === "household"
        ? "background:rgba(15,23,42,.85);border:1px solid rgba(148,163,184,.7);color:#f8fafc;"
        : kind === "reference"
          ? "background:rgba(2,44,34,.9);border:1px solid rgba(45,212,191,.65);color:#dcfce7;"
          : "background:rgba(30,41,59,.85);border:1px solid rgba(147,197,253,.7);color:#dbeafe;";

    return L.marker(position, {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: "",
        iconSize: [10, 10],
        iconAnchor: [5, 18],
        html: `<span style="display:inline-block;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;${styles}">${escaped}</span>`
      })
    });
  }

  private createReferenceIcon(reference: MapReference) {
    const category = this.mapReferenceTypes.find((option) => option.value === reference.type);
    const color = reference.color || category?.defaultColor || "#475569";
    const iconText = this.escapeHtml((reference.icon || category?.shortIcon || "R").slice(0, 4).toUpperCase());

    return L.divIcon({
      className: "",
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -12],
      html: `<div style="width:30px;height:30px;border-radius:8px;background:${color};border:2px solid rgba(255,255,255,.95);color:#fff;font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35);">${iconText}</div>`
    });
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  private createMemberGroup() {
    return this.fb.group({
      firstName: ["", [Validators.required, Validators.maxLength(80)]],
      lastName: ["", [Validators.required, Validators.maxLength(80)]],
      fatherName: ["", [Validators.required, Validators.maxLength(80)]],
      motherName: ["", [Validators.required, Validators.maxLength(80)]],
      civilIdentityNumber: ["", [Validators.required, Validators.maxLength(40)]],
      phoneNumber: ["", [Validators.required, Validators.maxLength(40)]],
      originArea: ["", [Validators.required, Validators.maxLength(160)]],
      nationality: ["Lebanese", [Validators.required, Validators.maxLength(60)]],
      relationshipToHead: [""],
      gender: ["MALE", Validators.required],
      age: [0, [Validators.required, Validators.min(0), Validators.max(120)]],
      yearOfBirth: [null as number | null],
      idDocStatus: ["UNKNOWN", Validators.required],
      idDocType: [""],
      idDocLast4: [""],
      schoolEnrollment: ["NA", Validators.required],
      employmentStatus: ["NA", Validators.required],
      safetyCheckStatus: ["PENDING", Validators.required],
      hasDisability: [false],
      hasChronicCondition: [false],
      pregnantOrLactating: [false],
      hasCar: [false],
      carModel: [""],
      carColor: [""],
      carPlate: [""]
    });
  }

  private createPolicePostGroup() {
    return this.fb.group({
      label: ["", [Validators.required, Validators.maxLength(120)]],
      lat: [null as number | null, Validators.required],
      lng: [null as number | null, Validators.required],
      officersCount: [2, [Validators.required, Validators.min(1), Validators.max(300)]]
    });
  }

  private computeAgeBuckets(members: Array<{ name: string; age: number }>) {
    return members.reduce(
      (acc, member) => {
        if (member.age <= 4) {
          acc.age0_4 += 1;
        } else if (member.age <= 17) {
          acc.age5_17 += 1;
        } else if (member.age <= 59) {
          acc.age18_59 += 1;
        } else {
          acc.age60plus += 1;
        }
        return acc;
      },
      { age0_4: 0, age5_17: 0, age18_59: 0, age60plus: 0 }
    );
  }

  private resetArrivalForm() {
    this.arrivalForm.patchValue({
      locationMethod: "MAP",
      googleMapsUrl: "",
      manualLat: null,
      manualLng: null,
      precisionMode: "EXACT",
      headName: "",
      phoneNumber: "",
      pinLabel: "",
      preferredLanguage: "Arabic",
      emergencyName: "",
      emergencyPhone: "",
      emergencyRelation: "",
      housingType: "HOST",
      arrivalDate: new Date().toISOString().slice(0, 10)
    });
    this.membersArray.clear();
    this.membersArray.push(this.createMemberGroup());
  }
}

