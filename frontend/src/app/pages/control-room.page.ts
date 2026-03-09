import { CommonModule } from "@angular/common";
import { AfterViewInit, Component, HostListener, OnDestroy, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatSelectModule } from "@angular/material/select";
import { Router, RouterModule } from "@angular/router";
import * as L from "leaflet";
import { catchError, forkJoin, of } from "rxjs";
import {
  ControlRoomMapUser,
  ControlRoomOverviewResponse,
  ControlRoomUserRow,
  IncidentRecord,
  IncidentStatus,
  LiveCameraIceDebugSummary,
  LiveCameraLogRow,
  LiveCameraSessionRecord,
  Role,
  TrackingLogRow,
  TrackingOverviewUser
} from "../models";
import { MediaStreamBindingState, MediaStreamDirective } from "../directives/media-stream.directive";
import { ApiService } from "../services/api.service";
import { AuthService } from "../services/auth.service";
import { LiveCameraService } from "../services/live-camera.service";

type SelectCause = "MAP" | "SWITCH" | "SELECT";
type UnitOperationalStatus = "AVAILABLE" | "ASSIGNED" | "RESPONDING" | "ON_SCENE" | "OFFLINE" | "EMERGENCY";
type IncidentBucket = "EMERGENCY" | "HIGH" | "MEDIUM" | "LOW";
type EventLevel = "INFO" | "WARN" | "EMERGENCY";
type RoleFilter = "ALL" | "POLICE" | "CASE_WORKER";

type ControlEventItem = {
  id: string;
  at: string;
  source: "CAMERA" | "TRACKING" | "INCIDENT" | "OPERATOR";
  level: EventLevel;
  label: string;
  detail: string;
  userId: string | null;
  sessionId: string | null;
  incidentId: string | null;
};

const ACTIVE_INCIDENT_STATUSES = new Set<IncidentStatus>([
  "DRAFT",
  "REPORTED",
  "ACTIVE_RESPONSE",
  "CONTAINED",
  "OPEN",
  "IN_PROGRESS"
]);

const UNIT_STATUS_OPTIONS: UnitOperationalStatus[] = [
  "AVAILABLE",
  "ASSIGNED",
  "RESPONDING",
  "ON_SCENE",
  "OFFLINE",
  "EMERGENCY"
];

