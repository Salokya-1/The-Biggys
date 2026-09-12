export type Role = 'ADMIN' | 'MODULE_LEADER' | 'LECTURER' | 'STUDENT';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  studentId: string | null;
  /** Capability keys this account holds (role defaults plus per-user overrides). */
  actions?: string[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export type StudentStatus = 'ACTIVE' | 'DEFERRED' | 'WITHDRAWN' | 'GRADUATED';
export type Standing = 'GOOD' | 'RESIT' | 'REVIEW';
export type Outcome = 'PASS' | 'FAIL' | 'RESIT' | 'DEFERRED';
export type MarkSheetStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'CORRECTION_REQUESTED';

export interface Semester {
  id: string;
  number: number;
  startDate: string;
  endDate: string;
  intakeId: string;
}

export interface Intake {
  id: string;
  label: string;
  startDate: string;
  programmeId: string;
  semesters: Semester[];
}

export interface Programme {
  id: string;
  code: string;
  name: string;
  level: string;
  intakes: Intake[];
  _count?: { students: number; modules: number };
}

export interface StudentSummary {
  id: string;
  studentId: string;
  name: string;
  email: string | null;
  status: StudentStatus;
  standing: Standing;
  specialNeedsSeating: boolean;
  programme: { id: string; code: string; name: string };
  intake: { id: string; label: string };
  currentSemester: { id: string; number: number } | null;
}

export interface ProfileModuleRow {
  enrollmentId: string;
  module: { id: string; code: string; title: string; credits: number; semesterNumber: number };
  offeringId: string;
  lecturer: string | null;
  semesterNumber: number;
  attempt: number;
  isResit: boolean;
  result: {
    overallMark: number;
    grade: string;
    outcome: Outcome;
    version: number;
    status: MarkSheetStatus;
    publishedAt: string | null;
  } | null;
}

export interface StudentProfile {
  student: StudentSummary & {
    programme: { id: string; code: string; name: string; level: string };
    intake: { id: string; label: string; startDate: string };
    currentSemester: { id: string; number: number; startDate: string; endDate: string } | null;
    login: { email: string; isActive: boolean } | null;
    createdAt: string;
  };
  semesters: {
    number: number;
    modules: ProfileModuleRow[];
    summary: { modules: number; passed: number; failed: number; resit: number; pending: number };
  }[];
  resits: ProfileModuleRow[];
  stats: { modulesTaken: number; passed: number; failed: number; resits: number; pending: number };
}

// ---------- mark sheets ----------

export interface Component {
  id: string;
  name: string;
  weight: number;
  maxMark: number;
  componentPassMark: number | null;
  sortOrder: number;
}

export interface MarkSheetListItem {
  id: string;
  status: MarkSheetStatus;
  version: number;
  lockVersion: number;
  submittedAt: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  scheduledPublishAt: string | null;
  updatedAt: string;
  moduleOffering: {
    id: string;
    module: { code: string; title: string };
    semester: { number: number; intake: { label: string; programme: { code: string } } };
    lecturer: { name: string } | null;
    _count: { enrollments: number };
  };
  submittedBy: { name: string } | null;
  approvedBy: { name: string } | null;
  _count: { marks: number; results: number };
}

export interface GradeResult {
  overallMark: number;
  uncappedMark: number;
  grade: string;
  outcome: Outcome;
  reasons: string[];
}

export interface SheetRow {
  enrollmentId: string;
  student: { id: string; studentId: string; name: string };
  attempt: number;
  isResit: boolean;
  marks: Record<string, { rawMark: number | null; isAbsent: boolean; note: string | null }>;
  complete: boolean;
  computed: GradeResult | null;
  stored: { overallMark: number; grade: string; outcome: Outcome; computedAt: string } | null;
}

export interface Flag {
  level: 'info' | 'warning';
  scope: 'sheet' | 'component' | 'row';
  componentId?: string;
  enrollmentId?: string;
  message: string;
}

export interface ComponentStats {
  componentId: string;
  name: string;
  n: number;
  missing: number;
  absent: number;
  mean: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
  actor: { name: string; role: Role } | null;
}

export type TransitionAction = 'submit' | 'start_review' | 'approve' | 'reject' | 'publish' | 'request_correction';

export interface MarkSheetDetail {
  sheet: {
    id: string;
    status: MarkSheetStatus;
    version: number;
    lockVersion: number;
    submittedAt: string | null;
    approvedAt: string | null;
    publishedAt: string | null;
    scheduledPublishAt: string | null;
    rejectReason: string | null;
    gradingScheme: { name: string; passMark: number; resitCap: number } | null;
    submittedBy: { name: string } | null;
    approvedBy: { name: string } | null;
    publishedBy: { name: string } | null;
  };
  offering: {
    id: string;
    module: { id: string; code: string; title: string; credits: number; moduleLeaderId: string | null };
    semester: { id: string; number: number; intake: { id: string; label: string } };
    lecturer: { id: string; name: string } | null;
    components: Component[];
  };
  rows: SheetRow[];
  validation: { errors: string[]; warnings: string[] };
  flags: Flag[];
  stats: ComponentStats[];
  actions: TransitionAction[];
  editable: boolean;
  audit: AuditEntry[];
  importBatches: { id: string; fileName: string; status: string; rowsTotal: number; rowsValid: number; rowsInvalid: number; createdAt: string }[];
}

export interface ImportRow {
  rowNumber: number;
  studentId: string;
  name: string | null;
  enrollmentId: string | null;
  level: 'ok' | 'warning' | 'error';
  messages: string[];
  marks: { componentId: string; rawMark: number | null; isAbsent: boolean }[];
}

export interface ImportPreview {
  batchId: string;
  fileName: string;
  studentIdColumn: string | null;
  columnMap: Record<string, string>;
  missingColumns: string[];
  rows: ImportRow[];
  summary: { total: number; ok: number; warnings: number; errors: number };
}

// ---------- exams & seating ----------

export interface Venue {
  id: string;
  name: string;
  building: string;
  rows: number;
  cols: number;
  disabledSeats: { row: number; col: number }[];
  adjacencyMode: 'ROW' | 'ROW_AND_COLUMN';
  isClassroom: boolean;
  layout?: unknown;
  capacity: number;
  _count?: { examSessions: number };
}

export interface ExamOffering {
  id: string;
  module: { code: string; title: string };
  semester: { number: number; intake: { label: string; programme: { code: string } } };
  _count: { enrollments: number };
}

export interface ExamSessionListItem {
  id: string;
  title: string;
  date: string;
  startTime: string;
  durationMin: number;
  seed: number;
  offerings: ExamOffering[];
  venues: Omit<Venue, 'capacity' | '_count'>[];
  capacity: number;
  candidates: number;
  seated: number;
}

export interface SeatAllocationView {
  venueId: string;
  row: number;
  col: number;
  seatLabel: string;
  offeringId: string;
  moduleCode: string;
  student: { id: string; studentId: string; name: string; specialNeedsSeating: boolean };
  runId: string;
}

export interface ExamDetail {
  session: {
    id: string;
    title: string;
    kind?: 'FINAL' | 'CLASS_TEST' | 'RESIT';
    seatingMode?: 'MIXED' | 'BY_ID';
    date: string;
    startTime: string;
    durationMin: number;
    seed: number;
    offerings: ExamOffering[];
    sections?: { id: string; name: string }[];
    invigilators?: { user: { id: string; name: string }; venue: { id: string; name: string } }[];
    generatedBy?: string | null;
  };
  venues: (Omit<Venue, '_count'> & { used: number; violations: number })[];
  allocations: SeatAllocationView[];
  candidates: number;
  unseated: { studentId: string; label: string; name: string; moduleCode: string; specialNeeds: boolean }[];
  violations: { venueId: string; a: string; b: string; seatA: string; seatB: string }[];
  generated: boolean;
  runId: string | null;
}

export interface MyExamSeat {
  id: string;
  title: string;
  date: string;
  startTime: string;
  durationMin: number;
  modules: { code: string; title: string }[];
  seat: { venue: { id: string; name: string; building: string; rows: number; cols: number; disabledSeats: { row: number; col: number }[] }; row: number; col: number; seatLabel: string } | null;
}


// ---------- users, permissions, class lists, room layouts ----------

export interface CapabilityDef {
  key: string;
  label: string;
  group: string;
  roles: Role[];
}

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  lockedUntil: string | null;
  createdAt: string;
  student: { id: string; studentId: string; section: { name: string } | null; intake: { label: string; programme: { code: string } } } | null;
  workload: { modulesLed: number; offerings: number; classes: number; invigilations: number };
  overrides: { grant: string[]; revoke: string[] };
  actions: string[];
  temporaryPassword?: string;
}

