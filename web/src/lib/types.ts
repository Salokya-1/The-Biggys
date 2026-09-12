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
