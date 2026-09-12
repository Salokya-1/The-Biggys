# API reference

Base URL: `{{ANTIDEPLOY_APP_URL}}` (local: `http://localhost:8080`). All `/api/*` routes require `Authorization: Bearer <accessToken>`. Errors are JSON: `{ statusCode, error, message, details? }`.

Roles: `ADMIN` (RTE), `MODULE_LEADER`, `LECTURER`, `STUDENT`. Lecturers see only offerings they teach; module leaders only modules they lead or teach; students only their own record.

## Health

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness, no DB, always 200 |
| GET | `/health/ready` | `SELECT 1` with 2 s timeout → 200 `{status:"ok"}` or 503 `{status:"degraded"}` |
| GET | `/health/version` | `{ commit, builtAt }` |

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | 30/min per IP; lockout 15 min after 5 failures |
| POST | `/auth/refresh` | `{ refreshToken }` | rotates; reuse of an old token revokes all |
| POST | `/auth/logout` | `{ refreshToken }` | |
| GET | `/auth/me` | | current user |

## Academic structure (staff read · admin write)

| Method | Path |
|---|---|
| GET / POST | `/api/programmes` · PATCH `/api/programmes/:id` |
| POST | `/api/programmes/:id/intakes` · GET `/api/intakes?programmeId=` |
| POST | `/api/intakes/:id/semesters` · GET `/api/semesters?intakeId=` |
| GET / POST | `/api/modules` · PATCH `/api/modules/:id` |
| GET / POST | `/api/offerings` (`?semesterId&moduleId&programmeId&mine`) · GET `/api/offerings/:id` |
| PUT | `/api/offerings/:id/components` (weights must sum to 100; locked once marks exist) |
| POST | `/api/offerings/:id/enrollments` `{ studentIds[], isResit? }` |

## Students

| Method | Path | Notes |
|---|---|---|
| GET | `/api/students?q&programmeId&intakeId&semesterNumber&status&standing&page&pageSize` | server-side pagination |
| GET | `/api/students/me` | student's own profile (published results only) |
| GET | `/api/students/:id` | staff, or the student themselves |
| POST / PATCH / DELETE | `/api/students`, `/api/students/:id` | admin; delete is soft and needs `{ reason }` |
| GET | `/api/students/:id/seats` | staff |

## Result pipeline

| Method | Path | Notes |
|---|---|---|
| GET | `/api/marksheets?status&semesterId` | scoped to the caller |
| POST | `/api/offerings/:id/marksheets` | new sheet, or next version after a correction request |
| GET | `/api/marksheets/:id` | rows with live grades, validation, flags, stats, allowed actions, audit, imports |
| PUT | `/api/marksheets/:id/marks` | `{ lockVersion, marks[] }` — DRAFT only, 409 on stale lock |
| GET | `/api/marksheets/:id/template.csv` | one row per enrolled student |
| POST | `/api/marksheets/:id/import` | multipart `file` (csv/xlsx) → preview batch |
| POST | `/api/marksheets/:id/import/:batchId/commit` | `{ lockVersion }` — writes rows without errors |
| POST | `/api/marksheets/:id/import/:batchId/discard` | |
| POST | `/api/marksheets/:id/transition` | `{ action, lockVersion, reason?, scheduledPublishAt? }` — `submit · start_review · approve · reject · publish · request_correction` |
| GET | `/api/marksheets/:id/audit` | |
| GET | `/api/marksheets/:id/export.xlsx` | |

## Exams & seating

| Method | Path | Notes |
|---|---|---|
| GET / POST | `/api/venues` · PATCH `/api/venues/:id` | `{ name, building, rows, cols, disabledSeats[], adjacencyMode }` |
| GET / POST | `/api/exams` · PATCH `/api/exams/:id` | `{ title, date, startTime, durationMin, offeringIds[], venueIds[], seed? }` |
| GET | `/api/exams/:id` | allocations, per-venue usage, violations, unseated |
| POST | `/api/exams/:id/seating/generate` | admin; `{ seed? }`; replaces allocations, notifies students |
| DELETE | `/api/exams/:id/seating` | |
| GET | `/api/exams/:id/lookup?studentId=` | |
| GET | `/api/exams/:id/seating.pdf` | per-venue seating sheet + door list |
| GET | `/api/exams/me` | student's upcoming sessions and seats |

