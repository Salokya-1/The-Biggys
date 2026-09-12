# KramIQ — RTE Integrated Management System

<img src="web/public/brand/kramiq.png" alt="KramIQ by The Biggys" width="260">

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
| **Auth & RBAC** | Bcrypt, 15-min JWT + rotating refresh tokens with reuse detection, login rate limit, lockout; deny-by-default server-side capability matrix (Admin / Module leader / Lecturer / Student) with per-user grant/revoke overrides and scope checks; unit-tested |
| **Student record** | Programmes → intakes → semesters; modules and offerings with weighted assessment components; enrolments with attempts/resits; searchable directory (ID/name/email, programme, intake, semester, status, standing; server-side pagination); full academic profile per student |
| **Result pipeline** | Marks grid with live grade preview · CSV/XLSX import with preview/commit and downloadable template · pure grade calculator (weights, resit cap, component minimums, deferral) · state machine DRAFT → SUBMITTED → UNDER REVIEW → APPROVED → PUBLISHED with mandatory reasons for reject/correction · scheduled/embargoed publication · versioned corrections with student notice · optimistic locking (409 on conflict) · explainable statistical flags · Excel export · append-only audit log |
| **Exam seating** | Venues with row×col grids, unavailable seats, left/right or left/right+front/back separation · deterministic engine (capacity, adjacency, special-needs priority, multi-venue partition, unseated list, violation report) · grid visualisation · seat lookup by ID · PDF seating sheets + door lists · student seat view |
| **Academic calendar & timetable** | Autumn/Spring semesters of 14 weeks (12 teaching + 2 exam), summer break · eight groups of 20 students per intake, each module staffed by two teachers who split the groups between them · one constant weekly routine per section generated for all sections with teacher, section and room clash detection (a teacher can teach every section of a module) · calendar UI with week overview and day view · RTE sees everything, teachers their classes, students only their own section · one-day changes (cover teacher, room move, cancel, reschedule) with clash checks and notifications · absence requests from teachers and students, section-change requests, approvals with cover assignment |
| **Exam scheduling** | Whole-semester exam timetable generated inside the exam window — automatically three weeks before it starts, or on demand — one exam per module, one exam per day per cohort, venues packed largest-first, an invigilator per venue who does not teach the module · teachers create their own class tests with sections and invigilators; invigilator clashes with classes or other exams are rejected · seating either anti-cheat mixed or **by section in ascending student-ID order** |
| **Fees & admit cards** | Amounts are withheld from RTE and shown as `xxxxxx`: the admit-card gate only needs paid or unpaid, so the sums sit behind a finance-only capability an admin grants per person · semester fee invoices per student · demo payment gateway (eSewa / Khalti / bank) · admit card issued only when the fee is paid, as a PDF listing the student's exams, venues and seats |
| **Summer retakes** | Students with outstanding resits are enrolled on a summer semester per intake with retake offerings and resit exams scheduled automatically |
| **AI assistant** | OpenRouter model (free NVIDIA Nemotron with fallbacks) with 54 function tools that call this API **as the signed-in user** — it can search, create and update students, enrol, save marks, move mark sheets, generate seating, timetables and exam schedules, handle requests, fees and admit cards; RBAC, validation, audit and notifications apply unchanged; irreversible actions are confirmed first |
| **Users & permissions** | RTE admin creates and edits any account (student, lecturer, module leader, admin), resets passwords and deactivates people · 30 named capabilities grouped by area, each one switchable **per user** on top of their role, with a live count of what differs from the role default · the server is the authority: `can(role, action, overrides)` decides every route and the same list drives the navigation · guards against removing the last admin or demoting yourself |
| **Timetable editing** | Drag a class to another period or day; the drop is checked for teacher, section and room clashes before anything is written · a clash returns the exact conflicts *and* ranked free alternatives, each one clickable to apply · third-year (final-year) days run 07:00–10:00 so the cohort is free for internships, and no year gets a gap longer than two hours — both rules are enforced on generation, on drag and on manual edits, and a health banner lists any breach |
| **Class lists** | Every module offering has a printable class list grouped by section: student ID, name, weekly classes with room and teacher, latest result and attempt — on screen, as CSV, or straight to the printer |
| **Room layouts** | Draw a room instead of describing it: paint desks, aisles, off-limits cells and the teacher's position on a grid, and the seat count and unavailable-seat list follow the drawing, so the seating engine plans against the room as it really is |
| **Leave-reason quality** | A written reason is scored before it is accepted — vowel balance, consonant runs, repeated characters, keyboard-row mashing, a dictionary check and six recognised categories. `hfiudewhfie` is rejected with an explanation, a thin reason is flagged for the approver, and the verdict is stored with the request. Runs offline; no key needed |
| **Real catalogue** | The seeded modules are Islington's actual London Met programmes — BSc (Hons) Computing, Computing with AI, Networking & IT Security, Multimedia Technologies, BA (Hons) Business Administration and Accounting & Finance — with the real module codes, titles and credits, balanced to 60 credits a semester |
| **Resource allocation** | The timetable is modelled the way Islington's own Autumn 2025 allocation sheet works: a **lecture** runs 90 minutes for the whole cohort (C1+C2+…C8) in a hall or lecture theatre, a **tutorial** an hour for one group in a seminar room, a **workshop** two hours for one group in a lab. Classes start on the half hour from 06:30. Rooms carry a type and sit in the real blocks — Kumari, Alumni, Nepal, Skill, London, A Level — and groups are named C1…C8, N1…N8, AI, M, B, AF. It exports as the same fourteen columns the department already uses, with a sheet per year and a teacher-workload sheet |
| **Module overview** | Per module: cohort size, pass rate, average, marks distribution in ten-point bands, grade split, section averages, component averages and the weekly classes — on screen as charts, and as a four-sheet Excel report (summary, students with every mark, distribution, classes) |
| **Camera access** | The RTE admin can ask IT support for a recorded view of a room for the length of one exam or class. The window comes from the exam itself, a written reason is required, duplicates for the same room and window are refused, and every request is emailed and kept on the record. Mail goes to an outbox first, so nothing is lost when SMTP is not configured |
| **Support classes** | The students on a module who failed, are resitting or are sitting under 45 are listed with the reason. One button lays on an extra class for exactly them, at the first hour the module's teacher and a suitable room are both free, and tells everyone |
| **Class alerts** | A student sitting in a class nobody has come to teach taps once. RTE is notified immediately, and where a teacher of that module is free the cover is assigned and told on the spot. Repeat reports of the same class collapse into one, and RTE can reassign or close from its own screen |
| **Room chooser** | When an exam has more candidates than seats, the rooms that are genuinely free for that window are listed with the seats each one buys — nothing holding another exam or a class — with the smallest set that closes the gap offered in one click |
| **Dashboard** | Result-processing funnel with overdue items, publication status with missing marks, import error rate, exam readiness & venue utilisation, pass rate vs previous offering, resit volume, at-risk students, data-quality issues, faculty teaching load, live system-status widget |
| **Android app (Flutter)** | Login, Home, My results, My exam seats (mini grid), Notifications, Profile; staff approval queue with approve / return / publish; secure token storage; offline cache with "last synced"; cold-start handling; runtime API URL switch |
| **Data integrity** | Unique constraints, CHECK constraints, triggers: marks within component max, published marks immutable, results immutable, audit log append-only; soft deletes |
| **Ops** | `/health`, `/health/ready` (503 on DB failure), `/health/version`; CI on every push (Postgres service → migrate → seed → typecheck → 82 tests → build); docker-compose; idempotent seed; runbook |

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
| Web | https://biggys-web.onrender.com |
| API | https://biggys-api.onrender.com (`/health/ready`, `/health/version`) |
| APK | GitHub Release `v1.0.0-hackathon` — installs on any phone and talks to the deployed API out of the box |
| Status page | `{{STATUS_PAGE_URL}}` |

