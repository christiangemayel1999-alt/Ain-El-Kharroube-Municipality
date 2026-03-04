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
import { DashboardSummary, EmergencyPlan, NotificationItem, Zone } from "../models";
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
                <mat-label>Head of household</mat-label>
                <input matInput formControlName="headName" />
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Family origin area (within country)</mat-label>
                <input matInput formControlName="originArea" />
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Nationality</mat-label>
                <input matInput formControlName="nationality" />
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Preferred language</mat-label>
                <input matInput formControlName="preferredLanguage" />
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Case priority</mat-label>
                <mat-select formControlName="casePriority">
                  <mat-option value="LOW">LOW</mat-option>
                  <mat-option value="MEDIUM">MEDIUM</mat-option>
                  <mat-option value="HIGH">HIGH</mat-option>
                </mat-select>
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
                <mat-label>Family safety check</mat-label>
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

              <div class="car-grid" *ngIf="hasCarSelected()">
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
                <mat-label>Needs (comma-separated)</mat-label>
                <input matInput formControlName="needsText" />
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

              <div *ngIf="canManageContacts()" class="contact-block">
                <h4>Contact details</h4>
                <div class="coord-grid">
                  <mat-form-field appearance="outline">
                    <mat-label>Phone</mat-label>
                    <input matInput formControlName="contactPhone" />
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>WhatsApp</mat-label>
                    <input matInput formControlName="contactWhatsapp" />
                  </mat-form-field>
                </div>

                <mat-form-field appearance="outline">
                  <mat-label>Contact consent</mat-label>
                  <mat-select formControlName="contactConsent">
                    <mat-option [value]="false">No</mat-option>
                    <mat-option [value]="true">Yes</mat-option>
                  </mat-select>
                </mat-form-field>
              </div>
            </section>

            <section class="drawer-section" formArrayName="members">
              <h3>3. Family members</h3>
              <p class="muted">Enter each person name and age.</p>

              <div class="member-row" *ngFor="let member of membersArray.controls; let i = index" [formGroupName]="i">
                <mat-form-field appearance="outline">
                  <mat-label>Name {{ i + 1 }}</mat-label>
                  <input matInput formControlName="name" />
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>Relation to head</mat-label>
                  <input matInput formControlName="relationshipToHead" />
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

              <div class="member-extra-row" *ngFor="let member of membersArray.controls; let i = index" [formGroupName]="i">
                <div class="member-extra-grid">
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
              <mat-card class="hover-family-card" *ngIf="hoveredMarker() as marker">
                <h3>Family at hovered pin</h3>
                <p><strong>Code:</strong> {{ marker.householdCode }}</p>
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
                <p><strong>Case priority:</strong> {{ marker.casePriority }}</p>
                <p><strong>Needs:</strong> {{ formatNeeds(marker.needs) }}</p>
                <p><strong>Pin precision:</strong> {{ marker.pinPrecisionM === 0 ? 'Exact' : '+/-' + marker.pinPrecisionM + 'm' }}</p>
              </mat-card>
              <mat-card class="hover-family-card" *ngIf="hoveredPolicePoint() as post">
                <h3>Security point at hovered marker</h3>
                <p><strong>Plan:</strong> {{ post.planName }}</p>
                <p><strong>Post:</strong> {{ post.label }}</p>
                <p><strong>Officers:</strong> {{ post.officersCount }}</p>
                <p><strong>Coordinates:</strong> {{ post.lat | number:'1.5-5' }}, {{ post.lng | number:'1.5-5' }}</p>
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
              <h3>Expiring in 14 days</h3>
              <mat-list>
                <mat-list-item *ngFor="let agreement of s.workQueue.agreementsExpiringIn14Days.slice(0, 5)">
                  {{ agreement.agreementCode }} - {{ agreement.household?.householdCode }}
                </mat-list-item>
              </mat-list>

              <h3>High priority incidents</h3>
              <mat-list>
                <mat-list-item *ngFor="let incident of s.workQueue.highPriorityIncidents.slice(0, 5)">
                  {{ incident.incidentCode }} - {{ incident.type }}
                </mat-list-item>
              </mat-list>

              <h3>Pending safety checks</h3>
              <mat-list>
                <mat-list-item *ngFor="let h of s.workQueue.unverifiedHouseholds.slice(0, 5)">
                  {{ h.householdCode }} - {{ h.zoneId }}
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

      .member-extra-row {
        margin-top: -0.25rem;
      }

      .member-extra-grid {
        display: grid;
        gap: 0.5rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
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
        .member-extra-grid {
          grid-template-columns: 1fr;
        }

        .map-actions {
          flex-direction: column;
          align-items: stretch;
        }

        .chart-card {
          min-height: 300px;
        }

        .chart-wrap {
          height: 220px;
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
    headName: ["", [Validators.required, Validators.maxLength(120)]],
    originArea: ["", [Validators.required, Validators.maxLength(160)]],
    nationality: ["Lebanese"],
    preferredLanguage: ["Arabic"],
    casePriority: ["MEDIUM", Validators.required],
    emergencyName: [""],
    emergencyPhone: [""],
    emergencyRelation: [""],
    housingType: ["HOST", Validators.required],
    safetyCheckStatus: ["PENDING", Validators.required],
    hasCar: [false, Validators.required],
    carModel: [""],
    carColor: [""],
    carPlate: [""],
    contactPhone: [""],
    contactWhatsapp: [""],
    contactConsent: [false],
    needsText: [""],
    arrivalDate: [new Date().toISOString().slice(0, 10), Validators.required],
    members: this.fb.array([this.createMemberGroup()], Validators.minLength(1))
  });

  readonly emergencyPlanForm = this.fb.group({
    name: ["Village Protection Plan", [Validators.required, Validators.maxLength(120)]],
    description: [""],
    isActive: [true, Validators.required],
    policePosts: this.fb.array([this.createPolicePostGroup()])
  });

  private map?: L.Map;
  private markerLayer = L.layerGroup();
  private tempLayer = L.layerGroup();
  private emergencyLayer = L.layerGroup();
  private villageBorderLayer = L.layerGroup();
  private emergencyPickMode: { index: number } | null = null;
  private villageBorderPoints: L.LatLngTuple[] = [];
  private readonly borderStorageKey = "ain_el_kharroube_manual_border_points_v1";
  private resizeHandler = () => this.map?.invalidateSize();

  ngAfterViewInit() {
    this.loadZones();
    this.loadDashboard();
    this.loadNotifications();
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
        const name = String(control.get("name")?.value ?? "").trim();
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
        const hasDisability = !!control.get("hasDisability")?.value;
        const hasChronicCondition = !!control.get("hasChronicCondition")?.value;
        const pregnantOrLactating = !!control.get("pregnantOrLactating")?.value;
        return {
          name,
          age,
          gender,
          relationshipToHead: relationshipToHead || null,
          yearOfBirth: Number.isFinite(yearOfBirth) ? yearOfBirth : null,
          idDocStatus,
          idDocType: idDocType || null,
          idDocLast4: idDocLast4 || null,
          schoolEnrollment,
          employmentStatus,
          hasDisability,
          hasChronicCondition,
          pregnantOrLactating
        };
      })
      .filter((member) => member.name.length > 0 && Number.isFinite(member.age) && (member.gender === "MALE" || member.gender === "FEMALE"));

    if (!members.length) {
      this.saveError.set("Please enter at least one family member with name and age.");
      return;
    }

    for (const member of members) {
      if (member.idDocStatus === "HAS_ID" && (!member.idDocType || !member.idDocLast4 || !/^\d{4}$/.test(member.idDocLast4))) {
        this.saveError.set("For members with HAS ID, ID type and last 4 digits are required.");
        return;
      }
    }

    if (form.hasCar && (!String(form.carModel ?? "").trim() || !String(form.carColor ?? "").trim() || !String(form.carPlate ?? "").trim())) {
      this.saveError.set("Car model, car color and car number are required when family has a car.");
      return;
    }

    const ageSummary = this.computeAgeBuckets(members);
    const needs = form.needsText
      ? form.needsText
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : [];

    const pinPrecisionM = this.arrivalForm.get("precisionMode")?.value === "GRID_500M" ? 500 : 0;

    this.submitting.set(true);
    this.api
      .post("/households", {
        headName: String(form.headName ?? "").trim(),
        originArea: String(form.originArea ?? "").trim(),
        nationality: String(form.nationality ?? "").trim() || null,
        preferredLanguage: String(form.preferredLanguage ?? "").trim() || null,
        casePriority: form.casePriority,
        emergencyName: String(form.emergencyName ?? "").trim() || null,
        emergencyPhone: String(form.emergencyPhone ?? "").trim() || null,
        emergencyRelation: String(form.emergencyRelation ?? "").trim() || null,
        familySize: members.length,
        arrivalDate: form.arrivalDate,
        housingType: form.housingType,
        safetyCheckStatus: form.safetyCheckStatus,
        hasCar: !!form.hasCar,
        carModel: form.hasCar ? String(form.carModel ?? "").trim() : null,
        carColor: form.hasCar ? String(form.carColor ?? "").trim() : null,
        carPlate: form.hasCar ? String(form.carPlate ?? "").trim() : null,
        status: "ACTIVE",
        age0_4: ageSummary.age0_4,
        age5_17: ageSummary.age5_17,
        age18_59: ageSummary.age18_59,
        age60plus: ageSummary.age60plus,
        vulnerabilityFlags: ["new_arrival"],
        needs,
        members,
        clickedLat: selectedCoord.lat,
        clickedLng: selectedCoord.lng,
        pinPrecisionM
      })
      .subscribe({
        next: (created: any) => {
          const phone = String(form.contactPhone ?? "").trim();
          const whatsapp = String(form.contactWhatsapp ?? "").trim();
          const consent = !!form.contactConsent;

          if (this.canManageContacts() && (phone || whatsapp || consent)) {
            this.api
              .put(`/households/${created.id}/contact`, {
                phone: phone || null,
                whatsapp: whatsapp || null,
                consent
              })
              .subscribe({
                next: () => this.afterSuccessfulSave(String(created.householdCode ?? "")),
                error: () => {
                  this.submitting.set(false);
                  this.saveError.set("Family saved, but contact details could not be saved.");
                }
              });
            return;
          }

          this.afterSuccessfulSave(String(created.householdCode ?? ""));
        },
        error: (err: HttpErrorResponse) => {
          this.submitting.set(false);
          const formError =
            Array.isArray(err?.error?.issues?.formErrors) && err.error.issues.formErrors.length
              ? String(err.error.issues.formErrors[0])
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
        name: String(control.get("name")?.value ?? "").trim(),
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
    const hasCar = this.hasCarSelected();
    const carFilled =
      !hasCar ||
      (!!String(this.arrivalForm.get("carModel")?.value ?? "").trim() &&
        !!String(this.arrivalForm.get("carColor")?.value ?? "").trim() &&
        !!String(this.arrivalForm.get("carPlate")?.value ?? "").trim());

    return (
      !!this.arrivalForm.get("headName")?.valid &&
      !!this.arrivalForm.get("originArea")?.valid &&
      !!this.arrivalForm.get("housingType")?.valid &&
      !!this.arrivalForm.get("casePriority")?.valid &&
      !!this.arrivalForm.get("safetyCheckStatus")?.valid &&
      !!this.arrivalForm.get("arrivalDate")?.valid &&
      carFilled
    );
  }

  membersStepDone() {
    return this.membersArray.length > 0 && this.membersArray.valid;
  }

  formatNeeds(needs: string[] | null | undefined) {
    if (!needs || !needs.length) {
      return "-";
    }
    return needs.join(", ");
  }

  hasCarSelected() {
    return !!this.arrivalForm.get("hasCar")?.value;
  }

  canManageContacts() {
    const role = this.auth.currentUser()?.role;
    return role === "ADMIN" || role === "CASE_WORKER";
  }

  isPoliceUser() {
    return this.auth.currentUser()?.role === "POLICE";
  }

  markNotificationRead(notificationId: string) {
    this.api.patch(`/notifications/${notificationId}/read`, {}).subscribe({
      next: () => this.loadNotifications(),
      error: () => {
        this.notificationError.set("Could not mark notification as read.");
      }
    });
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
    const centerLat = 33.93444;
    const centerLng = 35.69972;
    const latDiff = lat - centerLat;
    const lngDiff = lng - centerLng;
    const bearing = (Math.atan2(lngDiff, latDiff) * 180) / Math.PI;
    const normalized = (bearing + 360) % 360;
    return Math.floor(normalized / 36) + 1;
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
      this.activeEmergencyPlan.set(summary.emergencyPlan ?? null);
      this.refreshMapMarkers(summary);
      this.refreshEmergencyOverlay(summary);
      this.updateCharts(summary);
      this.deferMapResize();
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
      center: [33.93444, 35.69972],
      zoom: 15
    });

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Tiles &copy; Esri - Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        maxZoom: 20
      }
    ).addTo(this.map);

    L.tileLayer(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Labels &copy; Esri",
        maxZoom: 20
      }
    ).addTo(this.map);

    this.markerLayer.addTo(this.map);
    this.tempLayer.addTo(this.map);
    this.emergencyLayer.addTo(this.map);
    this.villageBorderLayer.addTo(this.map);
    this.loadBorderFromStorage();
    this.renderVillageBorder();

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

      if (!this.pickingLocation()) {
        return;
      }

      this.saveError.set(null);
      this.setSelectedCoordinate(event.latlng.lat, event.latlng.lng);
      this.pickingLocation.set(false);
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
    this.hoveredMarker.set(null);
    this.hoveredPolicePoint.set(null);

    for (const marker of summary.mapMarkers) {
      if (marker.approxLat == null || marker.approxLng == null) {
        continue;
      }

      const isSafe = marker.safetyCheckStatus === "CHECKED_SAFE";
      const circle = L.circleMarker([marker.approxLat, marker.approxLng], {
        radius: 8,
        color: isSafe ? "#15803d" : "#b91c1c",
        fillColor: isSafe ? "#22c55e" : "#ef4444",
        fillOpacity: 0.7
      });

      circle.bindPopup(
        `${marker.householdCode} | ${marker.headName || "Unknown head"} | family size: ${marker.familySize} | safety: ${
          marker.safetyCheckStatus === "CHECKED_SAFE" ? "safe" : "pending"
        } | from: ${marker.originArea || "Unknown"} | ${marker.pinPrecisionM === 0 ? "exact" : `+/-${marker.pinPrecisionM}m`}`
      );

      circle.on("mouseover", () => {
        this.hoveredPolicePoint.set(null);
        this.hoveredMarker.set(marker);
        circle.openPopup();
      });

      circle.on("mouseout", () => {
        if (this.hoveredMarker()?.id === marker.id) {
          this.hoveredMarker.set(null);
        }
        circle.closePopup();
      });

      circle.on("click", () => {
        this.hoveredMarker.set(marker);
        circle.openPopup();
      });

      circle.addTo(this.markerLayer);
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

  private createMemberGroup() {
    return this.fb.group({
      name: ["", [Validators.required, Validators.maxLength(120)]],
      relationshipToHead: [""],
      gender: ["MALE", Validators.required],
      age: [0, [Validators.required, Validators.min(0), Validators.max(120)]],
      yearOfBirth: [null as number | null],
      idDocStatus: ["UNKNOWN", Validators.required],
      idDocType: [""],
      idDocLast4: [""],
      schoolEnrollment: ["NA", Validators.required],
      employmentStatus: ["NA", Validators.required],
      hasDisability: [false],
      hasChronicCondition: [false],
      pregnantOrLactating: [false]
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
      originArea: "",
      nationality: "Lebanese",
      preferredLanguage: "Arabic",
      casePriority: "MEDIUM",
      emergencyName: "",
      emergencyPhone: "",
      emergencyRelation: "",
      housingType: "HOST",
      safetyCheckStatus: "PENDING",
      hasCar: false,
      carModel: "",
      carColor: "",
      carPlate: "",
      contactPhone: "",
      contactWhatsapp: "",
      contactConsent: false,
      needsText: "",
      arrivalDate: new Date().toISOString().slice(0, 10)
    });
    this.membersArray.clear();
    this.membersArray.push(this.createMemberGroup());
  }
}

