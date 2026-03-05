import { CommonModule } from "@angular/common";
import { Component, OnInit, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatToolbarModule } from "@angular/material/toolbar";
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { AuthService } from "./services/auth.service";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatButtonModule],
  template: `
    <mat-toolbar color="primary" *ngIf="auth.isLoggedIn()">
      <span class="title">Ain El Kharroube</span>
      <a mat-button routerLink="/dashboard" routerLinkActive="active">Dashboard</a>
      <a mat-button routerLink="/households" routerLinkActive="active">Households</a>
      <a mat-button routerLink="/cars" routerLinkActive="active">Cars</a>
      <a mat-button routerLink="/users" routerLinkActive="active" *ngIf="auth.currentUser()?.role === 'ADMIN'">Users</a>
      <span class="spacer"></span>
      <span class="user" *ngIf="auth.currentUser() as user">{{ user.fullName }} ({{ user.role }})</span>
      <button mat-button (click)="logout()">Logout</button>
    </mat-toolbar>

    <router-outlet></router-outlet>
  `,
  styles: [
    `
      .title {
        font-weight: 600;
        margin-right: 1rem;
      }

      .spacer {
        flex: 1;
      }

      .user {
        margin-right: 0.75rem;
        font-size: 0.9rem;
      }

      .active {
        font-weight: 600;
      }
    `
  ]
})
export class AppComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit() {
    if (this.auth.isLoggedIn()) {
      this.auth.me().subscribe({
        error: () => {
          this.auth.logout();
          void this.router.navigateByUrl("/login");
        }
      });
    }
  }

  logout() {
    this.auth.logout();
    void this.router.navigateByUrl("/login");
  }
}

