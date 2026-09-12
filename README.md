# The Biggys — RTE Integrated Management System

**Islington Hackathon 2026 · Problem Statement 2: "Smarter Systems, Stronger Records"**

A web platform plus a companion Android app that turns the RTE (Routine, Timetable & Examination)
Department's Excel-based result processing into a validated, approval-gated, auditable pipeline;
generates conflict-free exam seating; and gives leadership a live operations dashboard — with
students seeing published results and seat allocations on their phones.

> Build status: scaffolding in progress (hack window opened Sat 12 Sep 2026 11:00 NPT).

## The problem

RTE runs student records, result processing, faculty workload and exam operations out of isolated
Excel spreadsheets and manual workflows. Records drift out of sync, result processing is slow and
error-prone, and leadership has no real-time overview.

## Hero workflow (what the demo shows)

1. RTE staff uploads a marks spreadsheet → validation preview flags bad rows → fixes → submits.
2. Module leader reviews (with statistical flags) → approves. RTE admin publishes (now or scheduled).
3. Student opens the Android app → notification → sees the result. Dashboard tiles update.
4. Admin generates seating for an exam → colour-coded room grid → student looks up their seat →
   printable seating sheet + door list.

## Repository layout

```
backend/   API, database schema, migrations, seed, tests   (Node 20 · TypeScript · Fastify · Prisma · PostgreSQL)
web/       staff/admin web app, responsive                  (Next.js · TypeScript · Tailwind)
mobile/    companion Android app                            (Flutter)
docs/      architecture, ERD, API, business canvas, demo script, red-team notes, backlog
```

## Local setup

_Coming with the first backend commits._

## Deployed URLs

_Coming once the API and web app are live._

## Demo accounts

_Coming with the seed data._

## Running tests

_Coming with the first test suite._

## AI Tools Disclosure

In line with the Islington Hackathon 2026 Code of Conduct (§2, AI Disclosure), we declare that the
following AI tools were used during the 24-hour build window:

- **Claude (Anthropic), via Claude Code** — scaffolding, boilerplate generation, debugging assistance,
  test generation and documentation drafting, working under the direction of team members.

All scoping, architecture and product decisions were made by the team. All functional code and logic
was written during the event window; nothing was pre-built.

## Team

- Salokya Ghimire — [@Salokya-1](https://github.com/Salokya-1)

## Licence

MIT — see `LICENSE` (to be added).
