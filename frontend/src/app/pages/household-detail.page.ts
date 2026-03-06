import { CommonModule } from "@angular/common";
import { AfterViewInit, Component, OnDestroy, inject, signal } from "@angular/core";
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { MatTabsModule } from "@angular/material/tabs";
import { ActivatedRoute, Router } from "@angular/router";
import * as L from "leaflet";
import { Household, HouseholdMember, Role } from "../models";
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
  templateUrl: "./household-detail.page.html",
  styleUrl: "./household-detail.page.css"
})
export class HouseholdDetailPageComponent implements AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly household = signal<Household | null>(null);
  readonly savingHousehold = signal(false);
  readonly savingMembers = signal(false);
  readonly savingLocation = signal(false);
  readonly savingContact = signal(false);
  readonly householdMessage = signal<string | null>(null);
  readonly householdError = signal<string | null>(null);
  readonly membersMessage = signal<string | null>(null);
  readonly membersError = signal<string | null>(null);
  readonly locationMessage = signal<string | null>(null);
  readonly locationError = signal<string | null>(null);
  readonly contactMessage = signal<string | null>(null);
  readonly pickedCoordinate = signal<{ lat: number; lng: number } | null>(null);
  readonly deleteArmed = signal(false);

  readonly householdForm = this.fb.group({
    firstName: [""],
    lastName: [""],
    phoneNumber: [""],
    pinLabel: [""],
    headName: [""],
    originArea: [""],
    nationality: [""],
    preferredLanguage: [""],
    arrivalDate: [""],
    housingType: ["HOST"],
    status: ["ACTIVE"],
    casePriority: ["MEDIUM"],
    hasCar: [false, Validators.required],
    carModel: [""],
    carColor: [""],
    carPlate: [""],
    emergencyName: [""],
    emergencyPhone: [""],
    emergencyRelation: [""]
  });

  readonly membersForm = this.fb.group({
    members: this.fb.array([])
  });

  readonly contactForm = this.fb.group({
    phone: [""],
    whatsapp: [""],
    consent: [false]
  });

  private readonly householdId: string | null;
  private map: L.Map | null = null;
  private mapPoint: L.CircleMarker | null = null;
  private readonly defaultMapCenter: L.LatLngTuple = [33.93444, 35.69972];

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

  ngAfterViewInit() {
    this.deferMapRefresh();
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  get membersArray() {
    return this.membersForm.get("members") as FormArray;
  }

  canViewContacts() {
    const role = this.auth.currentUser()?.role as Role | undefined;
    return role === "ADMIN" || role === "CASE_WORKER";
  }

  canEditHousehold() {
    return this.canViewContacts();
  }

  canDeleteHousehold() {
    return this.auth.currentUser()?.role === "ADMIN";
  }

  deleteHousehold() {
    if (!this.householdId || !this.canDeleteHousehold()) {
      return;
    }
    if (!this.deleteArmed()) {
      this.deleteArmed.set(true);
      this.householdError.set("Press Delete family again to confirm.");
      return;
    }

    this.api.delete(`/households/${this.householdId}`).subscribe({
      next: () => {
        this.deleteArmed.set(false);
        void this.router.navigateByUrl("/households");
      },
      error: (err: { error?: { message?: string } }) => {
        this.householdError.set(err?.error?.message || "Could not delete family record.");
      }
    });
  }

  cancelDeleteHousehold() {
    this.deleteArmed.set(false);
    if (this.householdError() === "Press Delete family again to confirm.") {
      this.householdError.set(null);
    }
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
        this.householdForm.get(field)?.markAsTouched();
      }
      this.householdError.set("Car model, color, and number are required when 'Has car' is Yes.");
      return;
    }

    this.savingHousehold.set(true);
    this.householdMessage.set(null);
    this.householdError.set(null);
    this.api
      .patch<Household>(`/households/${this.householdId}`, {
        firstName: this.toOptionalText(form.firstName),
        lastName: this.toOptionalText(form.lastName),
        phoneNumber: this.toOptionalText(form.phoneNumber),
        pinLabel: this.toNullableText(form.pinLabel),
        headName: this.toNullableText(form.headName),
        originArea: this.toNullableText(form.originArea),
        nationality: this.toNullableText(form.nationality),
        preferredLanguage: this.toNullableText(form.preferredLanguage),
        arrivalDate: this.toOptionalText(form.arrivalDate),
        housingType: form.housingType,
        status: form.status,
        casePriority: form.casePriority,
        hasCar,
        carModel: hasCar ? this.toNullableText(form.carModel) : null,
        carColor: hasCar ? this.toNullableText(form.carColor) : null,
        carPlate: hasCar ? this.toNullableText(form.carPlate) : null,
        emergencyName: this.toNullableText(form.emergencyName),
        emergencyPhone: this.toNullableText(form.emergencyPhone),
        emergencyRelation: this.toNullableText(form.emergencyRelation)
      })
      .subscribe({
        next: (updated) => {
          this.savingHousehold.set(false);
          this.applyHousehold(updated);
          this.householdMessage.set("Household details updated.");
        },
        error: (err: { error?: { message?: string } }) => {
          this.savingHousehold.set(false);
          this.householdError.set(err?.error?.message || "Could not save household details.");
        }
      });
  }

  addMember() {
    this.membersArray.push(this.createMemberGroup());
  }

  removeMember(index: number) {
    this.membersArray.removeAt(index);
  }

  moveMember(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= this.membersArray.length || fromIndex === toIndex) {
      return;
    }
    const control = this.membersArray.at(fromIndex);
    this.membersArray.removeAt(fromIndex);
    this.membersArray.insert(toIndex, control);
  }

  memberNamePreview(index: number) {
    const control = this.membersArray.at(index);
    const first = String(control.get("firstName")?.value ?? "").trim();
    const last = String(control.get("lastName")?.value ?? "").trim();
    const fallback = String(control.get("name")?.value ?? "").trim();
    return `${first} ${last}`.trim() || fallback || "Unnamed";
  }

  saveMembers() {
    if (!this.householdId || !this.canEditHousehold()) {
      return;
    }

    const membersPayload = this.membersArray.controls.map((control, index) => {
      const value = control.getRawValue();
      const firstName = String(value.firstName ?? "").trim();
      const lastName = String(value.lastName ?? "").trim();
      const name = `${firstName} ${lastName}`.trim() || String(value.name ?? "").trim() || `Member ${index + 1}`;
      const hasCar = !!value.hasCar;
      const idDocLast4Digits = String(value.idDocLast4 ?? "").replace(/\D/g, "");
      const yearOfBirth = this.toOptionalNumberInRange(value.yearOfBirth, 1900, 2100);

      return {
        name,
        firstName: firstName || null,
        lastName: lastName || null,
        fatherName: this.toNullableText(value.fatherName),
        motherName: this.toNullableText(value.motherName),
        civilIdentityNumber: this.toNullableText(value.civilIdentityNumber),
        phoneNumber: this.toNullableText(value.phoneNumber),
        originArea: this.toNullableText(value.originArea),
        nationality: this.toNullableText(value.nationality),
        gender: value.gender === "FEMALE" ? "FEMALE" : "MALE",
        age: Number.isFinite(Number(value.age)) ? Number(value.age) : 0,
        relationshipToHead: this.toNullableText(value.relationshipToHead),
        yearOfBirth,
        safetyCheckStatus: value.safetyCheckStatus === "CHECKED_SAFE" ? "CHECKED_SAFE" : "PENDING",
        idDocStatus: value.idDocStatus || "UNKNOWN",
        idDocType: this.toNullableText(value.idDocType),
        idDocLast4: idDocLast4Digits.length === 4 ? idDocLast4Digits : null,
        schoolEnrollment: value.schoolEnrollment || "NA",
        employmentStatus: value.employmentStatus || "NA",
        hasDisability: !!value.hasDisability,
        hasChronicCondition: !!value.hasChronicCondition,
        pregnantOrLactating: !!value.pregnantOrLactating,
        hasCar,
        carModel: hasCar ? this.toNullableText(value.carModel) : null,
        carColor: hasCar ? this.toNullableText(value.carColor) : null,
        carPlate: hasCar ? this.toNullableText(value.carPlate) : null
      };
    });

    this.savingMembers.set(true);
    this.membersMessage.set(null);
    this.membersError.set(null);
    this.api.patch<Household>(`/households/${this.householdId}`, { members: membersPayload }).subscribe({
      next: (updated) => {
        this.savingMembers.set(false);
        this.applyHousehold(updated);
        this.membersMessage.set("Members updated.");
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingMembers.set(false);
        this.membersError.set(err?.error?.message || "Could not save members.");
      }
    });
  }

  clearPickedCoordinate() {
    this.pickedCoordinate.set(null);
    this.renderMapPoint();
  }

  saveLocation() {
    if (!this.householdId || !this.canEditHousehold()) {
      return;
    }
    const picked = this.pickedCoordinate();
    if (!picked) {
      return;
    }

    this.savingLocation.set(true);
    this.locationMessage.set(null);
    this.locationError.set(null);
    this.api
      .patch<Household>(`/households/${this.householdId}`, {
        clickedLat: picked.lat,
        clickedLng: picked.lng,
        pinPrecisionM: 0
      })
      .subscribe({
        next: (updated) => {
          this.savingLocation.set(false);
          this.pickedCoordinate.set(null);
          this.applyHousehold(updated);
          this.locationMessage.set("Location updated.");
        },
        error: () => {
          this.savingLocation.set(false);
          this.locationError.set("Could not save location.");
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
        phone: this.toNullableText(form.phone),
        whatsapp: this.toNullableText(form.whatsapp),
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
    this.api.get<Household>(`/households/${id}`).subscribe((household) => this.applyHousehold(household));
  }

  private applyHousehold(household: Household) {
    this.household.set(household);
    this.householdForm.patchValue({
      firstName: household.firstName ?? "",
      lastName: household.lastName ?? "",
      phoneNumber: household.phoneNumber ?? "",
      pinLabel: household.pinLabel ?? "",
      headName: household.headName ?? "",
      originArea: household.originArea ?? "",
      nationality: household.nationality ?? "",
      preferredLanguage: household.preferredLanguage ?? "",
      arrivalDate: household.arrivalDate ? String(household.arrivalDate).slice(0, 10) : "",
      housingType: household.housingType ?? "HOST",
      status: household.status ?? "ACTIVE",
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
    this.setMembersForm(household.members ?? []);
    this.contactForm.patchValue({
      phone: household.contact?.phone ?? "",
      whatsapp: household.contact?.whatsapp ?? "",
      consent: !!household.contact?.consent
    });
    this.deferMapRefresh();
  }

  private setMembersForm(members: HouseholdMember[]) {
    this.membersArray.clear();
    for (const member of members) {
      this.membersArray.push(this.createMemberGroup(member));
    }
    if (this.membersArray.length === 0) {
      this.membersArray.push(this.createMemberGroup());
    }
  }

  private createMemberGroup(member?: Partial<HouseholdMember>) {
    const hasCar = !!member?.hasCar;
    return this.fb.group({
      name: [member?.name ?? ""],
      firstName: [member?.firstName ?? ""],
      lastName: [member?.lastName ?? ""],
      fatherName: [member?.fatherName ?? ""],
      motherName: [member?.motherName ?? ""],
      civilIdentityNumber: [member?.civilIdentityNumber ?? ""],
      phoneNumber: [member?.phoneNumber ?? ""],
      originArea: [member?.originArea ?? ""],
      nationality: [member?.nationality ?? ""],
      gender: [member?.gender ?? "MALE"],
      age: [Number.isFinite(Number(member?.age)) ? Number(member?.age) : 0],
      relationshipToHead: [member?.relationshipToHead ?? ""],
      yearOfBirth: [member?.yearOfBirth ?? null],
      safetyCheckStatus: [member?.safetyCheckStatus ?? "PENDING"],
      idDocStatus: [member?.idDocStatus ?? "UNKNOWN"],
      idDocType: [member?.idDocType ?? ""],
      idDocLast4: [member?.idDocLast4 ?? ""],
      schoolEnrollment: [member?.schoolEnrollment ?? "NA"],
      employmentStatus: [member?.employmentStatus ?? "NA"],
      hasDisability: [!!member?.hasDisability],
      hasChronicCondition: [!!member?.hasChronicCondition],
      pregnantOrLactating: [!!member?.pregnantOrLactating],
      hasCar: [hasCar],
      carModel: [member?.carModel ?? ""],
      carColor: [member?.carColor ?? ""],
      carPlate: [member?.carPlate ?? ""]
    });
  }

  private initMap() {
    const container = document.getElementById("household-location-map");
    if (!container) {
      return;
    }

    const h = this.household();
    const center: L.LatLngTuple =
      h?.approxLat != null && h.approxLng != null ? [h.approxLat, h.approxLng] : this.defaultMapCenter;

    if (!this.map) {
      this.map = L.map("household-location-map", { center, zoom: 15 });

      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: "Tiles &copy; Esri - Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        maxZoom: 20
      }).addTo(this.map);

      L.tileLayer(
        "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        {
          attribution: "Labels &copy; Esri",
          maxZoom: 20
        }
      ).addTo(this.map);

      this.map.on("click", (event: L.LeafletMouseEvent) => {
        this.pickedCoordinate.set({
          lat: Number(event.latlng.lat.toFixed(6)),
          lng: Number(event.latlng.lng.toFixed(6))
        });
        this.locationMessage.set(null);
        this.locationError.set(null);
        this.renderMapPoint();
      });
    } else {
      this.map.setView(center, this.map.getZoom());
      this.map.invalidateSize();
    }

    this.renderMapPoint();
  }

  private renderMapPoint() {
    if (!this.map) {
      return;
    }
    if (this.mapPoint) {
      this.map.removeLayer(this.mapPoint);
      this.mapPoint = null;
    }

    const picked = this.pickedCoordinate();
    const h = this.household();
    const target = picked
      ? { lat: picked.lat, lng: picked.lng, picked: true }
      : h?.approxLat != null && h.approxLng != null
        ? { lat: h.approxLat, lng: h.approxLng, picked: false }
        : null;

    if (!target) {
      return;
    }

    this.mapPoint = L.circleMarker([target.lat, target.lng], {
      radius: 9,
      color: target.picked ? "#1d4ed8" : "#15803d",
      fillColor: target.picked ? "#60a5fa" : "#4ade80",
      fillOpacity: 0.9,
      weight: 2
    }).addTo(this.map);
  }

  private deferMapRefresh() {
    setTimeout(() => this.initMap(), 120);
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

  private toNullableText(value: unknown) {
    const text = String(value ?? "").trim();
    return text.length ? text : null;
  }

  private toOptionalText(value: unknown) {
    const text = String(value ?? "").trim();
    return text.length ? text : undefined;
  }

  private toOptionalNumberInRange(value: unknown, min: number, max: number) {
    const text = String(value ?? "").trim();
    if (!text.length) {
      return null;
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    if (parsed < min || parsed > max) {
      return null;
    }
    return parsed;
  }
}
