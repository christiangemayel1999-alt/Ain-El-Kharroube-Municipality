export type Role = "ADMIN" | "CASE_WORKER" | "FINANCE" | "VIEWER" | "POLICE";
export type LiveCameraSessionStatus =
  | "CONNECTING"
  | "LIVE"
  | "PERMISSION_DENIED"
  | "CAMERA_OFF"
  | "NETWORK_WEAK"
  | "ENDED"
  | "FAILED"
  | "OFFLINE";
export type LiveCameraEventType =
  | "CAMERA_SESSION_STARTED"
  | "CAMERA_SESSION_STOPPED"
  | "CAMERA_PERMISSION_DENIED"
  | "CAMERA_STREAM_ENDED_UNEXPECTEDLY"
  | "VIEWER_OPENED_STREAM"
  | "VIEWER_SWITCHED_STREAM"
  | "STREAM_SELECTED_IN_CONTROL_ROOM"
  | "TRUSTED_DEVICE_MISMATCH_BLOCKED_CAMERA_START"
  | "CAMERA_STATE_UPDATED";
export type TrackingPingStatus = "PENDING" | "OPENED" | "RESPONDED" | "EXPIRED" | "FAILED" | "CANCELLED";
export type TrackingHealthState = "ACTIVE" | "STALE" | "OFFLINE" | "NOT_ENABLED";
export type IncidentLocationSource = "GPS_FRESH" | "GPS_RECENT" | "MANUAL" | "LIVE_TRACKING_RECENT";
export type TrackingEventType =
  | "TRUSTED_DEVICE_ASSIGNED"
  | "TRUSTED_DEVICE_RESET"
  | "LIVE_TRACKING_STARTED"
  | "LIVE_TRACKING_STOPPED"
  | "LIVE_TRACKING_UPDATE_RECEIVED"
  | "LIVE_TRACKING_BECAME_STALE"
  | "PING_REQUESTED"
  | "PING_NOTIFICATION_DELIVERED"
  | "PING_OPENED"
  | "PING_LOCATION_RESPONDED"
  | "PING_EXPIRED"
  | "PING_CANCELLED"
  | "PING_FAILED"
  | "GEOLOCATION_PERMISSION_DENIED"
  | "GEOLOCATION_UNAVAILABLE"
  | "USER_HIDDEN_FROM_MAP"
  | "TRACKING_SENDER_DISABLED"
  | "UNAUTHORIZED_TRACKING_ACTION_ATTEMPT"
  | "STOP_ACTIVE_TRACKING_SESSION"
  | "PUSH_SUBSCRIPTION_REGISTERED"
  | "PUSH_SUBSCRIPTION_REMOVED"
  | "PUSH_NOTIFICATION_FAILED";

export type IncidentStatus =
  | "DRAFT"
  | "REPORTED"
  | "ACTIVE_RESPONSE"
  | "CONTAINED"
  | "RESOLVED"
  | "CLOSED"
  | "CANCELLED"
  | "OPEN"
  | "IN_PROGRESS";

export type DispatchStatus =
  | "NOTIFIED"
  | "ACKNOWLEDGED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "INVESTIGATING"
  | "COMPLETED"
  | "UNAVAILABLE";

export type UnitType = "POLICE" | "CHECKPOINT" | "MEDICAL";
export type UnitStatus = "AVAILABLE" | "BUSY" | "OFFLINE";

export type EmergencyPlanType =
  | "SUSPICIOUS_VEHICLE"
  | "SUSPICIOUS_PERSON"
  | "ARMED_THREAT"
  | "MEDICAL_EMERGENCY"
  | "VILLAGE_LOCKDOWN"
  | "CUSTOM";

