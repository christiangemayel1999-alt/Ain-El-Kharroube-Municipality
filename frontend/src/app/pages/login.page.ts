import { CommonModule } from "@angular/common";
import { Component, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { Router } from "@angular/router";
import { AuthService } from "../services/auth.service";

@Component({
  selector: "app-login-page",
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule
  ],
  template: `
    <div class="login-shell">
      <mat-card>
        <h1>Ain El Kharroube Access</h1>
        <p class="sub">Authorized staff only</p>

        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field appearance="outline">
            <mat-label>Email</mat-label>
            <input matInput formControlName="email" autocomplete="username" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Password</mat-label>
            <input matInput type="password" formControlName="password" autocomplete="current-password" />
          </mat-form-field>

          <p class="error" *ngIf="error()">{{ error() }}</p>

          <button mat-raised-button color="primary" [disabled]="form.invalid || loading()">
            {{ loading() ? 'Signing in...' : 'Sign in' }}
          </button>
        </form>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .login-shell {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 1rem;
        background: linear-gradient(120deg, #dff2eb, #f9fafb);
      }

      mat-card {
        width: min(420px, 100%);
        padding: 1rem;
      }

      form {
        display: grid;
        gap: 0.75rem;
      }

      h1 {
        margin: 0;
      }

      .sub {
        margin-top: 0.25rem;
        color: #555;
      }

      .error {
        color: #b00020;
        margin: 0;
      }

      button {
        width: 100%;
      }
    `
  ]
})
export class LoginPageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly error = signal("");

  readonly form = this.fb.nonNullable.group({
    email: ["", [Validators.required, Validators.email]],
    password: ["", [Validators.required, Validators.minLength(8)]]
  });

  submit() {
    if (this.form.invalid || this.loading()) {
      return;
    }

    this.error.set("");
    this.loading.set(true);

    const { email, password } = this.form.getRawValue();
    this.auth.login(email, password).subscribe({
      next: () => {
        this.loading.set(false);
        void this.router.navigateByUrl("/dashboard");
      },
      error: () => {
        this.loading.set(false);
        this.error.set("Invalid credentials");
      }
    });
  }
}

