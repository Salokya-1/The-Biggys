# The Biggys — RTE Integrated Management System

**Islington Hackathon 2026 · Problem Statement 2: "Smarter Systems, Stronger Records"**

A web platform plus a companion Android app that turns the RTE (Routine, Timetable & Examination) Department's Excel-based result processing into a **validated, approval-gated, auditable pipeline**; generates **conflict-free exam seating** with printable sheets and door lists; and gives leadership a **live operations dashboard** — with students seeing published results and seat allocations on their phones.

> Built from an empty repository between Sat 12 Sep 2026 11:00 and Sun 13 Sep 2026 11:00 NPT. Every commit is inside the window.

## The problem

RTE keeps student records, marks, workloads and exam operations in isolated spreadsheets and manual workflows. Records drift out of sync, result processing is slow and error-prone, and nobody has a real-time view. The brief's final design principle: *do not build a passive record store — actively improve at least one process.* We improved three: result processing, exam seating, and leadership visibility.

## Hero workflow (4 minutes, see `docs/demo-script.md`)

1. **Lecturer** uploads the marks spreadsheet → row-level validation preview (105/100 blocked, duplicate IDs blocked, blanks flagged) → commits valid rows → fixes the rest in the grid → live grades → **submits**.
2. **Module leader** is notified, reviews outcome summary + explainable statistical flags → **approves**.
3. **RTE admin** **publishes** (now or scheduled). Marks become immutable — enforced by a database trigger, not just the UI. Every step is in the audit log with before/after and reason.
4. **Student** opens the **Android app** → notification → result. Dashboard tiles update.
5. **Admin** generates seating for an exam → colour-coded room grids (same module never adjacent, special-needs in the front row) → student sees their seat and a mini room map on the phone → printable per-venue seating sheet + door list PDF.

## What is built

| Area | Delivered |
|---|---|
| **Auth & RBAC** | Bcrypt, 15-min JWT + rotating refresh tokens with reuse detection, login rate limit, lockout; deny-by-default server-side permission matrix (Admin / Module leader / Lecturer / Student) with scope checks; unit-tested |
| **Student record** | Programmes → intakes → semesters; modules and offerings with weighted assessment components; enrolments with attempts/resits; searchable directory (ID/name/email, programme, intake, semester, status, standing; server-side pagination); full academic profile per student |
| **Result pipeline** | Marks grid with live grade preview · CSV/XLSX import with preview/commit and downloadable template · pure grade calculator (weights, resit cap, component minimums, deferral) · state machine DRAFT → SUBMITTED → UNDER REVIEW → APPROVED → PUBLISHED with mandatory reasons for reject/correction · scheduled/embargoed publication · versioned corrections with student notice · optimistic locking (409 on conflict) · explainable statistical flags · Excel export · append-only audit log |
| **Exam seating** | Venues with row×col grids, unavailable seats, left/right or left/right+front/back separation · deterministic engine (capacity, adjacency, special-needs priority, multi-venue partition, unseated list, violation report) · grid visualisation · seat lookup by ID · PDF seating sheets + door lists · student seat view |
| **Academic calendar & timetable** | Autumn/Spring semesters of 14 weeks (12 teaching + 2 exam), summer break · sections of 22–25 students per intake · one constant weekly routine per section generated for all sections with teacher, section and room clash detection (a teacher can teach every section of a module) · calendar UI with week overview and day view · RTE sees everything, teachers their classes, students only their own section · one-day changes (cover teacher, room move, cancel, reschedule) with clash checks and notifications · absence requests from teachers and students, section-change requests, approvals with cover assignment |
| **Exam scheduling** | Whole-semester exam timetable generated inside the exam window — automatically three weeks before it starts, or on demand — one exam per module, one exam per day per cohort, venues packed largest-first, an invigilator per venue who does not teach the module · teachers create their own class tests with sections and invigilators; invigilator clashes with classes or other exams are rejected · seating either anti-cheat mixed or **by section in ascending student-ID order** |
| **Fees & admit cards** | Semester fee invoices per student · demo payment gateway (eSewa / Khalti / bank) · admit card issued only when the fee is paid, as a PDF listing the student's exams, venues and seats |
| **Summer retakes** | Students with outstanding resits are enrolled on a summer semester per intake with retake offerings and resit exams scheduled automatically |
| **AI assistant** | OpenRouter model (free NVIDIA Nemotron with fallbacks) with 40+ function tools that call this API **as the signed-in user** — it can search, create and update students, enrol, save marks, move mark sheets, generate seating, timetables and exam schedules, handle requests, fees and admit cards; RBAC, validation, audit and notifications apply unchanged; irreversible actions are confirmed first |
| **Dashboard** | Result-processing funnel with overdue items, publication status with missing marks, import error rate, exam readiness & venue utilisation, pass rate vs previous offering, resit volume, at-risk students, data-quality issues, faculty teaching load, live system-status widget |
| **Android app (Flutter)** | Login, Home, My results, My exam seats (mini grid), Notifications, Profile; staff approval queue with approve / return / publish; secure token storage; offline cache with "last synced"; cold-start handling; runtime API URL switch |
| **Data integrity** | Unique constraints, CHECK constraints, triggers: marks within component max, published marks immutable, results immutable, audit log append-only; soft deletes |
| **Ops** | `/health`, `/health/ready` (503 on DB failure), `/health/version`; CI on every push (Postgres service → migrate → seed → typecheck → 49 tests → build); docker-compose; idempotent seed; runbook |

