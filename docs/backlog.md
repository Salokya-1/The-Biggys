# Backlog — cut or deferred, with the reason

Everything here was a conscious scope decision inside the 24-hour window. The order is our suggested priority for the 60-day R&D evaluation.

| Item | Why it was cut / deferred |
|---|---|
| **Excel migration wizard (column mapping UI)** | The template + tolerant header matching covers RTE's current sheets; a mapping UI is polish once real files are seen |
| **Progression engine with configurable rules** | Standing is derived from a simple, labelled rule (any fail / two resits → review); real progression regulations need the mentor's rules first |
| **Historical trend charts across intakes/years** | Pass-rate vs previous offering exists; multi-year lines need more history than two intakes provide |
| **Natural-language record search (LLM)** | Could not be made safe (role-scoped, read-only, injection-proof) in under two hours; the directory filters answer the same questions deterministically |
| **Bulk approve with checklist / semester-wide scheduled publication** | Scheduled publication exists per sheet; a "publish all approved at 10:00" button is a small next step |
| **Push notifications (FCM)** | In-app notifications + pull-to-refresh cover the demo; FCM needs a Firebase project and signing config |
| **Offering PATCH (change lecturer/semester) and student login reset from the UI** | API and seed cover assignment; admin UI for staffing is routine CRUD |
| **httpOnly cookie sessions + CSRF** | Cross-origin (Vercel ↔ Antideploy) made bearer tokens the pragmatic choice; revisit when the API sits under the web domain |
| **MFA for admins** | Out of scope for a prototype; lockout + rotation in place |
| **Transcript PDF per student** | Mark-sheet XLSX export and seating PDFs prove the export path; transcripts are a template job |
| **Invigilator assignment, timetabling, attendance** | Explicitly other problem statements (PS1, PS3) |
| **Multi-tenancy, i18n, LMS/Moodle sync, payments** | Not in the brief; would dilute the core workflow |
| **OpenAPI at `/docs`** | `docs/api.md` is hand-written; generating it from Zod schemas is a day's work |
| **Backup/restore script** | Neon point-in-time restore + `npm run seed`; a `pg_dump` script belongs in ops hardening |
