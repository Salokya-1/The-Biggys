export type Role = 'ADMIN' | 'MODULE_LEADER' | 'LECTURER' | 'STUDENT';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  studentId: string | null;
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