export type EmergencySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type IncidentTimelineEventType =
  | "INCIDENT_CREATED"
  | "VEHICLE_UPDATED"
  | "PLAN_ACTIVATED"
  | "NOTIFICATIONS_SENT"
  | "OFFICER_ACKNOWLEDGED"
  | "UNIT_EN_ROUTE"
  | "UNIT_ARRIVED"
  | "CHECKPOINT_ACTIVATED"
  | "MEDICAL_SUPPORT_REQUESTED"
  | "INCIDENT_RESOLVED"
  | "INCIDENT_CLOSED"
  | "DISPATCH_STATUS_CHANGED"
  | "NOTE_ADDED";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive?: boolean;
  liveLocationEnabled?: boolean;
  liveLocationVisible?: boolean;
  canSendLiveCamera?: boolean;
  visibleInControlRoom?: boolean;
  trustedDeviceAssigned?: boolean;
  trustedDeviceLastSeenAt?: string | null;
}

export interface TrustedDeviceSummary {
  id: string;
  isActive: boolean;
  deviceLabel: string | null;
  platform: string | null;
  browserLanguage: string | null;
  timezone: string | null;
  firstTrustedAt: string;
  lastSeenAt: string;
  resetAt: string | null;
}

export type LocationUpdateSource = "BROWSER_GEOLOCATION" | "SHARE_LINK" | "MANUAL_OVERRIDE";

export interface LiveLocationShareStatus {
  user: {
    id: string;
    fullName: string;
    role: Role;
  };
  isSharing: boolean;
  lastUpdateAt: string | null;
  lastRecordedAt: string | null;
}

export interface LivePersonLocation {
  personId: string;
  fullName: string;
  role: Role;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  lastRecordedAt: string | null;
  lastReceivedAt: string | null;
  source: LocationUpdateSource | null;
  batteryLevel: number | null;
  isTrackingActive: boolean;
  isStale: boolean;
  freshnessSeconds?: number | null;
  lastPingStatus?: TrackingPingStatus | null;
  lastPingRequestedAt?: string | null;
  lastPingRespondedAt?: string | null;
  recentlyPinged?: boolean;
}

export interface LocationHistoryPoint {
  id: string;
  latitude: number;
  longitude: number;
  accuracyM: number;
  source: LocationUpdateSource;
  batteryLevel: number | null;
  recordedAt: string;
  receivedAt: string;
  isSharingSnapshot: boolean;
  sessionId: string | null;
}

export interface LocationHistoryResponse {
  person: {
    id: string;
    fullName: string;
    role: Role;
  };
  window: {
    since: string;
    until: string;
    limit: number;
  };
  points: LocationHistoryPoint[];
}

export interface LocationShareLinkRecord {
  id: string;
  userId: string;
  label: string | null;
  expiresAt: string;
  createdAt: string;
  token: string;
  shareUrl: string;
  user: {
    id: string;
    fullName: string;
  };
}

export interface LocationShareLinkSummary {
  id: string;
  label: string | null;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  createdBy: {
    id: string;
    fullName: string;
  } | null;
}

export interface Zone {
  id: string;
  code: string;
  name: string;
}

export type MapReferenceType =
  | "ROAD"
  | "IMPORTANT_BUILDING"
  | "MUNICIPALITY_POINT"
  | "CHECKPOINT"
  | "SCHOOL"
  | "CHURCH_MOSQUE"
  | "SHELTER"
  | "WATER_POINT"
  | "LANDMARK"
  | "CUSTOM";

