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

## Users, roles and capabilities (admin)

```
GET    /api/admin/actions              catalogue of the 27 capabilities, grouped, with the role defaults
GET    /api/admin/users?q&role&active  accounts with their effective capability list
POST   /api/admin/users                create an account (role, name, email, password, optional student link)
PATCH  /api/admin/users/:id            rename, change role, activate/deactivate
POST   /api/admin/users/:id/permissions  {grant:[], revoke:[]} — stored only where it differs from the role default
POST   /api/admin/users/:id/reset-password
DELETE /api/admin/users/:id            soft delete
```

Every route is guarded by a capability, not a role name: `allow('users.manage')`. Overrides are merged in
`can(role, action, {grant, revoke})` — revoke wins over grant, grant wins over the role default — and cached for
10 seconds, so a change shows up in `/auth/me` almost immediately. The API refuses to remove the last active admin,
to demote the caller, or to grant a capability that does not exist.

```bash
# give a lecturer the right to publish, then take it away
curl -X POST .../api/admin/users/$ID/permissions -H "authorization: Bearer $ADMIN" \
     -H 'content-type: application/json' -d '{"grant":["marksheet.publish"]}'
```

## Timetable editing

```
GET  /api/timetable/periods?semesterId       the period grid for that group (final-year groups get the early grid)
GET  /api/timetable/health?semesterId        {dayEndsBy, slots, gaps[], lateFinalYear[], clashes}
GET  /api/timetable/slots/:id/alternatives   ranked free periods for that class
PATCH /api/timetable/slots/:id               move a class (dayOfWeek, startTime, endTime, venueId)
```

A move that collides answers **409** with the machine-readable detail the UI needs:

```json
{ "message": "That slot is taken", "clashes": [ { "kind": "VENUE", "label": "LB-201 has CS4001 section B" } ],
  "kinds": ["VENUE"],
  "alternatives": [ { "dayOfWeek": 1, "startTime": "08:00", "endTime": "09:30", "venueId": "…", "label": "Mon 08:00–09:30 LB-201" } ] }
```

Two curriculum rules are enforced on the same path as clashes, so generation, drag-and-drop and manual edits cannot
disagree: a final-year group (semester ≥ 5) must finish by **10:00**, and no group may be left with a gap longer than
**120 minutes** between classes on a day.

## Class lists

```
GET /api/offerings/:id/class-list       students grouped by section, with weekly classes and the latest result
GET /api/offerings/:id/class-list.csv   the same, as a download
```

## Room layouts

`POST /api/venues` and `PATCH /api/venues/:id` accept `isClassroom` and a `layout`:

```json
{ "layout": { "cells": { "0:0": "DESK", "0:1": "AISLE", "3:4": "OFF", "0:5": "TEACHER" },
              "labelMode": "ROW_COL", "note": "back two rows removed for the projector" } }
```

`OFF` cells are mirrored into `disabledSeats`, so capacity and the seating engine always match the drawing.

## Leave-reason quality

```
POST /api/requests/check-reason   {"text":"…"} → {verdict, score, notes[], category, checkedBy}
```

`verdict` is `OK`, `WEAK` or `GIBBERISH`. Creating a request with a `GIBBERISH` reason is refused with **400** and the
full report in `details.reasonCheck`; `WEAK` is accepted but stored and shown to whoever decides the request.

## Resource allocation

The department keeps its timetable as one row per session. These endpoints produce exactly that,
so a generated routine can be checked against — or dropped into — the sheet already in use.

```
GET /api/timetable/allocation?semesterId        JSON rows + per-lecturer workload + totals
GET /api/timetable/allocation.xlsx?semesterId   Module view, a sheet per course-year, Teacher Workload
GET /api/timetable/allocation.csv?semesterId    the same rows, for pasting into the live sheet
```

Columns, in order: `Day · Time Start · Time End · Hours · Class Type · Year · Course ·
Specialization · Module Code · Module Title · Lecturer · Group · Block · Room`. Times are written
the sheet's way (`630`, `1330`), module codes carry the `NI` suffix, and a lecture lists every
group in the room (`C1+C2+C3+C4+C5+C6+C7+C8`).

`GET /api/timetable/periods?semesterId` returns the half-hour ladder a class can start on, the
day's end time, and the length and permitted room types of each class kind.

## Module overview and report

```
GET /api/offerings/:id/overview      cohort, pass rate, bands, grades, sections, components, classes
GET /api/offerings/:id/report.xlsx   Summary · Students (every mark) · Distribution · Classes
```

## Camera access (admin only)

```
GET  /api/camera-requests                 requests + the IT support address + whether SMTP is set
POST /api/camera-requests                 {examSessionId | slotId+date | venueId+date+times, reason}
POST /api/camera-requests/:id/decide      {decision: APPROVED | DENIED, note?}
GET  /api/emails                          the outbox: what was sent, to whom, and whether it left
```

Naming an exam takes the room and the window from that exam, so access can never be asked for
longer than the sitting. A second live request for the same room and overlapping window is
refused with **409**. Creating one emails IT support and writes an audit row; without `SMTP_URL`
the message is stored and marked queued rather than silently dropped.
