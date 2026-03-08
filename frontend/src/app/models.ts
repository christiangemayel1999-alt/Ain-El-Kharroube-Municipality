export type Role = "ADMIN" | "CASE_WORKER" | "FINANCE" | "VIEWER" | "POLICE";

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
