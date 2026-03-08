import { CommonModule } from "@angular/common";
import { AfterViewInit, Component, OnDestroy, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { Router, RouterModule } from "@angular/router";
import * as L from "leaflet";
import {
  ControlRoomMapUser,
  ControlRoomOverviewResponse,
  ControlRoomUserRow,
  LiveCameraSessionRecord,
  LiveCameraSessionStatus,
  Role
} from "../models";
import { MediaStreamDirective } from "../directives/media-stream.directive";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";
import { LiveCameraService } from "../services/live-camera.service";

type SelectCause = "MAP" | "SWITCH" | "SELECT";

@Component({
  selector: "app-control-room-page",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MediaStreamDirective
  ],
  template: `
    <div class="shell">
      <mat-card class="toolbar-card">
        <div class="toolbar-row">
          <div>
            <h2>Control Room</h2>
            <p class="muted">Central map + live camera switching for operations staff.</p>
          </div>
          <div class="toolbar-actions">
            <button mat-stroked-button type="button" (click)="refresh()" [disabled]="loading()">Refresh</button>
            <a mat-button routerLink="/live-camera-logs">Camera logs</a>
          </div>
        </div>

        <div class="filters">
          <mat-form-field appearance="outline">
            <mat-label>Search user</mat-label>
            <input matInput [(ngModel)]="search" (keyup.enter)="refresh()" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Camera filter</mat-label>
            <mat-select [(ngModel)]="activeCameraOnly" (selectionChange)="refresh()">
              <mat-option [value]="false">All users</mat-option>
              <mat-option [value]="true">Active camera only</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Tracking filter</mat-label>
            <mat-select [(ngModel)]="liveTrackingOnly" (selectionChange)="refresh()">
              <mat-option [value]="false">All tracking states</mat-option>
              <mat-option [value]="true">Live tracking enabled</mat-option>
            </mat-select>
          </mat-form-field>
        </div>

        <p class="err" *ngIf="error()">{{ error() }}</p>
        <p class="err" *ngIf="camera.viewerErrors()['_global']">{{ camera.viewerErrors()['_global'] }}</p>
      </mat-card>

      <section class="summary-grid" *ngIf="overview() as o">
        <mat-card>
          <div class="summary-label">Tracked users on map</div>
          <div class="summary-value">{{ o.summary.totalTrackedUsers }}</div>
        </mat-card>
        <mat-card>
          <div class="summary-label">Live camera users</div>
          <div class="summary-value">{{ o.summary.totalLiveCameraUsers }}</div>
        </mat-card>
        <mat-card>
          <div class="summary-label">Selected stream</div>
          <div class="summary-value small">{{ selectedSession()?.user?.fullName || 'None' }}</div>
        </mat-card>
        <mat-card>
          <div class="summary-label">Emergency streams</div>
          <div class="summary-value">{{ o.summary.emergencyStreamsCount }}</div>
        </mat-card>
        <mat-card>
          <div class="summary-label">Stale/offline users</div>
          <div class="summary-value">{{ o.summary.staleOrOfflineUsersCount }}</div>
        </mat-card>
        <mat-card>
          <div class="summary-label">Active incidents</div>
          <div class="summary-value">{{ o.summary.activeIncidentsCount }}</div>
        </mat-card>
      </section>

      <section class="workspace" *ngIf="overview() as o">
        <aside class="tiles-column">
          <h3>Live camera tiles</h3>
          <div class="tile-list" *ngIf="leftTiles().length; else noTiles">
            <article
              *ngFor="let session of leftTiles()"
              class="camera-tile"
              [class.selected]="isSelected(session.id)"
            >
              <header>
                <strong>{{ session.user.fullName }}</strong>
                <span class="badge" [class]="tileStateClass(session)">{{ tileState(session) }}</span>
              </header>

              <video
                #tileLeftVideo
                [appMediaStream]="streamFor(session.id)"
                autoplay
                playsinline
                muted
                (click)="selectSession(session.id, 'SWITCH')"
              ></video>

              <p class="meta">{{ session.user.role }} | Started {{ session.startedAt | date:'HH:mm:ss' }}</p>
              <p class="meta">Mic: {{ session.microphoneEnabled === null ? 'Unknown' : session.microphoneEnabled ? 'On' : 'Muted' }}</p>
              <p class="meta">GPS freshness: {{ formatFreshness(session.location?.freshnessSeconds ?? null) }}</p>
              <p class="err small" *ngIf="streamErrorFor(session.id)">{{ streamErrorFor(session.id) }}</p>

              <div class="tile-actions">
                <button mat-button type="button" (click)="focusUserOnMap(session.userId)">Focus map</button>
                <button mat-button type="button" (click)="selectSession(session.id, 'SELECT')">Open large</button>
                <button mat-button type="button" (click)="requestFullscreen(tileLeftVideo)">Fullscreen</button>
              </div>
            </article>
          </div>

          <ng-template #noTiles>
            <p class="muted">No active camera streams right now.</p>
          </ng-template>
        </aside>

        <div class="map-panel">
          <div class="map-header">
            <h3>Operational map</h3>
            <div class="map-actions">
              <button mat-stroked-button type="button" (click)="focusSelectedOnMap()" [disabled]="!selectedSession()">
                Focus selected user
              </button>
              <button mat-stroked-button type="button" (click)="fitMapBounds()">Fit all markers</button>
            </div>
          </div>
          <div id="control-room-map"></div>
          <p class="muted small">Click a map marker to highlight and open its camera stream.</p>
        </div>

        <aside class="viewer-column">
          <mat-card class="main-viewer">
            <h3>Main selected stream</h3>

            <ng-container *ngIf="selectedSession() as selected; else noSelection">
              <div class="selected-header">
                <div>
                  <strong>{{ selected.user.fullName }}</strong>
                  <div class="muted small">{{ selected.user.role }} | {{ tileState(selected) }}</div>
                </div>
                <div class="selected-actions">
                  <button mat-button type="button" (click)="focusUserOnMap(selected.userId)">Focus map</button>
                  <button mat-button type="button" (click)="requestFullscreen(mainVideo)">Fullscreen</button>
                  <button mat-button type="button" (click)="createIncidentFromStream(selected)">Create incident</button>
                </div>
              </div>

              <video
                #mainVideo
                [appMediaStream]="streamFor(selected.id)"
                autoplay
                playsinline
                controls
              ></video>

              <p class="meta">
                Last GPS: {{ selected.location?.lastReceivedAt ? (selected.location?.lastReceivedAt | date:'yyyy-MM-dd HH:mm:ss') : '-' }}
              </p>
              <p class="meta">GPS freshness: {{ formatFreshness(selected.location?.freshnessSeconds ?? null) }}</p>
            </ng-container>

            <ng-template #noSelection>
              <p class="muted">No stream selected.</p>
            </ng-template>
          </mat-card>

          <mat-card class="management-panel">
            <div class="management-header">
              <h3>Tracking + camera management</h3>
              <a mat-button routerLink="/tracking-overview">Tracking ops</a>
            </div>

            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Tracking</th>
                    <th>Camera</th>
                    <th>Trusted device</th>
                    <th>Last GPS</th>
                    <th>Last camera</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of o.users">
                    <td data-label="User">
                      <div><strong>{{ row.name }}</strong></div>
                      <div class="muted small">{{ row.email }}</div>
                    </td>
                    <td data-label="Role">{{ row.role }}</td>
                    <td data-label="Tracking">
                      <span class="badge" [class]="trackingBadgeClass(row.trackingHealthState)">
                        {{ row.trackingHealthState }}
                      </span>
                    </td>
                    <td data-label="Camera">
                      <span class="badge" [class]="cameraBadgeClass(row.cameraStatus)">{{ row.cameraStatus }}</span>
                    </td>
                    <td data-label="Trusted">
                      {{ row.trustedDeviceAssigned ? 'Yes' : 'No' }}
                    </td>
                    <td data-label="Last GPS">{{ row.lastGpsUpdate ? (row.lastGpsUpdate | date:'HH:mm:ss') : '-' }}</td>
                    <td data-label="Last camera">{{ row.lastCameraSessionAt ? (row.lastCameraSessionAt | date:'HH:mm:ss') : '-' }}</td>
                    <td data-label="Actions" class="row-actions">
                      <button mat-button type="button" [disabled]="!row.activeCameraSessionId" (click)="openRowStream(row)">
                        Open stream
                      </button>
                      <button mat-button type="button" (click)="focusUserOnMap(row.userId)">Focus map</button>
                      <button mat-button type="button" (click)="viewLogs(row.userId)">Logs</button>
                      <button
                        mat-button
                        type="button"
                        color="warn"
                        [disabled]="!row.activeCameraSessionId || busySessionId() === row.activeCameraSessionId"
                        (click)="stopSession(row.activeCameraSessionId)">
                        Stop session
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </mat-card>
        </aside>
      </section>

      <section class="right-tiles" *ngIf="rightTiles().length">
        <article *ngFor="let session of rightTiles()" class="camera-tile" [class.selected]="isSelected(session.id)">
          <header>
            <strong>{{ session.user.fullName }}</strong>
            <span class="badge" [class]="tileStateClass(session)">{{ tileState(session) }}</span>
          </header>

          <video
            #tileRightVideo
            [appMediaStream]="streamFor(session.id)"
            autoplay
            playsinline
            muted
            (click)="selectSession(session.id, 'SWITCH')"
          ></video>

          <div class="tile-actions">
            <button mat-button type="button" (click)="focusUserOnMap(session.userId)">Focus map</button>
            <button mat-button type="button" (click)="selectSession(session.id, 'SELECT')">Open large</button>
            <button mat-button type="button" (click)="requestFullscreen(tileRightVideo)">Fullscreen</button>
          </div>

          <p class="err small" *ngIf="streamErrorFor(session.id)">{{ streamErrorFor(session.id) }}</p>
        </article>
      </section>

      <p class="web-note">
        Web-only limitation: live camera streams require the sender browser to stay open and in foreground enough to keep capture and network active.
      </p>
    </div>
  `,
  styles: [
    `
      .shell {
        padding: var(--page-padding);
        display: grid;
        gap: 0.85rem;
      }

      .toolbar-card {
        display: grid;
        gap: 0.75rem;
      }

      .toolbar-row {
        display: flex;
        justify-content: space-between;
        gap: 0.7rem;
        flex-wrap: wrap;
      }

      .toolbar-row h2 {
        margin: 0;
      }

      .toolbar-actions {
        display: flex;
        gap: 0.4rem;
        align-items: center;
      }

      .filters {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.6rem;
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 0.6rem;
      }

      .summary-label {
        color: #475569;
        font-size: 0.8rem;
      }

      .summary-value {
        font-size: 1.35rem;
        font-weight: 700;
        color: #0f172a;
      }

      .summary-value.small {
        font-size: 1rem;
      }

      .workspace {
        display: grid;
        grid-template-columns: 320px minmax(0, 1fr) 420px;
        gap: 0.7rem;
        align-items: start;
      }

      .tiles-column,
      .viewer-column,
      .map-panel {
        min-height: 320px;
      }

      .tiles-column h3,
      .map-panel h3,
      .viewer-column h3 {
        margin-top: 0;
        margin-bottom: 0.45rem;
      }

      .tile-list,
      .right-tiles {
        display: grid;
        gap: 0.55rem;
      }

      .camera-tile {
        border: 1px solid #dbe3ef;
        border-radius: 10px;
        padding: 0.45rem;
        background: #fff;
        display: grid;
        gap: 0.35rem;
      }

      .camera-tile.selected {
        border-color: #2563eb;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.18);
      }

      .camera-tile header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.45rem;
      }

      video {
        width: 100%;
        border-radius: 8px;
        background: #020617;
        min-height: 160px;
        max-height: 310px;
        object-fit: cover;
      }

      .tile-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
      }

      .map-panel {
        border: 1px solid #dbe3ef;
        border-radius: 10px;
        padding: 0.45rem;
        background: #fff;
      }

      .map-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .map-actions {
        display: flex;
        gap: 0.4rem;
      }

      #control-room-map {
        width: 100%;
        min-height: 540px;
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid #dbe2eb;
      }

      .viewer-column {
        display: grid;
        gap: 0.6rem;
      }

      .main-viewer {
        display: grid;
        gap: 0.45rem;
      }

      .selected-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 0.45rem;
        flex-wrap: wrap;
      }

      .selected-actions {
        display: flex;
        gap: 0.3rem;
        flex-wrap: wrap;
      }

      .management-panel {
        display: grid;
        gap: 0.45rem;
      }

      .management-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.45rem;
      }

      .table-wrap {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        border-bottom: 1px solid #e2e8f0;
        padding: 0.45rem;
        text-align: left;
        vertical-align: top;
      }

      .row-actions {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.2rem;
      }

      .badge {
        border-radius: 999px;
        padding: 0.18rem 0.52rem;
        font-size: 0.72rem;
        font-weight: 700;
      }

      .state-live {
        background: #dcfce7;
        color: #166534;
      }

      .state-connecting,
      .state-network_weak {
        background: #fef3c7;
        color: #92400e;
      }

      .state-permission_denied,
      .state-camera_off,
      .state-ended,
      .state-failed,
      .state-offline {
        background: #fee2e2;
        color: #991b1b;
      }

      .tracking-active {
        background: #dcfce7;
        color: #166534;
      }

      .tracking-stale {
        background: #fef3c7;
        color: #92400e;
      }

      .tracking-offline,
      .tracking-not_enabled {
        background: #fee2e2;
        color: #991b1b;
      }

      .meta {
        margin: 0;
        color: #475569;
        font-size: 0.78rem;
      }

      .muted {
        margin: 0;
        color: #64748b;
      }

      .small {
        font-size: 0.78rem;
      }

      .err {
        margin: 0;
        color: #b91c1c;
      }

      .web-note {
        margin: 0;
        color: #334155;
        font-size: 0.84rem;
      }

      @media (max-width: 1600px) {
        .workspace {
          grid-template-columns: 280px minmax(0, 1fr) 360px;
        }

        .summary-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      @media (max-width: 1280px) {
        .workspace {
          grid-template-columns: 1fr;
        }

        #control-room-map {
          min-height: 420px;
        }

        .summary-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .filters {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 820px) {
        .summary-grid {
          grid-template-columns: 1fr;
        }

        table,
        tbody,
        tr,
        td {
          display: block;
          width: 100%;
        }

        thead {
          display: none;
        }

        td {
          border: 0;
          display: flex;
          justify-content: space-between;
          gap: 0.6rem;
        }

        td::before {
          content: attr(data-label);
          font-weight: 700;
          color: #334155;
        }
      }
    `
  ]
})
export class ControlRoomPageComponent implements AfterViewInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly camera = inject(LiveCameraService);
  private readonly router = inject(Router);

  readonly overview = signal<ControlRoomOverviewResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly busySessionId = signal<string | null>(null);
  readonly selectedSessionId = signal<string | null>(null);

  search = "";
  activeCameraOnly = false;
  liveTrackingOnly = false;

  private map?: L.Map;
  private readonly peopleLayer = L.layerGroup();
  private readonly incidentLayer = L.layerGroup();
  private readonly peopleMarkersByUserId = new Map<string, L.Marker>();
  private readonly refreshIntervalMs = 8_000;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly mapCenter: L.LatLngTuple = [33.93444, 35.69972];

  ngAfterViewInit() {
    this.initMap();
    void this.camera.connectViewerSignaling().catch(() => {
      this.error.set("Could not connect to live camera signaling.");
    });
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(false), this.refreshIntervalMs);
  }

  ngOnDestroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.camera.disconnectViewerSignaling();
    this.map?.remove();
  }

  refresh(showLoading = true) {
    if (showLoading) {
      this.loading.set(true);
    }
    this.error.set(null);

    this.api
      .getControlRoomOverview({
        search: this.search.trim() || undefined,
        activeCameraOnly: this.activeCameraOnly,
        liveTrackingOnly: this.liveTrackingOnly,
        staleAfterSeconds: 120,
        offlineAfterSeconds: 600,
        limit: 300
      })
      .subscribe({
        next: (overview) => {
          this.loading.set(false);
          this.overview.set(overview);
          this.syncSelection(overview.cameraSessions);
          void this.camera.syncViewerSessions(overview.cameraSessions);
          this.renderMap(overview);
        },
        error: (err) => {
          this.loading.set(false);
          if (showLoading) {
            this.overview.set(null);
          }
          this.error.set(String(err?.error?.message ?? "Could not load Control Room data."));
        }
      });
  }

  leftTiles() {
    const sessions = this.overview()?.cameraSessions ?? [];
    return sessions.filter((_, index) => index % 2 === 0);
  }

  rightTiles() {
    const sessions = this.overview()?.cameraSessions ?? [];
    return sessions.filter((_, index) => index % 2 !== 0);
  }

  selectedSession() {
    const sessions = this.overview()?.cameraSessions ?? [];
    const selectedId = this.selectedSessionId();
    if (!selectedId) {
      return null;
    }
    return sessions.find((session) => session.id === selectedId) ?? null;
  }

  isSelected(sessionId: string) {
    return this.selectedSessionId() === sessionId;
  }

  streamFor(sessionId: string) {
    return this.camera.viewerStreams()[sessionId] ?? null;
  }

  streamErrorFor(sessionId: string) {
    const value = this.camera.viewerErrors()[sessionId] ?? "";
    return value.trim() || null;
  }

  tileState(session: LiveCameraSessionRecord) {
    return this.camera.viewerSessionState()[session.id] ?? session.sessionStatus;
  }

  tileStateClass(session: LiveCameraSessionRecord) {
    return `state-${this.tileState(session).toLowerCase()}`;
  }

  trackingBadgeClass(state: string) {
    return `tracking-${state.toLowerCase()}`;
  }

  cameraBadgeClass(state: LiveCameraSessionStatus) {
    return `state-${state.toLowerCase()}`;
  }

  selectSession(sessionId: string, cause: SelectCause) {
    if (this.selectedSessionId() === sessionId && cause !== "MAP") {
      return;
    }

    this.selectedSessionId.set(sessionId);
    const session = (this.overview()?.cameraSessions ?? []).find((row) => row.id === sessionId);
    if (session) {
      this.camera.focusSessionOnViewer(session, cause === "SWITCH" ? "SWITCH" : "SELECT");
      this.focusUserOnMap(session.userId);
    }
    this.renderMap(this.overview());
  }

  openRowStream(row: ControlRoomUserRow) {
    if (!row.activeCameraSessionId) {
      return;
    }
    this.selectSession(row.activeCameraSessionId, "SELECT");
  }

  focusUserOnMap(userId: string) {
    if (!this.map) {
      return;
    }

    const marker = this.peopleMarkersByUserId.get(userId);
    if (!marker) {
      return;
    }

    const zoom = Math.max(this.map.getZoom(), 16);
    this.map.flyTo(marker.getLatLng(), zoom, { duration: 0.35 });
    marker.openPopup();
  }

  focusSelectedOnMap() {
    const selected = this.selectedSession();
    if (!selected) {
      return;
    }
    this.focusUserOnMap(selected.userId);
  }

  fitMapBounds() {
    if (!this.map) {
      return;
    }

    const points = [...this.peopleMarkersByUserId.values()].map((marker) => marker.getLatLng());
    if (!points.length) {
      this.map.setView(this.mapCenter, 14);
      return;
    }

    const bounds = L.latLngBounds(points);
    this.map.fitBounds(bounds.pad(0.15));
  }

  requestFullscreen(video: HTMLVideoElement) {
    if (!video) {
      return;
    }
    void video.requestFullscreen?.();
  }

  stopSession(sessionId: string | null) {
    if (!sessionId) {
      return;
    }

    this.busySessionId.set(sessionId);
    this.api.stopLiveCameraSession(sessionId, "STOPPED_BY_OPERATOR").subscribe({
      next: () => {
        this.busySessionId.set(null);
        this.refresh(false);
      },
      error: (err) => {
        this.busySessionId.set(null);
        this.error.set(String(err?.error?.message ?? "Could not stop camera session."));
      }
    });
  }

  viewLogs(userId: string) {
    void this.router.navigate(["/live-camera-logs"], { queryParams: { userId } });
  }

  createIncidentFromStream(session: LiveCameraSessionRecord) {
    const lat = session.location?.latitude ?? null;
    const lng = session.location?.longitude ?? null;
    const label = session.location?.latitude != null && session.location?.longitude != null
      ? `Live camera stream - ${session.user.fullName}`
      : `Live camera stream - ${session.user.fullName} (location unavailable)`;

    void this.router.navigate(["/incidents"], {
      queryParams: {
        source: "live_camera",
        linkedUserId: session.userId,
        title: `Live camera alert - ${session.user.fullName}`,
        locationLabel: label,
        locationLat: lat ?? undefined,
        locationLng: lng ?? undefined,
        locationSource: "LIVE_TRACKING_RECENT"
      }
    });
  }

  formatFreshness(value: number | null) {
    if (value == null) {
      return "N/A";
    }
    if (value < 60) {
      return `${value}s ago`;
    }
    const minutes = Math.round(value / 60);
    return `${minutes}m ago`;
  }

  private syncSelection(sessions: LiveCameraSessionRecord[]) {
    const selectedId = this.selectedSessionId();
    if (selectedId && sessions.some((session) => session.id === selectedId)) {
      return;
    }

    const fallback = sessions[0]?.id ?? null;
    this.selectedSessionId.set(fallback);
  }

  private initMap() {
    if (this.map) {
      return;
    }

    this.map = L.map("control-room-map", {
      center: this.mapCenter,
      zoom: 15,
      maxZoom: 21
    });

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Tiles © Esri, Maxar, Earthstar Geographics",
        maxNativeZoom: 19,
        maxZoom: 21
      }
    ).addTo(this.map);

    L.tileLayer(
      "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Labels © Esri",
        opacity: 0.9,
        maxNativeZoom: 19,
        maxZoom: 21
      }
    ).addTo(this.map);

    this.peopleLayer.addTo(this.map);
    this.incidentLayer.addTo(this.map);
  }

  private renderMap(overview: ControlRoomOverviewResponse | null) {
    if (!this.map || !overview) {
      return;
    }

    this.peopleLayer.clearLayers();
    this.incidentLayer.clearLayers();
    this.peopleMarkersByUserId.clear();

    const selected = this.selectedSession();
    const selectedUserId = selected?.userId ?? null;

    for (const user of overview.mapUsers) {
      const marker = L.marker([user.latitude, user.longitude], {
        icon: this.createUserIcon(user, user.userId === selectedUserId)
      });

      const matchingSession = overview.cameraSessions.find((session) => session.userId === user.userId) ?? null;
      const popupHtml = this.buildUserPopupHtml(user, matchingSession?.id ?? null);
      marker.bindPopup(popupHtml);

      marker.on("popupopen", () => {
        const popupElement = marker.getPopup()?.getElement() ?? null;
        const openButton = popupElement?.querySelector<HTMLButtonElement>("button[data-session-id]");
        if (openButton) {
          openButton.onclick = () => {
            const sessionId = String(openButton.dataset["sessionId"] ?? "");
            if (sessionId) {
              this.selectSession(sessionId, "MAP");
            }
          };
        }
      });

      marker.on("click", () => {
        if (matchingSession) {
          this.selectSession(matchingSession.id, "MAP");
        }
      });

      marker.addTo(this.peopleLayer);
      this.peopleMarkersByUserId.set(user.userId, marker);
    }

    for (const incident of overview.incidentMarkers) {
      const marker = L.marker([incident.locationLat, incident.locationLng], {
        icon: L.divIcon({
          className: "",
          iconSize: [26, 26],
          iconAnchor: [13, 13],
          popupAnchor: [0, -12],
          html: `<div style="width:26px;height:26px;border-radius:999px;background:#b91c1c;border:2px solid #fee2e2;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">!</div>`
        })
      });

      marker.bindPopup(
        `${this.escapeHtml(incident.incidentCode)} | ${this.escapeHtml(incident.title || incident.type)} | ${this.escapeHtml(incident.status)}`
      );
      marker.addTo(this.incidentLayer);
    }
  }

  private createUserIcon(user: ControlRoomMapUser, selected: boolean) {
    const healthColor =
      user.trackingHealthState === "ACTIVE"
        ? "#16a34a"
        : user.trackingHealthState === "STALE"
          ? "#f59e0b"
          : user.trackingHealthState === "OFFLINE"
            ? "#b91c1c"
            : "#64748b";

    const cameraDot = user.hasActiveCamera
      ? `<span style="position:absolute;right:-3px;bottom:-3px;width:13px;height:13px;border-radius:999px;background:#ef4444;border:2px solid #fff;"></span>`
      : "";

    return L.divIcon({
      className: "",
      iconSize: [selected ? 34 : 28, selected ? 34 : 28],
      iconAnchor: [selected ? 17 : 14, selected ? 17 : 14],
      popupAnchor: [0, -14],
      html: `<div style="position:relative;width:${selected ? 34 : 28}px;height:${selected ? 34 : 28}px;border-radius:999px;background:${healthColor};border:${selected ? "3px solid #1d4ed8" : "2px solid rgba(255,255,255,.95)"};box-shadow:0 2px 6px rgba(0,0,0,.4);"></div>${cameraDot}`
    });
  }

  private buildUserPopupHtml(user: ControlRoomMapUser, sessionId: string | null) {
    const button = sessionId
      ? `<button data-session-id="${this.escapeHtml(sessionId)}" style="margin-top:4px;padding:3px 8px;border-radius:6px;border:1px solid #1d4ed8;background:#dbeafe;color:#1e3a8a;cursor:pointer;">Open camera</button>`
      : "";

    return [
      `<strong>${this.escapeHtml(user.fullName)}</strong>`,
      `Role: ${this.escapeHtml(user.role)}`,
      `Tracking: ${this.escapeHtml(user.trackingHealthState)}`,
      `Camera live: ${user.hasActiveCamera ? "Yes" : "No"}`,
      `Last GPS: ${this.escapeHtml(user.lastGpsUpdate ? new Date(user.lastGpsUpdate).toLocaleString() : "N/A")}`,
      button
    ].join("<br />");
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  isOperator() {
    const role = this.auth.currentUser()?.role as Role | undefined;
    return role === "ADMIN" || role === "CASE_WORKER" || role === "POLICE";
  }
}

