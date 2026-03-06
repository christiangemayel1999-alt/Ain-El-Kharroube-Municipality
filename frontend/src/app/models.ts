export type Role = "ADMIN" | "CASE_WORKER" | "FINANCE" | "VIEWER" | "POLICE";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive?: boolean;
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
}

export interface EmergencyPolicePost {
  id?: string;
  label: string;
  lat: number;
  lng: number;
  officersCount: number;
  notes?: string | null;
}

export interface EmergencyPlan {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    id: string;
    fullName: string;
    email: string;
  };
  policePosts: EmergencyPolicePost[];
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  emergencyPlanId?: string | null;
  policePostLabel?: string | null;
  targetLat?: number | null;
  targetLng?: number | null;
  readAt?: string | null;
  createdAt: string;
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