export interface MapReference {
  id: string;
  name: string;
  type: MapReferenceType;
  description: string | null;
  lat: number;
  lng: number;
  color: string | null;
  icon: string | null;
  visible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdMember {
  name: string;
  age: number;
  gender: "MALE" | "FEMALE";
  firstName?: string;
  lastName?: string;
  fatherName?: string;
  motherName?: string;
  civilIdentityNumber?: string;
  phoneNumber?: string;
  originArea?: string;
  nationality?: string;
  relationshipToHead?: string | null;
  dateOfBirth?: string | null;
  yearOfBirth?: number | null;
  idDocStatus?: "HAS_ID" | "NO_ID" | "UNKNOWN";
  idDocType?: string | null;
  idDocLast4?: string | null;
  hasDisability?: boolean;
  hasChronicCondition?: boolean;
  pregnantOrLactating?: boolean;
  schoolEnrollment?: "ENROLLED" | "NOT_ENROLLED" | "NA";
  employmentStatus?: "EMPLOYED" | "UNEMPLOYED" | "NA";
  safetyCheckStatus?: "PENDING" | "CHECKED_SAFE";
  hasCar?: boolean;
  carModel?: string | null;
  carColor?: string | null;
  carPlate?: string | null;
}

export interface Household {
  id: string;
  householdCode: string;
  firstName?: string | null;
  lastName?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  civilIdentityNumber?: string | null;
  phoneNumber?: string | null;
  pinLabel?: string | null;
  headName: string | null;
  arrivalDate: string;
  originArea?: string | null;
  zoneId: string;
  housingType?: "RENTAL" | "HOST" | "SHELTER" | "OTHER";
  familySize: number;
  age0_4?: number;
  age5_17?: number;
  age18_59?: number;
  age60plus?: number;
  members?: HouseholdMember[];
  safetyCheckStatus?: "PENDING" | "CHECKED_SAFE";
  casePriority?: "LOW" | "MEDIUM" | "HIGH";
  nationality?: string | null;
  preferredLanguage?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  emergencyRelation?: string | null;
  checkedByUserId?: string | null;
  checkedAt?: string | null;
  hasCar?: boolean;
  carModel?: string | null;
  carColor?: string | null;
  carPlate?: string | null;
  status: "ACTIVE" | "MOVED_OUT" | "CLOSED";
  isVerified: boolean;
  approxLat: number | null;
  approxLng: number | null;
  pinPrecisionM: number;
  zone?: Zone;
  contact?: {
    phone: string | null;
    whatsapp: string | null;
    consent: boolean;
  } | null;
  rentalAgreements?: any[];
  incidents?: any[];
}

export interface EmergencyPolicePost {
  id?: string;
  label: string;
  lat: number;
  lng: number;
  officersCount: number;
  notes?: string | null;
}

export interface EmergencyPlanStep {
  id?: string;
  stepOrder: number;
  title: string;
  description?: string | null;
  icon?: string | null;
  unitTypeRequired: UnitType;
  isRequired: boolean;
}

export interface EmergencyPlan {
  id: string;
  name: string;
  type: EmergencyPlanType;
  severity: EmergencySeverity;
  description?: string | null;
  defaultNotificationTitle?: string | null;
  defaultNotificationMessage?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    id: string;
    fullName: string;
    email: string;
  };
  steps: EmergencyPlanStep[];
  policePosts: EmergencyPolicePost[];
}