## Repository layout

```
backend/   Fastify 5 · TypeScript · Prisma 6 · PostgreSQL · Zod · vitest      (API, schema, migrations, seed, tests)
web/       Next.js 16 · TypeScript · Tailwind 4 · shadcn/ui · TanStack Query · recharts
mobile/    Flutter (Dart) · Riverpod · go_router · dio · flutter_secure_storage
docs/      architecture (ERD, flows, trade-offs), api, demo script, red team, backlog, business model canvas, ops runbook
.github/   CI workflow
```

## Local setup (≤ 10 commands)

```bash
git clone https://github.com/Salokya-1/The-Biggys.git && cd The-Biggys
docker compose up -d                       # Postgres on localhost:5432 (or any Postgres; see .env.example)
cd backend && cp .env.example .env && npm install
npx prisma migrate deploy && npm run seed  # schema + realistic demo data (idempotent, ~5 s)
npm run dev                                # API on http://localhost:8080
cd ../web && cp .env.example .env.local && npm install
npm run dev                                # web on http://localhost:3000
```

Assistant: put an OpenRouter key in `backend/.env` as `OPENROUTER_API_KEY` (free tier works; leave empty to disable).

Mobile: `cd mobile && flutter pub get && flutter run` (emulator reaches the API at `http://10.0.2.2:8080`; change it in the app's Settings for a physical phone).

## Deployed URLs

| | URL |
|---|---|
| Web | `{{VERCEL_URL}}` |
| API | `{{ANTIDEPLOY_APP_URL}}` (`/health/ready`, `/health/version`) |
| APK | GitHub Release `v1.0.0-hackathon` |
| Status page | `{{STATUS_PAGE_URL}}` |

## Demo accounts

All passwords: `Demo1234!` — seeded, fictional data.

| Role | Email | Sees |
|---|---|---|
| RTE admin | `admin@demo` | everything; publishes results; generates seating |
| Module leader | `leader@demo` | modules CS4001–CS4004; review queue (CS4004 is waiting) |
| Lecturer | `lecturer@demo` | CS4003 (empty DRAFT — import the CSV in `docs/`) and CS4004 |
| Student | `student1@demo` … `student5@demo` | own results, timetable, exam seats, fees (student1 = Dipesh Karki, fee unpaid for the admit-card demo) |
| Student (2026 intake) | `26010001@student.demo` | BSc Computing Sep 2026, section A — 240-student, 10-section cohort with a generated routine |

## Tests

```bash
cd backend && npm test        # grade calculator, state machine + permissions, import validator, statistical flags, seating engine
cd web && npm run lint && npx tsc --noEmit
cd mobile && flutter analyze
```

CI runs migrate → seed → typecheck → tests → build for the API and lint → build for the web on every push.

## Assumptions to confirm with RTE

- Grading scheme: pass mark 40, resit capped at 40, bands A ≥ 70 / B ≥ 60 / C ≥ 50 / D ≥ 40 — stored in `GradingScheme`, labelled "assumed".
- Standing: any FAIL or two outstanding resits → REVIEW; one → RESIT.
- Maximum three attempts per module.
- Adjacency rule: same-module students not left/right (and optionally front/back) when modules share a venue.
- Calendar: 12 teaching weeks then a 2-week exam window; exams Mon–Fri at 09:00 and 13:00; class periods 08:00–17:15 in 90-minute blocks; the exam schedule is generated 3 weeks before the window.
- Fees: one invoice per student per semester (NPR 85,000 in the seed); the payment gateway is a stub.

## AI Tools Disclosure

In line with the Islington Hackathon 2026 Code of Conduct (§2, AI Disclosure), we declare that the following AI tools were used during the 24-hour build window:

- **Claude (Anthropic), via Claude Code** — scaffolding, boilerplate generation, debugging assistance, test generation and documentation drafting, working under the direction of team members.

All scoping, architecture and product decisions were made by the team. All functional code and logic was written during the event window; nothing was pre-built. No AI tool is a git author.

## Team

- Salokya Ghimire — [@Salokya-1](https://github.com/Salokya-1)

## Licence

MIT — see [LICENSE](LICENSE).