Both run on Render's free tier from `render.yaml`, so the first request after a quiet spell takes
about 50 seconds while the instance wakes. The demo data loads itself the first time the database
is empty; sign in with any account below.

## Demo accounts

All passwords: `Demo1234!` — seeded, fictional data.

| Role | Email | Sees |
|---|---|---|
| RTE admin | `admin@demo` | everything; publishes results; generates seating |
| Module leader | `leader@demo` | modules CS4001–CS4004; review queue (CS4004 is waiting) |
| Lecturer | `lecturer@demo` | CS4003 (empty DRAFT — import the CSV in `docs/`) and CS4004 |
| Student | `student1@demo` … `student5@demo` | own results, timetable, exam seats, fees (student1 = Dipesh Karki, fee unpaid for the admit-card demo) |
| Student (2026 intake) | `26010001@student.demo` | BSc Computing Sep 2026, group C1 — 160-student, 8-group cohort with a generated routine |

## Tests

```bash
cd backend && npm test        # 82 tests: grade calculator, state machine + capabilities, import validator, statistical flags, seating engine, timetable rules, exam scheduling, reason quality
cd web && npm run lint && npx tsc --noEmit
cd mobile && flutter analyze
```

CI runs migrate → seed → typecheck → 82 tests → build for the API and lint → build for the web on every push.

## Assumptions to confirm with RTE

- Grading scheme: pass mark 40, resit capped at 40, bands A ≥ 70 / B ≥ 60 / C ≥ 50 / D ≥ 40 — stored in `GradingScheme`, labelled "assumed".
- Standing: any FAIL or two outstanding resits → REVIEW; one → RESIT.
- Maximum three attempts per module.
- Adjacency rule: same-module students not left/right (and optionally front/back) when modules share a venue.
- Calendar: 12 teaching weeks then a 2-week exam window; exams Mon–Fri at 09:00 and 13:00; class periods 08:00–17:15 in 90-minute blocks; the exam schedule is generated 3 weeks before the window.
- Final year means semester 5 and above; those groups must finish by 10:00.
- A lecture is 90 minutes for the whole cohort, a tutorial 60 minutes for one group, a workshop 120 minutes for one group — the lengths on the live allocation sheet.
- Each year of study has its own days for each class kind, so the years never compete for the same rooms.
- Camera access is requested from IT support, never switched on by this system.
- No student group has a gap longer than 120 minutes between two classes on the same day.
- A leave reason must be readable prose; the checker rejects keyboard mashing and flags very thin reasons for a human to judge rather than refusing them.
- Fees: one invoice per student per semester (NPR 85,000 in the seed); the payment gateway is a stub.

## AI Tools Disclosure

In line with the Islington Hackathon 2026 Code of Conduct (§2, AI Disclosure), we declare that the following AI tools were used during the 24-hour build window:

- **Claude (Anthropic), via Claude Code** — scaffolding, boilerplate generation, debugging assistance, test generation and documentation drafting, working under the direction of team members.
- No AI service is required to run the product. The optional in-app assistant calls this same API with the signed-in user's own permissions; with no key configured the assistant is simply absent and everything else works unchanged.

All scoping, architecture and product decisions were made by the team. All functional code and logic was written during the event window; nothing was pre-built. No AI tool is a git author.

## Team

- Salokya Ghimire — [@Salokya-1](https://github.com/Salokya-1)

## Licence

MIT — see [LICENSE](LICENSE).