## Dashboard & notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/api/dashboard` | admin, module leader |
| GET | `/api/notifications` | caller's notifications + unread count |
| POST | `/api/notifications/read` | `{ ids? }` — all when omitted |

### RBAC in one curl

```bash
# student token against an admin route → 403, enforced by the server
curl -s -X POST $API/auth/login -H 'content-type: application/json' -d '{"email":"student1@demo","password":"Demo1234!"}' | jq -r .accessToken > /tmp/t
curl -s -o /dev/null -w '%{http_code}\n' $API/api/students -H "authorization: Bearer $(cat /tmp/t)"   # 403
```

## Timetable & calendar

| Method | Path | Notes |
|---|---|---|
| GET | `/api/timetable/semesters` | semesters with sections, exam windows and slot counts (students: own intake) |
| POST | `/api/timetable/generate` | admin · `{ semesterId, sessionsPerWeek?, replace? }` — weekly routine for every section, clash-free against concurrent semesters |
| GET | `/api/timetable/slots?semesterId&sectionId&teacherId&venueId` | weekly slots (students: own section only) |
| POST / PATCH / DELETE | `/api/timetable/slots`, `/api/timetable/slots/:id` | admin · 409 with `details.clashes` on teacher/section/room overlap |
| POST | `/api/timetable/slots/:id/exceptions` | admin · `{ date, kind: CANCELLED|TEACHER_CHANGE|ROOM_CHANGE|RESCHEDULED, teacherId?, venueId?, startTime?, endTime?, reason }` — cover/room clashes rejected; everyone affected notified |
| GET | `/api/timetable/day?date&sectionId&teacherId&venueId` | concrete day: classes with exceptions applied + exams (student seat included) |
| GET | `/api/timetable/week?semesterId&week` or `?date` | seven days; scoped per role |
| GET | `/api/timetable/me` | this week for the signed-in student (section) or teacher |
| GET | `/api/timetable/teachers`, `/api/timetable/sections?intakeId` | pickers |

## Requests

| Method | Path | Notes |
|---|---|---|
| POST | `/api/requests` | `{ kind: TEACHER_ABSENCE|STUDENT_ABSENCE|SECTION_SWAP, slotId?, date, targetSectionId?, reason }` |
| GET | `/api/requests?status` | own for students/lecturers; all for admin/leaders |
| POST | `/api/requests/:id/decide` | admin/leader · `{ decision, note?, coverTeacherId? }` — approval applies the change (cover or cancellation, section move) |

## Exams (v2 additions)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/exams/schedule/generate` | admin · `{ semesterId, durationMin?, replace? }` — also runs automatically 21 days before each exam window |
| POST | `/api/exams` | now takes `kind`, `seatingMode` (MIXED / BY_ID), `sectionIds`, `invigilators[{venueId,userId}]`; lecturers may create CLASS_TEST for their modules; 409 `details.clashes` on invigilator clash |
| DELETE | `/api/exams/:id` | admin |
| GET | `/api/exams/invigilations/me` | staff |

## Fees & admit cards

| Method | Path | Notes |
|---|---|---|
| GET | `/api/fees?semesterId&status&q` · POST `/api/fees/generate` · PATCH `/api/fees/:id` | admin |
| GET | `/api/fees/me` · POST `/api/fees/:id/pay` `{ method }` | student (mock gateway) |
| POST | `/api/admit-cards/issue` `{ semesterId, studentId? }` | 409 while the fee is unpaid |
| GET | `/api/admit-cards/:id.pdf` · GET `/api/admit-cards?semesterId` | |

## Retakes & assistant

| Method | Path | Notes |
|---|---|---|
| GET | `/api/retakes?year` · POST `/api/retakes/generate` `{ year }` | admin · summer semester, offerings, resit enrolments and resit exams |
| GET | `/api/assistant/status` · POST `/api/assistant/chat` `{ messages[] }` | tools run through this API with the caller's token; returns `reply` and `actions` |
