import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";
import { environment } from "../../environments/environment";

@Injectable({ providedIn: "root" })
export class ApiService {
  constructor(private readonly http: HttpClient) {}

  get<T>(path: string, params?: Record<string, string>) {
    return this.http.get<T>(`${environment.apiBaseUrl}${path}`, { params });
  }

  getBlob(path: string) {
    return this.http.get(`${environment.apiBaseUrl}${path}`, { responseType: "blob" });
  }

  post<T>(path: string, payload: unknown): Observable<T> {
    return this.http.post<T>(`${environment.apiBaseUrl}${path}`, payload);
  }

  patch<T>(path: string, payload: unknown): Observable<T> {
    return this.http.patch<T>(`${environment.apiBaseUrl}${path}`, payload);
  }

  put<T>(path: string, payload: unknown): Observable<T> {
    return this.http.put<T>(`${environment.apiBaseUrl}${path}`, payload);
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${environment.apiBaseUrl}${path}`);
  }
}

