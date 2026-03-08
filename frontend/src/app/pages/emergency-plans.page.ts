import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { EmergencyPlan } from "../models";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";

@Component({
  selector: "app-emergency-plans-page",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  template: `
    <div class="shell">
      <mat-card *ngIf="canManage()">
        <h2>{{ editingPlanId() ? 'Edit' : 'Create' }} Emergency Plan</h2>
        <form [formGroup]="planForm" (ngSubmit)="savePlan()" class="grid">
          <mat-form-field appearance="outline"><mat-label>Name</mat-label><input matInput formControlName="name" /></mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Type</mat-label>
            <mat-select formControlName="type">
              <mat-option value="SUSPICIOUS_VEHICLE">SUSPICIOUS_VEHICLE</mat-option>
              <mat-option value="SUSPICIOUS_PERSON">SUSPICIOUS_PERSON</mat-option>
              <mat-option value="ARMED_THREAT">ARMED_THREAT</mat-option>
              <mat-option value="MEDICAL_EMERGENCY">MEDICAL_EMERGENCY</mat-option>
              <mat-option value="VILLAGE_LOCKDOWN">VILLAGE_LOCKDOWN</mat-option>
              <mat-option value="CUSTOM">CUSTOM</mat-option>
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
          <mat-form-field appearance="outline"><mat-label>Is active?</mat-label><mat-select formControlName="isActive"><mat-option [value]="false">No</mat-option><mat-option [value]="true">Yes</mat-option></mat-select></mat-form-field>
          <mat-form-field appearance="outline" class="wide"><mat-label>Description</mat-label><textarea matInput rows="2" formControlName="description"></textarea></mat-form-field>
          <mat-form-field appearance="outline" class="wide"><mat-label>Default notification title</mat-label><input matInput formControlName="defaultNotificationTitle" /></mat-form-field>
          <mat-form-field appearance="outline" class="wide"><mat-label>Default notification message</mat-label><textarea matInput rows="2" formControlName="defaultNotificationMessage"></textarea></mat-form-field>

          <div class="wide section">
            <h3>Ordered Steps</h3>
            <div formArrayName="steps">
              <div class="row-grid" *ngFor="let step of steps.controls; let i = index" [formGroupName]="i">
                <mat-form-field appearance="outline"><mat-label>Order</mat-label><input matInput type="number" formControlName="stepOrder" /></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>Title</mat-label><input matInput formControlName="title" /></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>Unit type</mat-label><mat-select formControlName="unitTypeRequired"><mat-option value="POLICE">POLICE</mat-option><mat-option value="CHECKPOINT">CHECKPOINT</mat-option><mat-option value="MEDICAL">MEDICAL</mat-option></mat-select></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>Required?</mat-label><mat-select formControlName="isRequired"><mat-option [value]="true">Yes</mat-option><mat-option [value]="false">No</mat-option></mat-select></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>Icon</mat-label><input matInput formControlName="icon" /></mat-form-field>
                <mat-form-field appearance="outline" class="wide"><mat-label>Description</mat-label><textarea matInput rows="2" formControlName="description"></textarea></mat-form-field>
                <button mat-button color="warn" type="button" (click)="removeStep(i)" [disabled]="steps.length <= 1">Remove step</button>
              </div>
            </div>
            <button mat-button type="button" (click)="addStep()">+ Add step</button>
          </div>

          <div class="wide section">
            <h3>Police Posts</h3>
            <div formArrayName="policePosts">
              <div class="row-grid" *ngFor="let post of policePosts.controls; let i = index" [formGroupName]="i">
                <mat-form-field appearance="outline"><mat-label>Label</mat-label><input matInput formControlName="label" /></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>Lat</mat-label><input matInput type="number" formControlName="lat" /></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>Lng</mat-label><input matInput type="number" formControlName="lng" /></mat-form-field>
                <mat-form-field appearance="outline"><mat-label>Officers</mat-label><input matInput type="number" formControlName="officersCount" /></mat-form-field>
                <button mat-button color="warn" type="button" (click)="removePolicePost(i)" [disabled]="policePosts.length <= 1">Remove post</button>
              </div>
            </div>
            <button mat-button type="button" (click)="addPolicePost()">+ Add police post</button>
          </div>

          <div class="wide actions">
            <button mat-raised-button color="primary" [disabled]="saving() || planForm.invalid">{{ saving() ? 'Saving...' : (editingPlanId() ? 'Update plan' : 'Create plan') }}</button>
            <button mat-button type="button" *ngIf="editingPlanId()" (click)="resetForm()">Cancel edit</button>
            <span class="ok" *ngIf="message()">{{ message() }}</span>
            <span class="err" *ngIf="error()">{{ error() }}</span>
          </div>
        </form>
      </mat-card>

      <mat-card>
        <h2>Emergency Plans</h2>
        <div class="list">
          <div class="item" *ngFor="let p of plans()">
            <div>
              <strong>{{ p.name }}</strong>
              <div class="muted">{{ p.type }} | {{ p.severity }} | {{ p.isActive ? 'ACTIVE' : 'INACTIVE' }}</div>
              <div class="muted">Steps: {{ p.steps.length }}</div>
            </div>
            <div class="item-actions" *ngIf="canManage()">
              <button mat-button type="button" (click)="editPlan(p)">Edit</button>
              <button mat-button color="warn" type="button" (click)="deletePlan(p.id)">Delete</button>
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
      .section { border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.6rem; }
      .section h3 { margin: 0 0 0.4rem; }
      .row-grid { display: grid; grid-template-columns: 1fr; gap: 0.5rem; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.5rem; margin-bottom: 0.5rem; }
      .actions { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 0.6rem; }
      .list { display: grid; gap: 0.5rem; }
      .item { border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.6rem; display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; }
      .item-actions { display: flex; gap: 0.3rem; }
      .muted { color: #64748b; font-size: 0.84rem; }
      .ok { color: #166534; }
      .err { color: #b91c1c; }
      @media (min-width: 760px) { .grid, .row-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (min-width: 1180px) { .grid, .row-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
      @media (max-width: 900px) { .item { flex-direction: column; align-items: flex-start; } }
      @media (max-width: 767px) { .item-actions button, .actions button { width: 100%; } }
    `
  ]
})
export class EmergencyPlansPageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly plans = signal<EmergencyPlan[]>([]);
  readonly editingPlanId = signal<string | null>(null);
  readonly saving = signal(false);
  readonly message = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly planForm = this.fb.group({
    name: ["", Validators.required],
    type: ["CUSTOM", Validators.required],
    severity: ["MEDIUM", Validators.required],
    description: [""],
    defaultNotificationTitle: [""],
    defaultNotificationMessage: [""],
    isActive: [false, Validators.required],
    steps: this.fb.array([this.createStepGroup()]),
    policePosts: this.fb.array([this.createPolicePostGroup()])
  });

  constructor() {
    this.loadPlans();
  }

  get steps() {
    return this.planForm.get("steps") as FormArray;
  }

  get policePosts() {
    return this.planForm.get("policePosts") as FormArray;
  }

  canManage() {
    const role = this.auth.currentUser()?.role;
    return role === "ADMIN" || role === "CASE_WORKER";
  }

  addStep() {
    this.steps.push(this.createStepGroup());
  }

  removeStep(index: number) {
    this.steps.removeAt(index);
  }

  addPolicePost() {
    this.policePosts.push(this.createPolicePostGroup());
  }

  removePolicePost(index: number) {
    this.policePosts.removeAt(index);
  }

  savePlan() {
    if (!this.canManage()) {
      return;
    }
    const value = this.planForm.getRawValue();
    const payload = {
      name: value.name,
      type: value.type,
      severity: value.severity,
      description: this.toNullable(value.description),
      defaultNotificationTitle: this.toNullable(value.defaultNotificationTitle),
      defaultNotificationMessage: this.toNullable(value.defaultNotificationMessage),
      isActive: !!value.isActive,
      steps: value.steps.map((step) => ({
        stepOrder: Number(step.stepOrder) || 1,
        title: step.title,
        description: this.toNullable(step.description),
        icon: this.toNullable(step.icon),
        unitTypeRequired: step.unitTypeRequired,
        isRequired: !!step.isRequired
      })),
      policePosts: value.policePosts
        .filter((post) => String(post.label ?? "").trim().length > 0)
        .map((post) => ({
          label: post.label,
          lat: Number(post.lat),
          lng: Number(post.lng),
          officersCount: Number(post.officersCount) || 1
        }))
    };

    this.saving.set(true);
    this.message.set(null);
    this.error.set(null);

    const id = this.editingPlanId();
    const request = id
      ? this.api.patch<EmergencyPlan>(`/emergency-plans/${id}`, payload)
      : this.api.post<EmergencyPlan>("/emergency-plans", payload);

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.message.set(id ? "Plan updated." : "Plan created.");
        this.resetForm();
        this.loadPlans();
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.error.set(err?.error?.message || "Could not save plan.");
      }
    });
  }

  editPlan(plan: EmergencyPlan) {
    this.editingPlanId.set(plan.id);
    this.planForm.patchValue({
      name: plan.name,
      type: plan.type,
      severity: plan.severity,
      description: plan.description ?? "",
      defaultNotificationTitle: plan.defaultNotificationTitle ?? "",
      defaultNotificationMessage: plan.defaultNotificationMessage ?? "",
      isActive: plan.isActive
    });

    this.steps.clear();
    for (const step of plan.steps) {
      this.steps.push(
        this.fb.group({
          stepOrder: [step.stepOrder, Validators.required],
          title: [step.title, Validators.required],
          description: [step.description ?? ""],
          icon: [step.icon ?? ""],
          unitTypeRequired: [step.unitTypeRequired, Validators.required],
          isRequired: [step.isRequired, Validators.required]
        })
      );
    }
    if (!this.steps.length) {
      this.steps.push(this.createStepGroup());
    }

    this.policePosts.clear();
    for (const post of plan.policePosts) {
      this.policePosts.push(
        this.fb.group({
          label: [post.label, Validators.required],
          lat: [post.lat, Validators.required],
          lng: [post.lng, Validators.required],
          officersCount: [post.officersCount, Validators.required]
        })
      );
    }
    if (!this.policePosts.length) {
      this.policePosts.push(this.createPolicePostGroup());
    }
  }

  deletePlan(id: string) {
    if (!this.canManage()) {
      return;
    }
    this.api.delete(`/emergency-plans/${id}`).subscribe({
      next: () => this.loadPlans(),
      error: (err: { error?: { message?: string } }) => {
        this.error.set(err?.error?.message || "Could not delete plan.");
      }
    });
  }

  resetForm() {
    this.editingPlanId.set(null);
    this.planForm.patchValue({
      name: "",
      type: "CUSTOM",
      severity: "MEDIUM",
      description: "",
      defaultNotificationTitle: "",
      defaultNotificationMessage: "",
      isActive: false
    });
    this.steps.clear();
    this.steps.push(this.createStepGroup());
    this.policePosts.clear();
    this.policePosts.push(this.createPolicePostGroup());
  }

  private loadPlans() {
    this.api.get<EmergencyPlan[]>("/emergency-plans").subscribe((rows) => this.plans.set(rows));
  }

  private createStepGroup() {
    return this.fb.group({
      stepOrder: [1, Validators.required],
      title: ["", Validators.required],
      description: [""],
      icon: [""],
      unitTypeRequired: ["POLICE", Validators.required],
      isRequired: [true, Validators.required]
    });
  }

  private createPolicePostGroup() {
    return this.fb.group({
      label: ["", Validators.required],
      lat: [null as number | null, Validators.required],
      lng: [null as number | null, Validators.required],
      officersCount: [1, Validators.required]
    });
  }

  private toNullable(value: unknown) {
    const text = String(value ?? "").trim();
    return text.length ? text : null;
  }
}
