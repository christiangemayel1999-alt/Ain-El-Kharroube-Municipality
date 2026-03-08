import { HttpClient } from "@angular/common/http";
import { Injectable, signal } from "@angular/core";
import { Observable, tap } from "rxjs";
import { environment } from "../../environments/environment";
import { User, Role } from "../models";
import { DeviceIdentityService } from "./device-identity.service";

interface LoginResponse {
  token: string;
  user: User;
}

@Injectable({ providedIn: "root" })
export class AuthService {
  private readonly tokenKey = "mvp_token";
  private readonly userKey = "mvp_user";

  readonly currentUser = signal<User | null>(this.readUser());

  constructor(
    private readonly http: HttpClient,
    private readonly deviceIdentity: DeviceIdentityService
  ) {}

  login(email: string, password: string): Observable<LoginResponse> {
    const device = this.deviceIdentity.getLoginDevicePayload();
    return this.http
      .post<LoginResponse>(`${environment.apiBaseUrl}/auth/login`, { email, password, device })
      .pipe(
        tap((response) => {
          localStorage.setItem(this.tokenKey, response.token);
          localStorage.setItem(this.userKey, JSON.stringify(response.user));
          this.currentUser.set(response.user);
        })
      );
  }

  me(): Observable<User> {
    return this.http.get<User>(`${environment.apiBaseUrl}/me`).pipe(
      tap((user) => {
        localStorage.setItem(this.userKey, JSON.stringify(user));
        this.currentUser.set(user);
      })
    );
  }

  logout() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
    this.currentUser.set(null);
  }

  getToken() {
    return localStorage.getItem(this.tokenKey);
  }

  isLoggedIn() {
    return Boolean(this.getToken());
  }

  hasAnyRole(roles: Role[]) {
    const user = this.currentUser();
    return !!user && roles.includes(user.role);
  }

  private readUser(): User | null {
    const raw = localStorage.getItem(this.userKey);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  }
}