const UNIT_STATUS_STORAGE_KEY = "control-room.unit-status-overrides.v1";

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
  templateUrl: "./control-room.page.html",
  styleUrl: "./control-room.page.css"
})
export class ControlRoomPageComponent implements AfterViewInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly camera = inject(LiveCameraService);
  private readonly router = inject(Router);

  readonly overview = signal<ControlRoomOverviewResponse | null>(null);
  readonly incidents = signal<IncidentRecord[]>([]);
  readonly trackingUsers = signal<TrackingOverviewUser[]>([]);
  readonly cameraLogs = signal<LiveCameraLogRow[]>([]);
  readonly trackingLogs = signal<TrackingLogRow[]>([]);
  readonly backendIceDebug = signal<LiveCameraIceDebugSummary | null>(null);
  readonly eventFeed = signal<ControlEventItem[]>([]);
  readonly operatorEvents = signal<ControlEventItem[]>([]);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly busySessionId = signal<string | null>(null);
  readonly selectedSessionId = signal<string | null>(null);
  readonly selectedUserId = signal<string | null>(null);
  readonly selectedIncidentId = signal<string | null>(null);
  readonly followSelectedUnit = signal(true);
  readonly debugPanelEnabled = signal(false);
  readonly unitStatusOverrides = signal<Record<string, UnitOperationalStatus>>({});
  readonly now = signal(new Date().toISOString());

  readonly unitStatusOptions = UNIT_STATUS_OPTIONS;

  search = "";
  activeCameraOnly = false;
  liveTrackingOnly = false;
  emergencyOnly = false;
  staleOrOfflineOnly = false;
  activeIncidentsOnly = true;
  roleFilter: RoleFilter = "ALL";
  statusFilter: "ALL" | UnitOperationalStatus = "ALL";

  private map?: L.Map;
  private readonly peopleLayer = L.layerGroup();
  private readonly incidentLayer = L.layerGroup();
  private readonly peopleMarkersByUserId = new Map<string, L.Marker>();
  private readonly incidentMarkersById = new Map<string, L.Marker>();
  private readonly mapCenter: L.LatLngTuple = [33.93444, 35.69972];
  private readonly refreshIntervalMs = 9_000;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  ngAfterViewInit() {
    this.loadUnitStatusOverrides();
    this.initMap();
    void this.camera.connectViewerSignaling().catch(() => {
      this.error.set("Could not connect to live camera signaling.");
    });
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(false), this.refreshIntervalMs);
    this.clockTimer = setInterval(() => this.now.set(new Date().toISOString()), 1_000);
  }

  ngOnDestroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    this.camera.disconnectViewerSignaling();
    this.map?.remove();
  }

  @HostListener("document:keydown", ["$event"])
  onHotkey(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    const isTyping = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
    if (isTyping) {
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.openNextStream(true);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.openNextStream(false);
      return;
    }

    if (event.key.toLowerCase() === "e") {
      event.preventDefault();
      this.jumpToEmergencyFocus();
      return;
    }

    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      this.toggleFollowSelected();
    }
  }

  refresh(showLoading = true) {
    if (showLoading) {
      this.loading.set(true);
    }
    this.error.set(null);

    const search = this.search.trim();
    const overview$ = this.api.getControlRoomOverview({
      search: search || undefined,
      activeCameraOnly: this.activeCameraOnly,
      liveTrackingOnly: this.liveTrackingOnly,
      staleAfterSeconds: 120,
      offlineAfterSeconds: 600,
      limit: 300
    });

    const incidents$ = this.api.get<IncidentRecord[]>("/incidents").pipe(catchError(() => of([] as IncidentRecord[])));

    const cameraLogs$ = this.api
      .getLiveCameraLogs({ page: 1, pageSize: 40 })
      .pipe(catchError(() => of({ page: 1, pageSize: 40, total: 0, items: [] as LiveCameraLogRow[] })));

    const trackingLogs$ = this.api
      .getTrackingLogs({ page: 1, pageSize: 40 })
      .pipe(catchError(() => of({ page: 1, pageSize: 40, total: 0, items: [] as TrackingLogRow[] })));

    const trackingUsers$ = this.api.getTrackingUsersOverview({ limit: 300 }).pipe(
      catchError(() =>
        of({
          generatedAt: new Date().toISOString(),
          staleAfterSeconds: 120,
          offlineAfterSeconds: 600,
          users: [] as TrackingOverviewUser[]
        })
      )
    );

    const iceDebug$ = this.api.getLiveCameraIceConfigDebug().pipe(catchError(() => of(null)));

    forkJoin({
      overview: overview$,
      incidents: incidents$,
      cameraLogs: cameraLogs$,
      trackingLogs: trackingLogs$,
      trackingUsers: trackingUsers$,
      iceDebug: iceDebug$
    }).subscribe({
      next: ({ overview, incidents, cameraLogs, trackingLogs, trackingUsers, iceDebug }) => {
        this.loading.set(false);
        this.overview.set(overview);
        this.incidents.set(incidents);
        this.cameraLogs.set(cameraLogs.items);
        this.trackingLogs.set(trackingLogs.items);
        this.trackingUsers.set(trackingUsers.users);
        this.backendIceDebug.set(iceDebug);

        this.syncSelection(overview.cameraSessions);
        void this.camera.syncViewerSessions(overview.cameraSessions);
        this.rebuildEventFeed(this.cameraLogs(), this.trackingLogs(), incidents);
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

  applyLocalViewState() {
    const overview = this.overview();
    if (!overview) {
      return;
    }
    this.syncSelection(overview.cameraSessions);
    this.rebuildEventFeed(this.cameraLogs(), this.trackingLogs(), this.incidents());
    this.renderMap(overview);
  }

  toggleFollowSelected() {
    this.followSelectedUnit.set(!this.followSelectedUnit());
    if (this.followSelectedUnit()) {
      this.focusSelectedOnMap();
    }
  }

  nowLabel() {
    return new Date(this.now()).toLocaleString();
  }

  boolLabel(value: boolean | null | undefined) {
    if (value == null) {
      return "-";
    }
    return value ? "Yes" : "No";
  }

  numberLabel(value: number | null | undefined) {
    if (value == null) {
      return "-";
    }
    return value.toLocaleString();
  }

  hasRuntimeTurn() {
    return this.camera.iceRuntimeSummary().turnPresent;
  }

  isAdmin() {
    return this.auth.currentUser()?.role === "ADMIN";
  }

  isOperator() {
    const role = this.auth.currentUser()?.role as Role | undefined;
    return role === "ADMIN" || role === "CASE_WORKER" || role === "POLICE";
  }

  canManageIncidents() {
    const role = this.auth.currentUser()?.role as Role | undefined;
    return role === "ADMIN" || role === "CASE_WORKER";
  }

  selectedSession() {
    const selectedId = this.selectedSessionId();
    if (!selectedId) {
      return null;
    }
    return (this.overview()?.cameraSessions ?? []).find((session) => session.id === selectedId) ?? null;
  }

  selectedIncident() {
    const selectedId = this.selectedIncidentId();
    if (!selectedId) {
      return null;
    }
    return this.incidents().find((incident) => incident.id === selectedId) ?? null;
  }

  selectedUnitRow() {
    const selectedUserId = this.selectedUserId();
    if (selectedUserId) {
      const byUser = this.userRowById(selectedUserId);
      if (byUser) {
        return byUser;
      }
    }
    const selectedSession = this.selectedSession();
    if (selectedSession) {
      return this.userRowById(selectedSession.userId);
    }
    return this.filteredUsers()[0] ?? null;
  }

  selectedDiagnostics() {
    const selected = this.selectedSession();
    if (!selected) {
      return null;
    }
    return this.camera.viewerDiagnostics()[selected.id] ?? null;
  }

  selectedUnitStatusLabel() {
    const selected = this.selectedUnitRow();
    if (!selected) {
      return "-";
    }
    return this.unitStatusForUser(selected.userId);
  }

  activeIncidents() {
    const search = this.search.trim().toLowerCase();
    const base = this.activeIncidentsOnly ? this.operationalIncidents() : this.incidents();
    return base
      .filter((incident) => this.matchesIncidentRoleFilter(incident))
      .filter((incident) => (this.emergencyOnly ? this.incidentBucket(incident) === "EMERGENCY" : true))
      .filter((incident) => {
        if (!search) {
          return true;
        }
        return (
          incident.incidentCode.toLowerCase().includes(search) ||
          String(incident.title ?? "").toLowerCase().includes(search) ||
          incident.type.toLowerCase().includes(search)
        );
      })
      .sort((a, b) => {
        const bucketDiff = this.incidentBucketRank(this.incidentBucket(a)) - this.incidentBucketRank(this.incidentBucket(b));
        if (bucketDiff !== 0) {
          return bucketDiff;
        }
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }

  private operationalIncidents() {
    return this.incidents()
      .filter((incident) => ACTIVE_INCIDENT_STATUSES.has(incident.status))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  incidentGroups() {
    const incidents = this.activeIncidents();
    return [
      {
        key: "EMERGENCY" as IncidentBucket,
        label: "Emergency",
        items: incidents.filter((item) => this.incidentBucket(item) === "EMERGENCY")
      },
      {
        key: "HIGH" as IncidentBucket,
        label: "High",
        items: incidents.filter((item) => this.incidentBucket(item) === "HIGH")
      },
      {
        key: "MEDIUM" as IncidentBucket,
        label: "Medium",
        items: incidents.filter((item) => this.incidentBucket(item) === "MEDIUM")
      },
      {
        key: "LOW" as IncidentBucket,
        label: "Low",
        items: incidents.filter((item) => this.incidentBucket(item) === "LOW")
      }
    ];
  }

  incidentBucket(incident: IncidentRecord): IncidentBucket {
    if (incident.severity === "CRITICAL") {
      return "EMERGENCY";
    }
    if (incident.priority === "HIGH" || incident.severity === "HIGH") {
      return "HIGH";
    }
    if (incident.priority === "MEDIUM" || incident.severity === "MEDIUM") {
      return "MEDIUM";
    }
    return "LOW";
  }

  incidentPillClass(incident: IncidentRecord) {
    return `st-pill-${this.incidentBucket(incident).toLowerCase()}`;
  }

  emergencyAlertsCount() {
    const emergencySessions = this.filteredSessions().filter((session) => this.isSessionEmergency(session)).length;
    const emergencyIncidents = this.activeIncidents().filter((incident) => this.incidentBucket(incident) === "EMERGENCY").length;
    return emergencySessions + emergencyIncidents;
  }

  staleOrOfflineCount() {
    return this.filteredUsers().filter((row) => this.isStaleOrOffline(row)).length;
  }

  isEmergencyMode() {
    const selectedSession = this.selectedSession();
    const selectedIncident = this.selectedIncident();
    return Boolean(
      (selectedSession && this.isSessionEmergency(selectedSession)) ||
      (selectedIncident && this.incidentBucket(selectedIncident) === "EMERGENCY")
    );
  }

  filteredUsers() {
    const overview = this.overview();
    if (!overview) {
      return [];
    }
    const search = this.search.trim().toLowerCase();
    return overview.users
      .filter((row) => this.matchesRoleFilter(row.role))
      .filter((row) => (this.staleOrOfflineOnly ? this.isStaleOrOffline(row) : true))
      .filter((row) => (this.emergencyOnly ? this.isUserInEmergency(row.userId) : true))
      .filter((row) => (this.statusFilter !== "ALL" ? this.unitStatusForUser(row.userId) === this.statusFilter : true))
      .filter((row) => {
        if (!search) {
          return true;
        }
        return (
          row.name.toLowerCase().includes(search) ||
          row.email.toLowerCase().includes(search) ||
          row.userId.toLowerCase().includes(search)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  filteredSessions() {
    return (this.overview()?.cameraSessions ?? [])
      .filter((session) => this.matchesRoleFilter(session.user.role))
      .filter((session) => (this.emergencyOnly ? this.isSessionEmergency(session) : true))
      .filter((session) => {
        if (!this.staleOrOfflineOnly) {
          return true;
        }
        const row = this.userRowById(session.userId);
        return row ? this.isStaleOrOffline(row) : false;
      })
      .filter((session) => (this.statusFilter !== "ALL" ? this.unitStatusForUser(session.userId) === this.statusFilter : true))
      .filter((session) => {
        const search = this.search.trim().toLowerCase();
        if (!search) {
          return true;
        }
        return (
          session.user.fullName.toLowerCase().includes(search) ||
          session.user.role.toLowerCase().includes(search) ||
          session.id.toLowerCase().includes(search)
        );
      })
      .sort((a, b) => {
        if (this.isSessionEmergency(a) && !this.isSessionEmergency(b)) {
          return -1;
        }
        if (!this.isSessionEmergency(a) && this.isSessionEmergency(b)) {
          return 1;
        }
        return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
      });
  }

  secondarySessions() {
    const selected = this.selectedSessionId();
    return this.filteredSessions().filter((session) => session.id !== selected);
  }

  trackBySessionId(_index: number, session: LiveCameraSessionRecord) {
    return session.id;
  }

  trackByIncidentId(_index: number, incident: IncidentRecord) {
    return incident.id;
  }

  trackByEventId(_index: number, event: ControlEventItem) {
    return event.id;
  }

  trackByUserId(_index: number, row: ControlRoomUserRow) {
    return row.userId;
  }

  isSelected(sessionId: string) {
    return this.selectedSessionId() === sessionId;
  }

  streamFor(sessionId: string) {
    return this.camera.viewerStreams()[sessionId] ?? null;
  }

  streamErrorFor(sessionId: string) {
    const diagnostics = this.camera.viewerDiagnostics()[sessionId];
    const transportError = (this.camera.viewerErrors()[sessionId] ?? "").trim();

    if (diagnostics?.playError) {
      return `Media received but playback failed: ${diagnostics.playError}`;
    }

    if (transportError) {
      return transportError;
    }

    if (diagnostics) {
      if (
        !diagnostics.remoteStreamCreated &&
        !diagnostics.remoteVideoTrackPresent &&
        (diagnostics.bytesReceived == null || diagnostics.bytesReceived <= 0)
      ) {
        return "No media received yet from sender.";
      }

      if (diagnostics.remoteStreamCreated && diagnostics.remoteVideoTrackPresent && !diagnostics.srcObjectBound) {
        return "Media received but not bound to the video element.";
      }
    }

    return null;
  }

  tileState(session: LiveCameraSessionRecord) {
    return this.camera.viewerSessionState()[session.id] ?? session.sessionStatus;
  }

  selectSession(sessionId: string, cause: SelectCause) {
    if (this.selectedSessionId() === sessionId && cause !== "MAP") {
      return;
    }

    const session = (this.overview()?.cameraSessions ?? []).find((row) => row.id === sessionId) ?? null;
    if (!session) {
      return;
    }

    this.selectedSessionId.set(sessionId);
    this.selectedUserId.set(session.userId);
    this.camera.focusSessionOnViewer(session, cause === "SWITCH" ? "SWITCH" : "SELECT");

    if (this.followSelectedUnit()) {
      this.focusUserOnMap(session.userId);
    }
    this.renderMap(this.overview());
  }

  selectUser(userId: string, source: "MAP" | "PANEL" | "STREAM" | "INCIDENT") {
    this.selectedUserId.set(userId);
    if (this.followSelectedUnit() || source === "MAP" || source === "INCIDENT") {
      this.focusUserOnMap(userId);
    }

    const session = this.sessionForUser(userId);
    if (session) {
      this.selectedSessionId.set(session.id);
      this.camera.focusSessionOnViewer(session, source === "STREAM" ? "SWITCH" : "SELECT");
    }

    this.renderMap(this.overview());
  }

  selectIncident(incidentId: string, focusMap: boolean) {
    const incident = this.incidents().find((item) => item.id === incidentId) ?? null;
    if (!incident) {
      return;
    }

    this.selectedIncidentId.set(incident.id);
    if (incident.assignedUserId) {
      this.selectUser(incident.assignedUserId, "INCIDENT");
    }

    if (focusMap) {
      this.focusIncidentOnMap(incident.id);
    }
    this.renderMap(this.overview());
  }

  jumpToEmergencyFocus() {
    const emergencySession = this.filteredSessions().find((session) => this.isSessionEmergency(session));
    if (emergencySession) {
      this.selectSession(emergencySession.id, "SELECT");
      this.addOperatorEvent({
        level: "EMERGENCY",
        label: "Emergency stream prioritized",
        detail: emergencySession.user.fullName,
        userId: emergencySession.userId,
        sessionId: emergencySession.id
      });
      return;
    }

    const emergencyIncident = this.activeIncidents().find((incident) => this.incidentBucket(incident) === "EMERGENCY");
    if (emergencyIncident) {
      this.selectIncident(emergencyIncident.id, true);
      this.addOperatorEvent({
        level: "EMERGENCY",
        label: "Emergency incident prioritized",
        detail: emergencyIncident.incidentCode,
        incidentId: emergencyIncident.id
      });
    }
  }

  openNextStream(forward: boolean) {
    const sessions = this.filteredSessions();
    if (!sessions.length) {
      return;
    }

    const selectedId = this.selectedSessionId();
    const currentIndex = sessions.findIndex((session) => session.id === selectedId);
    if (currentIndex < 0) {
      this.selectSession(sessions[0].id, "SELECT");
      return;
    }

    const nextIndex = (currentIndex + (forward ? 1 : -1) + sessions.length) % sessions.length;
    this.selectSession(sessions[nextIndex].id, "SWITCH");
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
    this.selectedUserId.set(userId);
    this.renderMap(this.overview());
  }

  focusSelectedOnMap() {
    const selected = this.selectedUserId();
    if (!selected) {
      return;
    }
    this.focusUserOnMap(selected);
  }

  focusIncidentOnMap(incidentId: string) {
    if (!this.map) {
      return;
    }

    const marker = this.incidentMarkersById.get(incidentId);
    if (!marker) {
      return;
    }

    const zoom = Math.max(this.map.getZoom(), 15);
    this.map.flyTo(marker.getLatLng(), zoom, { duration: 0.35 });
    marker.openPopup();
    this.selectedIncidentId.set(incidentId);
    this.renderMap(this.overview());
  }

  fitMapBounds() {
    if (!this.map) {
      return;
    }

    const points: L.LatLng[] = [];
    for (const marker of this.peopleMarkersByUserId.values()) {
      points.push(marker.getLatLng());
    }
    for (const marker of this.incidentMarkersById.values()) {
      points.push(marker.getLatLng());
    }

    if (!points.length) {
      this.map.setView(this.mapCenter, 14);
      return;
    }

    this.map.fitBounds(L.latLngBounds(points).pad(0.15));
  }

  requestFullscreen(video: HTMLVideoElement) {
    if (!video) {
      return;
    }
    void video.requestFullscreen?.();
  }

  onMediaStreamBinding(state: MediaStreamBindingState, scope: "tile" | "main") {
    this.camera.reportMediaStreamBindingState(state, scope);
  }

  openRowStream(row: ControlRoomUserRow) {
    if (!row.activeCameraSessionId) {
      return;
    }
    this.selectSession(row.activeCameraSessionId, "SELECT");
  }

  viewCameraLogs(userId: string) {
    void this.router.navigate(["/live-camera-logs"], { queryParams: { userId } });
  }

  viewTrackingLogs(userId: string) {
    void this.router.navigate(["/tracking-logs"], { queryParams: { userId } });
  }

  openUserProfile(userId: string) {
    if (!this.isAdmin()) {
      return;
    }
    void this.router.navigate(["/users"], { queryParams: { userId } });
  }

  openIncidentDetails(incidentId: string) {
    void this.router.navigate(["/incidents", incidentId]);
  }

  requestLocationForUser(userId: string) {
    if (!this.isOperator()) {
      return;
    }

    this.api.createTrackingPing(userId, "Control Room: location update requested", 120).subscribe({
      next: (ping) => {
        this.addOperatorEvent({
          level: "INFO",
          label: "Location request sent",
          detail: `${userId.slice(0, 8)} | ${ping.status}`,
          userId
        });
      },
      error: () => {
        this.addOperatorEvent({
          level: "WARN",
          label: "Location request failed",
          detail: userId.slice(0, 8),
          userId
        });
      }
    });
  }

  stopSession(sessionId: string | null) {
    if (!sessionId) {
      return;
    }

    this.busySessionId.set(sessionId);
    this.api.stopLiveCameraSession(sessionId, "STOPPED_BY_OPERATOR").subscribe({
      next: () => {
        this.busySessionId.set(null);
        this.addOperatorEvent({
          level: "WARN",
          label: "Stream stopped by operator",
          detail: sessionId.slice(0, 8),
          sessionId
        });
        this.refresh(false);
      },
      error: (err) => {
        this.busySessionId.set(null);
        this.error.set(String(err?.error?.message ?? "Could not stop camera session."));
      }
    });
  }

  assignIncidentToSelectedUnit() {
    if (!this.canManageIncidents()) {
      return;
    }
    const incident = this.selectedIncident();
    const unit = this.selectedUnitRow();
    if (!incident || !unit) {
      return;
    }

    this.api
      .patch<IncidentRecord>(`/incidents/${incident.id}`, {
        assignedUserId: unit.userId,
        status: "ACTIVE_RESPONSE"
      })
      .subscribe({
        next: (updated) => {
          this.patchIncident(updated);
          this.selectedIncidentId.set(updated.id);
          this.setUnitStatus(unit.userId, "RESPONDING");
          this.addOperatorEvent({
            level: "INFO",
            label: "Incident assigned",
            detail: `${updated.incidentCode} -> ${unit.name}`,
            userId: unit.userId,
            incidentId: updated.id
          });
        },
        error: (err) => {
          this.error.set(String(err?.error?.message ?? "Could not assign incident."));
        }
      });
  }

  escalateSelectedIncident() {
    if (!this.canManageIncidents()) {
      return;
    }
    const incident = this.selectedIncident();
    if (!incident) {
      return;
    }

    this.api
      .patch<IncidentRecord>(`/incidents/${incident.id}`, {
        priority: "HIGH",
        severity: "CRITICAL"
      })
      .subscribe({
        next: (updated) => {
          this.patchIncident(updated);
          this.selectedIncidentId.set(updated.id);
          this.addOperatorEvent({
            level: "EMERGENCY",
            label: "Incident escalated",
            detail: `${updated.incidentCode} set to CRITICAL`,
            incidentId: updated.id
          });
        },
        error: (err) => {
          this.error.set(String(err?.error?.message ?? "Could not escalate incident."));
        }
      });
  }

  createIncidentFromStream(session: LiveCameraSessionRecord) {
    const lat = session.location?.latitude ?? null;
    const lng = session.location?.longitude ?? null;
    const label =
      session.location?.latitude != null && session.location?.longitude != null
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
        locationSource: "LIVE_TRACKING_RECENT",
        sourceSessionId: session.id
      }
    });
  }

  setUnitStatus(userId: string, status: UnitOperationalStatus) {
    if (!this.isOperator()) {
      return;
    }
    this.unitStatusOverrides.update((rows) => ({ ...rows, [userId]: status }));
    this.persistUnitStatusOverrides();
    this.addOperatorEvent({
      level: status === "EMERGENCY" ? "EMERGENCY" : "INFO",
      label: "Unit status changed",
      detail: `${userId.slice(0, 8)} -> ${status}`,
      userId
    });
    this.renderMap(this.overview());
  }

  unitStatusForUser(userId: string): UnitOperationalStatus {
    const override = this.unitStatusOverrides()[userId];
    if (override) {
      return override;
    }

    const row = this.userRowById(userId);
    const activeIncident = this.linkedIncidentForUser(userId);
    const session = this.sessionForUser(userId);

    if (session?.emergency) {
      return "EMERGENCY";
    }
    if (activeIncident && this.incidentBucket(activeIncident) === "EMERGENCY") {
      return "EMERGENCY";
    }
    if (!row) {
      return "OFFLINE";
    }
    if (row.trackingHealthState === "OFFLINE" || row.cameraStatus === "OFFLINE") {
      return "OFFLINE";
    }
    if (activeIncident) {
      if (activeIncident.status === "ACTIVE_RESPONSE" || activeIncident.status === "IN_PROGRESS") {
        return "RESPONDING";
      }
      if (activeIncident.status === "CONTAINED") {
        return "ON_SCENE";
      }
      return "ASSIGNED";
    }
    if (row.liveCameraActive || row.liveTrackingActive || row.trackingHealthState === "ACTIVE") {
      return "AVAILABLE";
    }
    return "OFFLINE";
  }

  statusPillClass(status: UnitOperationalStatus) {
    return `st-pill-${status.toLowerCase()}`;
  }

  linkedIncidentLabel(userId: string) {
    const incident = this.linkedIncidentForUser(userId);
    if (!incident) {
      return "-";
    }
    return `${incident.incidentCode} (${incident.status})`;
  }

  incidentAssignedName(incident: IncidentRecord) {
    if (!incident.assignedUserId) {
      return "Unassigned";
    }
    const row = this.userRowById(incident.assignedUserId);
    return row?.name ?? `${incident.assignedUserId.slice(0, 8)}...`;
  }

  trackingSnapshotForUser(userId: string) {
    return this.trackingUsers().find((row) => row.userId === userId) ?? null;
  }

  mapFreshnessForUser(userId: string) {
    const mapUser = (this.overview()?.mapUsers ?? []).find((row) => row.userId === userId) ?? null;
    return mapUser?.freshnessSeconds ?? null;
  }

  formatFreshness(value: number | null) {
    if (value == null) {
      return "N/A";
    }
    if (value < 60) {
      return `${value}s ago`;
    }
    return `${Math.round(value / 60)}m ago`;
  }

  private rebuildEventFeed(cameraLogs: LiveCameraLogRow[], trackingLogs: TrackingLogRow[], incidents: IncidentRecord[]) {
    const incidentEvents = incidents.slice(0, 30).map((incident) => ({
      id: `incident-${incident.id}-${incident.updatedAt}`,
      at: incident.updatedAt,
      source: "INCIDENT" as const,
      level: this.incidentBucket(incident) === "EMERGENCY" ? ("EMERGENCY" as EventLevel) : ("INFO" as EventLevel),
      label: `Incident ${incident.incidentCode}`,
      detail: `${incident.title || incident.type} | ${incident.status} | ${incident.priority}`,
      userId: incident.assignedUserId ?? null,
      sessionId: null,
      incidentId: incident.id
    }));

    const cameraEvents = cameraLogs.map((row) => {
      const level: EventLevel =
        row.eventType === "CAMERA_PERMISSION_DENIED" ||
        row.eventType === "CAMERA_STREAM_ENDED_UNEXPECTEDLY" ||
        row.eventType === "TRUSTED_DEVICE_MISMATCH_BLOCKED_CAMERA_START"
          ? "WARN"
          : row.eventType === "CAMERA_SESSION_STARTED" && this.isEmergencyMetadata(row.metadata)
            ? "EMERGENCY"
            : "INFO";

      return {
        id: `camera-${row.id}`,
        at: row.createdAt,
        source: "CAMERA" as const,
        level,
        label: row.eventType,
        detail: row.eventSummary || row.user.fullName,
        userId: row.userId,
        sessionId: row.liveCameraSessionId,
        incidentId: null
      };
    });

    const trackingEvents = trackingLogs.map((row) => {
      const warnTypes = new Set([
        "LIVE_TRACKING_BECAME_STALE",
        "PING_FAILED",
        "GEOLOCATION_PERMISSION_DENIED",
        "GEOLOCATION_UNAVAILABLE",
        "UNAUTHORIZED_TRACKING_ACTION_ATTEMPT",
        "TRUSTED_DEVICE_RESET"
      ]);
      const level: EventLevel = warnTypes.has(row.eventType) ? "WARN" : "INFO";
      return {
        id: `tracking-${row.id}`,
        at: row.timestamp,
        source: "TRACKING" as const,
        level,
        label: row.eventType,
        detail: row.summary || row.user.fullName,
        userId: row.user.id,
        sessionId: row.relatedSessionId,
        incidentId: null
      };
    });

    const merged = [...this.operatorEvents(), ...incidentEvents, ...cameraEvents, ...trackingEvents]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 80);

    this.eventFeed.set(merged);
  }

  private addOperatorEvent(options: {
    level: EventLevel;
    label: string;
    detail: string;
    userId?: string | null;
    sessionId?: string | null;
    incidentId?: string | null;
  }) {
    const event: ControlEventItem = {
      id: `operator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      source: "OPERATOR",
      level: options.level,
      label: options.label,
      detail: options.detail,
      userId: options.userId ?? null,
      sessionId: options.sessionId ?? null,
      incidentId: options.incidentId ?? null
    };

    this.operatorEvents.update((rows) => [event, ...rows].slice(0, 40));
    this.rebuildEventFeed(this.cameraLogs(), this.trackingLogs(), this.incidents());
  }

  private syncSelection(allSessions: LiveCameraSessionRecord[]) {
    const visibleSessions = this.filteredSessions();
    const source = visibleSessions.length ? visibleSessions : allSessions;
    const selectedSessionId = this.selectedSessionId();

    if (!selectedSessionId || !source.some((session) => session.id === selectedSessionId)) {
      const fallback = this.pickSessionFallback(source);
      this.selectedSessionId.set(fallback?.id ?? null);
      if (fallback) {
        this.selectedUserId.set(fallback.userId);
      }
    }

    const selectedUser = this.selectedUserId();
    const users = this.filteredUsers();
    if (selectedUser && users.some((row) => row.userId === selectedUser)) {
      return;
    }

    const selectedSession = this.selectedSession();
    if (selectedSession) {
      this.selectedUserId.set(selectedSession.userId);
      return;
    }

    this.selectedUserId.set(users[0]?.userId ?? null);
  }

  private pickSessionFallback(sessions: LiveCameraSessionRecord[]) {
    if (!sessions.length) {
      return null;
    }
    return sessions.find((session) => this.isSessionEmergency(session)) ?? sessions[0];
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

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap contributors © CARTO",
      maxZoom: 20
    }).addTo(this.map);

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
    this.incidentMarkersById.clear();

    const selectedUserId = this.selectedUserId();
    const selectedIncidentId = this.selectedIncidentId();

    for (const user of this.filteredMapUsers(overview)) {
      const status = this.unitStatusForUser(user.userId);
      const marker = L.marker([user.latitude, user.longitude], {
        icon: this.createUserIcon(user, user.userId === selectedUserId, status, this.isUserInEmergency(user.userId))
      });

      const matchingSession = overview.cameraSessions.find((session) => session.userId === user.userId) ?? null;
      marker.bindPopup(this.buildUserPopupHtml(user, status, matchingSession?.id ?? null));

      marker.on("popupopen", () => {
        const popupElement = marker.getPopup()?.getElement() ?? null;
        const openButton = popupElement?.querySelector<HTMLButtonElement>("button[data-session-id]");
        if (!openButton) {
          return;
        }
        openButton.onclick = () => {
          const sessionId = String(openButton.dataset["sessionId"] ?? "");
          if (sessionId) {
            this.selectSession(sessionId, "MAP");
          }
        };
      });

      marker.on("click", () => {
        this.selectUser(user.userId, "MAP");
        if (matchingSession) {
          this.selectSession(matchingSession.id, "MAP");
        }
      });

      marker.addTo(this.peopleLayer);
      this.peopleMarkersByUserId.set(user.userId, marker);
    }

    for (const incident of this.activeIncidents()) {
      if (incident.locationLat == null || incident.locationLng == null) {
        continue;
      }

      const marker = L.marker([incident.locationLat, incident.locationLng], {
        icon: this.createIncidentIcon(incident, selectedIncidentId === incident.id)
      });

      marker.bindPopup(
        `${this.escapeHtml(incident.incidentCode)} | ${this.escapeHtml(incident.title || incident.type)} | ${this.escapeHtml(incident.status)}`
      );

      marker.on("click", () => this.selectIncident(incident.id, false));
      marker.addTo(this.incidentLayer);
      this.incidentMarkersById.set(incident.id, marker);
    }

    if (this.followSelectedUnit() && selectedUserId) {
      const marker = this.peopleMarkersByUserId.get(selectedUserId);
      if (marker) {
        this.map.panTo(marker.getLatLng(), { animate: true, duration: 0.25 });
      }
    }
  }

  private filteredMapUsers(overview: ControlRoomOverviewResponse) {
    const userLookup = new Map(overview.users.map((row) => [row.userId, row]));
    const search = this.search.trim().toLowerCase();
    return overview.mapUsers
      .filter((user) => this.matchesRoleFilter(user.role))
      .filter((user) => (this.staleOrOfflineOnly ? this.isStaleOrOffline(userLookup.get(user.userId) ?? null) : true))
      .filter((user) => (this.emergencyOnly ? this.isUserInEmergency(user.userId) : true))
      .filter((user) => (this.statusFilter !== "ALL" ? this.unitStatusForUser(user.userId) === this.statusFilter : true))
      .filter((user) => {
        if (!search) {
          return true;
        }
        return (
          user.fullName.toLowerCase().includes(search) ||
          user.role.toLowerCase().includes(search) ||
          user.userId.toLowerCase().includes(search)
        );
      });
  }

  private createUserIcon(
    user: ControlRoomMapUser,
    selected: boolean,
    status: UnitOperationalStatus,
    emergency: boolean
  ) {
    const color =
      status === "EMERGENCY"
        ? "#ef4444"
        : status === "RESPONDING"
          ? "#f97316"
          : status === "ON_SCENE"
            ? "#38bdf8"
            : status === "ASSIGNED"
              ? "#f59e0b"
              : status === "OFFLINE"
                ? "#64748b"
                : "#22c55e";

    const cameraDot = user.hasActiveCamera
      ? `<span style="position:absolute;right:-4px;bottom:-4px;width:14px;height:14px;border-radius:999px;background:#ef4444;border:2px solid #0b1021;"></span>`
      : "";

    const emergencyDot = emergency
      ? `<span style="position:absolute;left:-4px;top:-4px;width:14px;height:14px;border-radius:999px;background:#fb7185;border:2px solid #0b1021;"></span>`
      : "";

    const size = selected ? 36 : 30;
    const anchor = selected ? 18 : 15;
    const border = selected ? "3px solid #67e8f9" : "2px solid rgba(203,213,225,.95)";

    return L.divIcon({
      className: "",
      iconSize: [size, size],
      iconAnchor: [anchor, anchor],
      popupAnchor: [0, -12],
      html: `<div style="position:relative;width:${size}px;height:${size}px;border-radius:999px;background:${color};border:${border};box-shadow:0 2px 9px rgba(0,0,0,.6);"></div>${cameraDot}${emergencyDot}`
    });
  }

  private createIncidentIcon(incident: IncidentRecord, selected: boolean) {
    const bucket = this.incidentBucket(incident);
    const color =
      bucket === "EMERGENCY" ? "#ef4444" : bucket === "HIGH" ? "#f97316" : bucket === "MEDIUM" ? "#f59e0b" : "#22c55e";
    const size = selected ? 30 : 26;
    return L.divIcon({
      className: "",
      iconSize: [size, size],
      iconAnchor: [Math.round(size / 2), Math.round(size / 2)],
      popupAnchor: [0, -12],
      html: `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};border:${selected ? "3px solid #67e8f9" : "2px solid #fee2e2"};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.55);">!</div>`
    });
  }

  private buildUserPopupHtml(user: ControlRoomMapUser, status: UnitOperationalStatus, sessionId: string | null) {
    const button = sessionId
      ? `<button data-session-id="${this.escapeHtml(sessionId)}" style="margin-top:4px;padding:3px 8px;border-radius:6px;border:1px solid #67e8f9;background:#11263f;color:#dbeafe;cursor:pointer;">Open camera</button>`
      : "";

    return [
      `<strong>${this.escapeHtml(user.fullName)}</strong>`,
      `Role: ${this.escapeHtml(user.role)}`,
      `Operational status: ${this.escapeHtml(status)}`,
      `Tracking: ${this.escapeHtml(user.trackingHealthState)}`,
      `Camera live: ${user.hasActiveCamera ? "Yes" : "No"}`,
      `Last GPS: ${this.escapeHtml(user.lastGpsUpdate ? new Date(user.lastGpsUpdate).toLocaleString() : "N/A")}`,
      button
    ].join("<br />");
  }

  private isStaleOrOffline(row: ControlRoomUserRow | null) {
    if (!row) {
      return true;
    }
    return row.trackingHealthState === "STALE" || row.trackingHealthState === "OFFLINE";
  }

  private isSessionEmergency(session: LiveCameraSessionRecord) {
    return Boolean(session.emergency || this.isUserInEmergency(session.userId));
  }

  private isUserInEmergency(userId: string) {
    const status = this.unitStatusForUser(userId);
    if (status === "EMERGENCY") {
      return true;
    }
    const incident = this.linkedIncidentForUser(userId);
    return incident ? this.incidentBucket(incident) === "EMERGENCY" : false;
  }

  private matchesRoleFilter(role: Role) {
    if (this.roleFilter === "ALL") {
      return true;
    }
    return role === this.roleFilter;
  }

  private matchesIncidentRoleFilter(incident: IncidentRecord) {
    if (this.roleFilter === "ALL") {
      return true;
    }
    const role = incident.assignedUserId ? this.userRowById(incident.assignedUserId)?.role ?? null : null;
    if (!role) {
      return true;
    }
    return role === this.roleFilter;
  }

  private sessionForUser(userId: string) {
    return (this.overview()?.cameraSessions ?? []).find((session) => session.userId === userId) ?? null;
  }

  private userRowById(userId: string) {
    return (this.overview()?.users ?? []).find((row) => row.userId === userId) ?? null;
  }

  private incidentBucketRank(bucket: IncidentBucket) {
    return bucket === "EMERGENCY" ? 0 : bucket === "HIGH" ? 1 : bucket === "MEDIUM" ? 2 : 3;
  }

  private linkedIncidentForUser(userId: string) {
    return (
      this.operationalIncidents().find((incident) => incident.assignedUserId === userId) ??
      this.incidents().find((incident) => incident.assignedUserId === userId) ??
      null
    );
  }

  private patchIncident(updated: IncidentRecord) {
    this.incidents.update((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    this.applyLocalViewState();
  }

  private isEmergencyMetadata(metadata: Record<string, unknown> | null) {
    if (!metadata || typeof metadata !== "object") {
      return false;
    }
    return Boolean((metadata as Record<string, unknown>)["emergency"]);
  }

  private loadUnitStatusOverrides() {
    try {
      const raw = localStorage.getItem(UNIT_STATUS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, UnitOperationalStatus>;
      this.unitStatusOverrides.set(parsed);
    } catch {
      this.unitStatusOverrides.set({});
    }
  }

  private persistUnitStatusOverrides() {
    try {
      localStorage.setItem(UNIT_STATUS_STORAGE_KEY, JSON.stringify(this.unitStatusOverrides()));
    } catch {
      // Ignore storage write failures.
    }
  }

  private escapeHtml(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}

