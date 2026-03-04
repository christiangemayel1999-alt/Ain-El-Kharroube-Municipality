import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatTabsModule } from "@angular/material/tabs";
import { ActivatedRoute } from "@angular/router";
import { Household, Role } from "../models";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";
import { getMissingCarFields } from "./household-detail.validation";

@Component({
  selector: "app-household-detail-page",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatTabsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule
  ],
  template: `
    <div class="shell" *ngIf="household() as h">
      <mat-card>
        <h2>{{ h.householdCode }}</h2>
        <p>Section: {{ h.zone?.name || h.zoneId }}</p>
      </mat-card>

      <mat-card>
        <mat-tab-group>
          <mat-tab label="Overview">
            <div class="tab-content">
              <p><strong>Map pin:</strong> {{ h.approxLat }}, {{ h.approxLng }} ({{ h.pinPrecisionM === 0 ? 'Exact' : '+/-' + h.pinPrecisionM + 'm' }})</p>
              <p [ngClass]="h.safetyCheckStatus === 'CHECKED_SAFE' ? 'status-safe' : 'status-pending'">
                <strong>Safety check:</strong> {{ h.safetyCheckStatus === 'CHECKED_SAFE' ? 'Checked and safe' : 'Not checked (pending)' }}
              </p>
              <p><strong>Family origin area (within country):</strong> {{ h.originArea || '-' }}</p>
              <p><strong>Nationality:</strong> {{ h.nationality || '-' }}</p>
              <p><strong>Preferred language:</strong> {{ h.preferredLanguage || '-' }}</p>
              <p><strong>Case priority:</strong> {{ h.casePriority || 'MEDIUM' }}</p>
              <p><strong>Emergency contact:</strong> {{ h.emergencyName || '-' }} | {{ h.emergencyPhone || '-' }} | {{ h.emergencyRelation || '-' }}</p>
              <p *ngIf="h.checkedByUserId"><strong>Checked by:</strong> {{ h.checkedByUserId }}</p>
              <p *ngIf="h.checkedAt"><strong>Checked at:</strong> {{ h.checkedAt | date:'yyyy-MM-dd HH:mm' }}</p>

              <div class="members-block">
                <p><strong>Members:</strong></p>
                <p *ngIf="!h.members?.length">No member list recorded.</p>
                <ul *ngIf="h.members?.length">
                  <li *ngFor="let member of h.members">
                    {{ member.name }} ({{ member.gender }}, age {{ member.age }}) | rel: {{ member.relationshipToHead || '-' }} |
                    ID: {{ member.idDocStatus || 'UNKNOWN' }} {{ member.idDocType || '' }} {{ member.idDocLast4 ? '(****' + member.idDocLast4 + ')' : '' }} |
                    school: {{ member.schoolEnrollment || 'NA' }} | work: {{ member.employmentStatus || 'NA' }}
                  </li>
                </ul>
              </div>

              <form *ngIf="canEditHousehold()" [formGroup]="householdForm" (ngSubmit)="saveHousehold()" class="edit-form">
                <h3>Edit family record</h3>
                <div class="grid">
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
                    <mat-label>Arrival date</mat-label>
                    <input matInput type="date" formControlName="arrivalDate" />
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
                    <mat-label>Case status</mat-label>
                    <mat-select formControlName="status">
                      <mat-option value="ACTIVE">ACTIVE</mat-option>
                      <mat-option value="MOVED_OUT">MOVED_OUT</mat-option>
                      <mat-option value="CLOSED">CLOSED</mat-option>
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Safety check</mat-label>
                    <mat-select formControlName="safetyCheckStatus">
                      <mat-option value="PENDING">NOT CHECKED (PENDING)</mat-option>
                      <mat-option value="CHECKED_SAFE">CHECKED AND SAFE</mat-option>
                    </mat-select>
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
                    <mat-label>Has car?</mat-label>
                    <mat-select formControlName="hasCar">
                      <mat-option [value]="false">No</mat-option>
                      <mat-option [value]="true">Yes</mat-option>
                    </mat-select>
                  </mat-form-field>
                </div>

                <div class="grid" *ngIf="householdForm.get('hasCar')?.value">
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

                <div class="grid">
                  <mat-form-field appearance="outline">
                    <mat-label>Emergency contact name</mat-label>
                    <input matInput formControlName="emergencyName" />
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>Emergency contact phone</mat-label>
                    <input matInput formControlName="emergencyPhone" />
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>Emergency relation</mat-label>
                    <input matInput formControlName="emergencyRelation" />
                  </mat-form-field>
                </div>

                <button mat-raised-button color="primary" [disabled]="savingHousehold() || householdForm.invalid">
                  {{ savingHousehold() ? 'Saving...' : 'Save family changes' }}
                </button>
                <p class="msg ok" *ngIf="householdMessage()">{{ householdMessage() }}</p>
                <p class="msg err" *ngIf="householdError()">{{ householdError() }}</p>
              </form>
            </div>
          </mat-tab>

          <mat-tab label="Contacts">
            <div class="tab-content" *ngIf="canViewContacts(); else noContactAccess">
              <form [formGroup]="contactForm" (ngSubmit)="saveContact()" class="edit-form">
                <h3>Contact details</h3>
                <div class="grid">
                  <mat-form-field appearance="outline">
                    <mat-label>Phone</mat-label>
                    <input matInput formControlName="phone" />
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>WhatsApp</mat-label>
                    <input matInput formControlName="whatsapp" />
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>Consent</mat-label>
                    <mat-select formControlName="consent">
                      <mat-option [value]="false">No</mat-option>
                      <mat-option [value]="true">Yes</mat-option>
                    </mat-select>
                  </mat-form-field>
                </div>
                <button mat-raised-button color="primary" [disabled]="savingContact()">
                  {{ savingContact() ? 'Saving...' : 'Save contact' }}
                </button>
                <p class="msg ok" *ngIf="contactMessage()">{{ contactMessage() }}</p>
              </form>
            </div>
          </mat-tab>

          <mat-tab label="Rental">
            <div class="tab-content">
              <p *ngIf="!h.rentalAgreements?.length">No agreements.</p>
              <div *ngFor="let ra of h.rentalAgreements">
                <p><strong>{{ ra.agreementCode }}</strong> | {{ ra.status }} | {{ ra.monthlyRent }}</p>
              </div>
            </div>
          </mat-tab>

          <mat-tab label="Incidents">
            <div class="tab-content">
              <p *ngIf="!h.incidents?.length">No incidents.</p>
              <div *ngFor="let incident of h.incidents">
                <p>{{ incident.incidentCode }} | {{ incident.priority }} | {{ incident.status }}</p>
              </div>
            </div>
          </mat-tab>
        </mat-tab-group>
      </mat-card>
    </div>

    <ng-template #noContactAccess>
      <div class="tab-content">
        <p>Contact details are restricted to ADMIN and CASE_WORKER.</p>
      </div>
    </ng-template>
  `,
  styles: [
    `
      .shell {
        padding: 1rem;
        display: grid;
        gap: 1rem;
      }

      .tab-content {
        padding: 1rem 0.25rem;
      }

      .members-block ul {
        margin: 0.25rem 0 0;
        padding-left: 1.1rem;
      }

      .edit-form {
        margin-top: 1rem;
        display: grid;
        gap: 0.75rem;
        background: #f8fafc;
        border: 1px solid #d6e0e7;
        border-radius: 0.5rem;
        padding: 0.75rem;
      }

      .grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .status-pending {
        color: #b91c1c;
        font-weight: 600;
      }

      .status-safe {
        color: #15803d;
        font-weight: 600;
      }

      .msg.ok {
        color: #15803d;
        font-weight: 600;
        margin: 0;
      }

      .msg.err {
        color: #b91c1c;
        font-weight: 600;
        margin: 0;
      }

      @media (max-width: 900px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class HouseholdDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly household = signal<Household | null>(null);
  readonly savingHousehold = signal(false);
  readonly savingContact = signal(false);
  readonly householdMessage = signal<string | null>(null);
  readonly householdError = signal<string | null>(null);
  readonly contactMessage = signal<string | null>(null);

  readonly householdForm = this.fb.group({
    headName: [""],
    originArea: [""],
    nationality: [""],
    preferredLanguage: [""],
    arrivalDate: ["", Validators.required],
    housingType: ["HOST", Validators.required],
    status: ["ACTIVE", Validators.required],
    safetyCheckStatus: ["PENDING", Validators.required],
    casePriority: ["MEDIUM", Validators.required],
    hasCar: [false, Validators.required],
    carModel: [""],
    carColor: [""],
    carPlate: [""],
    emergencyName: [""],
    emergencyPhone: [""],
    emergencyRelation: [""]
  });

  readonly contactForm = this.fb.group({
    phone: [""],
    whatsapp: [""],
    consent: [false]
  });

  private readonly householdId: string | null;

  constructor() {
    this.householdId = this.route.snapshot.paramMap.get("id");
    this.householdForm.get("hasCar")?.valueChanges.subscribe((value) => {
      this.syncCarValidators(!!value);
    });
    this.syncCarValidators(!!this.householdForm.get("hasCar")?.value);
    if (this.householdId) {
      this.loadHousehold(this.householdId);
    }
  }

  canViewContacts() {
    const role = this.auth.currentUser()?.role as Role | undefined;
    return role === "ADMIN" || role === "CASE_WORKER";
  }

  canEditHousehold() {
    return this.canViewContacts();
  }

  saveHousehold() {
    if (!this.householdId || !this.canEditHousehold()) {
      return;
    }
    if (this.householdForm.invalid) {
      this.householdForm.markAllAsTouched();
      return;
    }

    const form = this.householdForm.getRawValue();
    const hasCar = !!form.hasCar;
    const missingCarFields = getMissingCarFields({
      hasCar,
      carModel: form.carModel,
      carColor: form.carColor,
      carPlate: form.carPlate
    });
    if (missingCarFields.length) {
      for (const field of missingCarFields) {
        const control = this.householdForm.get(field);
        control?.markAsTouched();
      }
      this.householdError.set("Car model, color, and number are required when 'Has car' is Yes.");
      return;
    }

    this.savingHousehold.set(true);
    this.householdMessage.set(null);
    this.householdError.set(null);
    this.api
      .patch<Household>(`/households/${this.householdId}`, {
        headName: String(form.headName ?? "").trim() || null,
        originArea: String(form.originArea ?? "").trim() || null,
        nationality: String(form.nationality ?? "").trim() || null,
        preferredLanguage: String(form.preferredLanguage ?? "").trim() || null,
        arrivalDate: form.arrivalDate,
        housingType: form.housingType,
        status: form.status,
        safetyCheckStatus: form.safetyCheckStatus,
        casePriority: form.casePriority,
        hasCar,
        carModel: hasCar ? String(form.carModel ?? "").trim() : null,
        carColor: hasCar ? String(form.carColor ?? "").trim() : null,
        carPlate: hasCar ? String(form.carPlate ?? "").trim() : null,
        emergencyName: String(form.emergencyName ?? "").trim() || null,
        emergencyPhone: String(form.emergencyPhone ?? "").trim() || null,
        emergencyRelation: String(form.emergencyRelation ?? "").trim() || null
      })
      .subscribe({
        next: (updated) => {
          this.savingHousehold.set(false);
          this.household.set(updated);
          this.householdMessage.set("Family details updated.");
          this.householdError.set(null);
        },
        error: () => {
          this.savingHousehold.set(false);
          this.householdError.set("Could not save family details.");
        }
      });
  }

  saveContact() {
    if (!this.householdId || !this.canViewContacts()) {
      return;
    }
    const form = this.contactForm.getRawValue();
    this.savingContact.set(true);
    this.contactMessage.set(null);
    this.api
      .put(`/households/${this.householdId}/contact`, {
        phone: String(form.phone ?? "").trim() || null,
        whatsapp: String(form.whatsapp ?? "").trim() || null,
        consent: !!form.consent
      })
      .subscribe({
        next: () => {
          this.savingContact.set(false);
          this.contactMessage.set("Contact details updated.");
          this.loadHousehold(this.householdId!);
        },
        error: () => {
          this.savingContact.set(false);
        }
      });
  }

  private loadHousehold(id: string) {
    this.api.get<Household>(`/households/${id}`).subscribe((household) => {
      this.household.set(household);
      this.householdForm.patchValue({
        headName: household.headName ?? "",
        originArea: household.originArea ?? "",
        nationality: household.nationality ?? "",
        preferredLanguage: household.preferredLanguage ?? "",
        arrivalDate: household.arrivalDate ? String(household.arrivalDate).slice(0, 10) : "",
        housingType: household.housingType ?? "HOST",
        status: household.status ?? "ACTIVE",
        safetyCheckStatus: household.safetyCheckStatus ?? "PENDING",
        casePriority: household.casePriority ?? "MEDIUM",
        hasCar: !!household.hasCar,
        carModel: household.carModel ?? "",
        carColor: household.carColor ?? "",
        carPlate: household.carPlate ?? "",
        emergencyName: household.emergencyName ?? "",
        emergencyPhone: household.emergencyPhone ?? "",
        emergencyRelation: household.emergencyRelation ?? ""
      });
      this.syncCarValidators(!!household.hasCar);

      this.contactForm.patchValue({
        phone: household.contact?.phone ?? "",
        whatsapp: household.contact?.whatsapp ?? "",
        consent: !!household.contact?.consent
      });
    });
  }

  private syncCarValidators(hasCar: boolean) {
    const carFields = ["carModel", "carColor", "carPlate"] as const;
    for (const field of carFields) {
      const control = this.householdForm.get(field);
      if (!control) {
        continue;
      }
      if (hasCar) {
        control.addValidators(Validators.required);
      } else {
        control.removeValidators(Validators.required);
      }
      control.updateValueAndValidity({ emitEvent: false });
    }
  }
}