export interface ClassListRow {
  enrollmentId: string;
  studentId: string;
  name: string;
  email: string | null;
  section: string | null;
  status: string;
  standing: string;
  specialNeedsSeating: boolean;
  attempt: number;
  isResit: boolean;
  studentRecordId: string;
  result: { grade: string; outcome: string; overallMark: number; published: boolean } | null;
}

export interface ClassList {
  offering: {
    id: string;
    module: { code: string; title: string; credits: number; moduleLeader: { name: string } | null };
    semester: { number: number; term: string; intake: { label: string; programme: { code: string; name: string } } };
    lecturer: { id: string; name: string; email: string | null } | null;
    components: { id: string; name: string; weight: number; maxMark: number }[];
  };
  total: number;
  resits: number;
  specialNeeds: number;
  sections: { section: string; students: ClassListRow[]; classes: { dayOfWeek: number; startTime: string; endTime: string; venue: string | null; teacher: string }[] }[];
  students: ClassListRow[];
}

export type CellKind = 'DESK' | 'AISLE' | 'OFF' | 'TEACHER';
export interface RoomLayout {
  cells?: Record<string, CellKind>;
  labelMode?: 'ROW_LETTER' | 'NUMERIC';
  note?: string;
}

export interface SlotCandidate {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  venueId: string;
  venueName: string;
  keepsRoom: boolean;
  createsGap: boolean;
}

