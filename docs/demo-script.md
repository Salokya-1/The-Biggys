# Demo script (4 minutes) + judge Q&A

Accounts (password `Demo1234!`): `admin@demo` (RTE admin), `leader@demo` (module leader, leads CS4001–CS4004), `lecturer@demo` (teaches CS4003 & CS4004 for the Sep 2025 intake), `student1@demo` (Dipesh Karki, 25010001).
Have `docs/sample-marks-CS4003.csv` ready. Phone signed in as `student1@demo` on the Exams tab.

| Time | Who | Do | Say |
|---|---|---|---|
| 0:00 | — | Landing page → dashboard tiles | "RTE runs results and exams from spreadsheets. This is one source of truth: 117 students, 5 sheets in the pipeline, 3 overdue, 11 at risk, 4 data-quality issues it found on its own." |
| 0:30 | lecturer@demo | Mark sheets → **CS4003** (DRAFT, 0/40 marks) → Import → upload the CSV | "Same spreadsheet the lecturer already keeps. Row 2 has 105 — blocked. Row 3/4 duplicate ID — both blocked. Blank cell — warning, not written. Nothing touches the database until commit." |
| 1:00 | lecturer@demo | Commit → Marks tab → fix the two blocked rows in the grid → Review tab → **Submit for review** | "Weighted grade, resit cap, component minimum — one tested function. Flags: this student is 30 points under their published average. Explainable, never blocking, never edits a mark." |
| 1:40 | leader@demo (phone or web) | Notifications → open CS4003 → Start review → Approve | "The leader gets notified, sees the outcome summary and the flags, approves. Every step is a row in the audit log with before/after and reason." |
| 2:10 | admin@demo | Open CS4003 → **Publish results** (mention scheduled publication) | "Only the RTE admin can publish, now or embargoed to 10:00 on results day. From this moment the marks are immutable — the database itself rejects updates." |
| 2:30 | student1@demo (phone) | Pull to refresh Results | "The student sees it on the phone. Result rows are filtered by published-and-released in the query, not in the app." |
| 2:50 | admin@demo | Exams → **Semester 2 Resit Exams** → Generate seating | "40 candidates, two modules, two rooms. Same module never side by side or front/back; special-needs students in the front row; seats deterministic for the seed." |
| 3:20 | student1@demo (phone) | Exams tab → seat + mini grid | "The student gets their seat. The invigilator gets this —" |
| 3:30 | admin@demo | Seating sheets + door lists (PDF) → open | "— per-venue sheet and door list with signature column. What RTE prints today, generated in one click." |
| 3:50 | — | Dashboard → Data quality | "And it tells leadership what the spreadsheets were hiding: a published module with a missing result, students with no semester, an intake on the wrong programme." |

## Extended demo (v2, +3 minutes)

| Who | Do | Say |
|---|---|---|
| admin@demo | Timetable → BSc Computing Sep 2026 → week view | "240 students in 10 sections, two modules, one teacher each — 40 clash-free classes a week, generated in under a second, repeated for 12 weeks." |
| admin@demo | Click a day → Change teacher on a class → pick someone busy | "Rejected with the exact clash. Pick a free colleague — applied, everyone in the section notified." |
| lecturer@demo | Timetable → day → Report absence | "The request lands in RTE's inbox." |
| admin@demo | Requests → Approve with cover teacher | "Cover is checked for clashes, the class is updated, students told." |
| admin@demo | Exams → Generate semester schedule | "Two-week window, one exam per day per cohort, halls packed, invigilators who don't teach the module. This also runs by itself three weeks before the window." |
| lecturer@demo | Exams → New class test, sections A+B, seating by ID | "Teachers set their own tests; seating follows student IDs in ascending order per room." |
| student1@demo | Fees → Pay → Issue admit card → PDF | "No fee, no admit card — the gate is in the API." |
| admin@demo | Retakes → Generate summer retakes | "Everyone with an outstanding resit gets a summer offering and a resit exam." |
| any | Assistant (Ctrl+K): "Cancel section A's Programming class tomorrow, room repairs" | "The model acts through the same API with my permissions; the change shows in the audit log." |

## Judge Q&A — answer by showing

1. **Can a lecturer change a published mark?** No. Open the published sheet: grid read-only, no submit action. Then `curl -X PUT …/marks` → 409 "Marks can only be edited while the sheet is DRAFT". Even a raw `UPDATE "Mark"` fails: trigger `mark_published_immutable`. Corrections = *Request correction* (reason) → new version → students notified "result updated".
2. **CSV with a duplicate student ID or a mark of 105?** Show the preview: both rows red with the plain-English message; commit button says "Commit N valid rows"; the invalid ones are never written.
3. **RBAC in the UI or the server?** Server. `docs/api.md` has the one-line curl: student token → `GET /api/students` → 403. Lecturer token → `GET /api/marksheets/:id` of another module → 403 "You do not teach this module offering".
4. **Two people edit the same sheet?** Optimistic lock: the second save gets 409 "changed by someone else", the UI reloads and keeps the local edits highlighted. Every save bumps `lockVersion`.
5. **Same-module students sitting together?** Colour-coded grid; `seating.test.ts` covers unequal cohorts, disabled seats, multi-venue, special needs. When a module is bigger than half a venue the clashes are counted and outlined in red — reported, not hidden.
6. **Capacity insufficient?** The engine returns an explicit unseated list; the page shows a red banner naming them. Test: "returns an explicit unseated list when capacity is insufficient".
7. **How does RTE migrate Excel?** Download the template per sheet (one row per enrolled student), fill, import; headers matched case/punctuation-insensitively; `ABS` for absent; re-import idempotent. Column mapping UI is in the backlog.
8. **Where's the AI?** Honest answer: explainable statistical flags (uniformity, identical marks, cohort mean shift, deviation from the student's own average). No LLM in the product. The handbook says innovation does not require AI; our innovation is the validated, auditable pipeline.
9. **Is the app a webview?** Native Flutter: secure-storage tokens, offline cache with "last synced", Riverpod, custom-painted seat grid, approval actions. Turn Wi-Fi off and reopen it.
10. **Life after the hackathon?** `docker compose up`, `npm run db:reset`, CI on every push (migrate, seed, typecheck, 49 tests, build), health endpoints, `docs/ops.md` runbook, Prisma migrations with DB-level rules. Grading scheme and standing rule are configurable and labelled as assumptions.

## Backup plan

- Wi-Fi/cloud down: run `npm run dev` in `backend/` and `web/` on the laptop (local Postgres, `npm run seed`), switch the phone's API URL in Settings to `http://<laptop-ip>:8080`.
- Judges broke the data: `npm run seed` (5 s, idempotent).
- Nothing works: play the recorded 3-minute video.