export interface IncidentVehicle {
  id?: string;
  incidentId?: string;
  vehicleType?: string | null;
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  plateNumber?: string | null;
  registrationCountry?: string | null;
  directionOfTravel?: string | null;
  passengerCount?: number | null;
  notes?: string | null;
  photoUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ResponseUnit {
  id: string;
  name: string;
  type: UnitType;
  status: UnitStatus;
  latitude: number | null;
  longitude: number | null;
  assignedOfficerId: string | null;
  assignedOfficer?: {
    id: string;
    fullName: string;
    email?: string;
    role: Role;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentDispatch {
  id: string;
  incidentId: string;
  unitId: string;
  officerId: string | null;
  status: DispatchStatus;
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  enRouteAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  unit: ResponseUnit;
  officer?: {
    id: string;
    fullName: string;
    email?: string;
    role: Role;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncidentTimelineEntry {
  id: string;
  incidentId: string;
  eventType: IncidentTimelineEventType;
  message: string;
  metadata?: Record<string, unknown> | null;
  createdById?: string | null;
  createdBy?: {
    id: string;
    fullName: string;
    role: Role;
  } | null;
  createdAt: string;
}

export interface IncidentRecord {
  id: string;
  incidentCode: string;
  title: string | null;
  householdId: string | null;
  type: "MEDICAL" | "HOUSING" | "UTILITY" | "PROTECTION" | "OTHER";
  priority: "LOW" | "MEDIUM" | "HIGH";
  severity: EmergencySeverity;
  description: string;
  assignedUserId: string | null;
  emergencyPlanId: string | null;
  locationLabel: string | null;
  locationLat: number | null;
  locationLng: number | null;
  locationAccuracyM: number | null;
  locationSource: IncidentLocationSource | null;
  status: IncidentStatus;
  dueDate: string | null;
  activatedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  resolutionNotes: string | null;
  vehicle?: IncidentVehicle | null;
  emergencyPlan?: EmergencyPlan | null;
  dispatches?: IncidentDispatch[];
  timeline?: IncidentTimelineEntry[];
  notifications?: NotificationItem[];
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  incidentId?: string | null;
  dispatchId?: string | null;
  incidentType?: "MEDICAL" | "HOUSING" | "UTILITY" | "PROTECTION" | "OTHER" | null;
  incidentPriority?: "LOW" | "MEDIUM" | "HIGH" | null;
  incidentSeverity?: EmergencySeverity | null;
  locationLabel?: string | null;
  vehicleSummary?: string | null;
  actionRequired?: string | null;
  metadata?: Record<string, unknown> | null;
  emergencyPlanId?: string | null;
  policePostLabel?: string | null;
  targetLat?: number | null;
  targetLng?: number | null;
  incident?: IncidentRecord | null;
  dispatch?: {
    id: string;
    status: DispatchStatus;
    unit?: { id: string; name: string; type: UnitType };
  } | null;
  readAt?: string | null;
  createdAt: string;
}

export interface TrackingPingRequest {
  id: string;
  targetUserId: string;
  requestedByUserId: string;
  status: TrackingPingStatus;
  requestMessage: string | null;
  createdAt: string;
  expiresAt: string;
  openedAt: string | null;
  respondedAt: string | null;
  cancelledAt?: string | null;
  lastError?: string | null;
  isLateResponse?: boolean;
  notificationDeliveredAt?: string | null;
  responseTimeSeconds?: number | null;
  requestedBy?: {
    id: string;
    fullName: string;
    role: Role;
  } | null;
  targetUser?: {
    id: string;
    fullName: string;
    role: Role;
  } | null;
  locationPoint?: {
    id: string;
    latitude: number;
    longitude: number;
    accuracyM: number;
    recordedAt: string;
    receivedAt: string;
  } | null;
}

export interface TrackingOverviewUser {
  userId: string;
  name: string;
  email: string;
  role: Role;
  accountStatus: "ACTIVE" | "DISABLED";
  trustedDeviceAssigned: boolean;
  trustedDevice: TrustedDeviceSummary | null;
  liveTrackingSenderEnabled: boolean;
  visibleOnLiveMap: boolean;
  currentlySharing: boolean;
  lastKnownLocationTime: string | null;
  lastKnownLocation: {
    latitude: number | null;
    longitude: number | null;
    accuracyM: number | null;
    source: LocationUpdateSource | null;
  };
  lastPingStatus: TrackingPingStatus | null;
  lastPingRequestedAt: string | null;
  lastPingRespondedAt: string | null;
  lastSeenOnlineAt: string | null;
  trackingHealthState: TrackingHealthState;
}

export interface TrackingOverviewResponse {
  generatedAt: string;
  staleAfterSeconds: number;
  offlineAfterSeconds: number;
  users: TrackingOverviewUser[];
}

export interface TrackingLogRow {
  id: string;
  timestamp: string;
  user: {
    id: string;
    fullName: string;
    role: Role;
  };
  actor: {
    id: string;
    fullName: string;
    role: Role;
  } | null;
  eventType: TrackingEventType;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  relatedPingRequest: {
    id: string;
    status: TrackingPingStatus;
    createdAt: string;
    openedAt: string | null;
    respondedAt: string | null;
    expiresAt: string;
    isLateResponse: boolean;
    locationPoint: {
      id: string;
      latitude: number;
      longitude: number;
      accuracyM: number;
      recordedAt: string;
      receivedAt: string;
    } | null;
  } | null;
  relatedSessionId: string | null;
  relatedTrustedDeviceId: string | null;
  coordinates: {
    latitude: number;
    longitude: number;
    accuracyM: number;
  } | null;
}

export interface TrackingLogsResponse {
  page: number;
  pageSize: number;
  total: number;
  items: TrackingLogRow[];
}

export interface LiveCameraSessionRecord {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  isActive: boolean;
  sessionStatus: LiveCameraSessionStatus;
  rawSessionStatus?: LiveCameraSessionStatus | null;
  relatedLocationPointId?: string | null;
  deviceLabel?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
  microphoneEnabled?: boolean | null;
  emergency?: boolean;
  location?: {
    latitude: number | null;
    longitude: number | null;
    accuracyM: number | null;
    lastRecordedAt?: string | null;
    lastReceivedAt: string | null;
    isTrackingActive: boolean;
    freshnessSeconds: number | null;
  } | null;
  user: {
    id: string;
    fullName: string;
    role: Role;
    canSendLiveCamera: boolean;
    visibleInControlRoom: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface LiveCameraLogRow {
  id: string;
  userId: string;
  actorUserId: string | null;
  eventType: LiveCameraEventType;
  eventSummary: string | null;
  metadata: Record<string, unknown> | null;
  liveCameraSessionId: string | null;
  createdAt: string;
  user: {
    id: string;
    fullName: string;
    role: Role;
  };
  actorUser: {
    id: string;
    fullName: string;
    role: Role;
  } | null;
  liveCameraSession: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    isActive: boolean;
    sessionStatus: LiveCameraSessionStatus;
  } | null;
}

export interface LiveCameraLogsResponse {
  page: number;
  pageSize: number;
  total: number;
  items: LiveCameraLogRow[];
}

export interface ControlRoomUserRow {
  userId: string;
  name: string;
  email: string;
  role: Role;
  canSendLiveCamera: boolean;
  visibleInControlRoom: boolean;
  liveTrackingEnabled: boolean;
  liveTrackingVisible: boolean;
  liveTrackingActive: boolean;
  liveCameraActive: boolean;
  cameraStatus: LiveCameraSessionStatus;
  microphoneEnabled: boolean | null;
  trustedDeviceAssigned: boolean;
  trustedDevice: {
    id: string;
    isActive: boolean;
    deviceLabel: string | null;
    platform: string | null;
    lastSeenAt: string;
  } | null;
  lastGpsUpdate: string | null;
  lastKnownLocation: {
    latitude: number | null;
    longitude: number | null;
    accuracyM: number | null;
    source: LocationUpdateSource | null;
  };
  trackingHealthState: TrackingHealthState;
  activeCameraSessionId: string | null;
  lastCameraSessionAt: string | null;
  lastCameraEndedAt: string | null;
}

export interface ControlRoomMapUser {
  userId: string;
  fullName: string;
  role: Role;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  isTrackingActive: boolean;
  trackingHealthState: TrackingHealthState;
  lastGpsUpdate: string | null;
  freshnessSeconds: number | null;
  hasActiveCamera: boolean;
  activeCameraSessionId: string | null;
  cameraStatus: LiveCameraSessionStatus;
  lastCameraSessionAt: string | null;
  lastCameraEndedAt: string | null;
}

export interface ControlRoomOverviewResponse {
  generatedAt: string;
  summary: {
    totalTrackedUsers: number;
    totalLiveCameraUsers: number;
    emergencyStreamsCount: number;
    staleOrOfflineUsersCount: number;
    activeIncidentsCount: number;
  };
  incidentMarkers: Array<{
    id: string;
    incidentCode: string;
    title: string | null;
    type: "MEDICAL" | "HOUSING" | "UTILITY" | "PROTECTION" | "OTHER";
    priority: "LOW" | "MEDIUM" | "HIGH";
    severity: EmergencySeverity;
    status: IncidentStatus;
    locationLabel: string | null;
    locationLat: number;
    locationLng: number;
  }>;
  mapUsers: ControlRoomMapUser[];
  cameraSessions: LiveCameraSessionRecord[];
  users: ControlRoomUserRow[];
}

export interface PushPublicKeyResponse {
  enabled: boolean;
  publicKey: string | null;
}

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSummary {
  kpis: {
    totalHouseholdsActive: number;
    totalIndividuals: number;
    children0_17: number;
    elderly60plus: number;
    occupiedUnits: number;
    availableUnits: number;
  };
  charts: {
    householdsByZone: Array<{ zone: string; value: number }>;
    individualsByZone: Array<{ zone: string; value: number }>;
    needsBreakdown: Array<{ name: string; value: number }>;
    newArrivalsPerWeek: Array<{ week: string; value: number }>;
  };
  workQueue: {
    pendingChecks: Array<{
      id: string;
      householdCode: string;
      firstName: string | null;
      lastName: string | null;
      headName: string | null;
      zoneId: string;
      zoneName: string | null;
      originArea: string | null;
      arrivalDate: string;
      phoneNumber: string | null;
      casePriority: "LOW" | "MEDIUM" | "HIGH";
    }>;
  };
  mapMarkers: Array<{
    id: string;
    householdCode: string;
    firstName: string | null;
    lastName: string | null;
    fatherName: string | null;
    motherName: string | null;
    civilIdentityNumber: string | null;
    phoneNumber: string | null;
    pinLabel: string | null;
    headName: string | null;
    originArea: string | null;
    arrivalDate: string;
    approxLat: number;
    approxLng: number;
    pinPrecisionM: number;
    familySize: number;
    age0_4: number;
    age5_17: number;
    age18_59: number;
    age60plus: number;
    members?: HouseholdMember[];
    needs: string[];
    casePriority: "LOW" | "MEDIUM" | "HIGH";
    safetyCheckStatus: "PENDING" | "CHECKED_SAFE";
    hasCar: boolean;
    carModel: string | null;
    carColor: string | null;
    carPlate: string | null;
  }>;
  mapReferences: MapReference[];
  zoneLabels: Array<{
    zoneId: string;
    zone: string;
    lat: number;
    lng: number;
    households: number;
  }>;
  recentArrivals: Household[];
  emergencyPlan?: EmergencyPlan | null;
  activeIncidents: IncidentRecord[];
  incidentMarkers: Array<{
    id: string;
    incidentCode: string;
    title: string | null;
    type: "MEDICAL" | "HOUSING" | "UTILITY" | "PROTECTION" | "OTHER";
    priority: "LOW" | "MEDIUM" | "HIGH";
    severity: EmergencySeverity;
    status: IncidentStatus;
    locationLabel: string | null;
    locationLat: number | null;
    locationLng: number | null;
    vehicle?: IncidentVehicle | null;
  }>;
  responseUnits: ResponseUnit[];
  activeDispatches: Array<
    IncidentDispatch & {
      incident: IncidentRecord;
    }
  >;
}

export interface CarRecord {
  recordId: string;
  householdId: string;
  householdCode: string;
  firstName: string | null;
  lastName: string | null;
  fatherName: string | null;
  motherName: string | null;
  headName: string | null;
  civilIdentityNumber: string | null;
  phoneNumber: string | null;
  originArea: string | null;
  safetyCheckStatus: "PENDING" | "CHECKED_SAFE";
  casePriority: "LOW" | "MEDIUM" | "HIGH";
  carModel: string | null;
  carColor: string | null;
  carPlate: string | null;
  memberIndex: number;
  memberName: string | null;
  memberFirstName: string | null;
  memberLastName: string | null;
  memberFatherName: string | null;
  memberMotherName: string | null;
  memberCivilIdentityNumber: string | null;
  memberPhoneNumber: string | null;
  memberRelationshipToHead: string | null;
  zone: Zone;
  createdAt: string;
}

export interface HouseholdImportIssue {
  rowNumber: number;
  message: string;
}

export interface HouseholdImportSummary {
  householdsImported: number;
  householdsCreated: number;
  householdsUpdated: number;
  membersImported: number;
  rowsWithWarnings: number;
  rowsSkipped: number;
  warnings: HouseholdImportIssue[];
  skipped: HouseholdImportIssue[];
}