export interface ReasonCheck {
  verdict: 'OK' | 'WEAK' | 'GIBBERISH';
  score: number;
  notes: string[];
  category?: string;
}

export type ClassKind = 'LECTURE' | 'TUTORIAL' | 'WORKSHOP';

export interface ModuleOverview {
  offering: {
    id: string;
    module: { id: string; code: string; title: string; credits: number };
    semester: { number: number; term: string; startDate: string; endDate: string };
    intake: string;
    programme: { code: string; name: string };
    teachers: { id: string; name: string; email: string }[];
    moduleLeader: string | null;
    markSheets: { id: string; version: number; status: string; publishedAt: string | null }[];
  };
  stats: {
    enrolled: number;
    sections: number;
    resitEnrolments: number;
    withResult: number;
    awaiting: number;
    passed: number;
    failed: number;
    resits: number;
    deferred: number;
    passRate: number | null;
    average: number | null;
    highest: number | null;
    lowest: number | null;
    published: number;
  };
  grades: { grade: string; students: number }[];
  bands: { band: string; from: number; students: number }[];
  bySection: { section: string; students: number; passed: number; failed: number; resits: number; average: number | null }[];
  components: { id: string; name: string; weight: number; maxMark: number; averagePercent: number | null; marked: number; absent: number }[];
  classes: { id: string; kind: ClassKind; kindLabel: string; section: string; day: string; dayOfWeek: number; startTime: string; endTime: string; venue: string | null; teacher: string }[];
  students: {
    studentRecordId: string;
    studentId: string;
    name: string;
    section: string | null;
    attempt: number;
    isResit: boolean;
    overallMark: number | null;
    grade: string | null;
    outcome: string | null;
    published: boolean;
  }[];
}

export interface CameraRequest {
  id: string;
  reference: string;
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
  status: 'PENDING' | 'SENT' | 'APPROVED' | 'DENIED';
  itSupportEmail: string;
  notifiedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  venue: { id: string; name: string; building: string };
  requestedBy: { id: string; name: string; email: string };
  examSession: { id: string; title: string; kind: string } | null;
  slot: { id: string; startTime: string; endTime: string; section: { name: string }; moduleOffering: { module: { code: string; title: string } } } | null;
}

export interface CameraRequestList {
  itSupportEmail: string;
  mailerConfigured: boolean;
  items: CameraRequest[];
}

export interface EmailOutbox {
  configured: boolean;
  itSupportEmail: string;
  items: { id: string; to: string; subject: string; body: string; status: 'QUEUED' | 'SENT' | 'FAILED'; error: string | null; sentAt: string | null; createdAt: string }[];
}

export interface AtRisk {
  offering: { id: string; module: { code: string; title: string }; teachers: { id: string; name: string }[] };
  enrolled: number;
  students: { id: string; studentId: string; name: string; section: string | null; why: string }[];
}

export interface ClassAlertRow {
  id: string;
  date: string;
  kind: string;
  note: string | null;
  status: 'OPEN' | 'COVER_ASSIGNED' | 'RESOLVED' | 'DISMISSED';
  createdAt: string;
  raisedBy: { name: string; role: string };
  cover: { name: string } | null;
  slot: {
    startTime: string;
    endTime: string;
    section: { name: string };
    teacher: { name: string };
    venue: { name: string } | null;
    moduleOffering: { module: { code: string; title: string } };
  };
}
