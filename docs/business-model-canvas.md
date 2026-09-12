# Business model canvas — RTE Integrated Management System

| Block | Content |
|---|---|
| **Customer segments** | Islington College RTE department (primary); module leaders and lecturers; students (result and seat lookup); campus leadership (analytics); later: other Nepali colleges running UK-partner programmes with the same semester/module/resit model |
| **Value propositions** | One authoritative student record instead of scattered spreadsheets · result processing that is validated, approval-gated and auditable · exam seating generated in seconds with printable sheets and door lists · leadership sees bottlenecks, risk and data quality in real time · students get results and seats on their phone the moment they are released |
| **Channels** | Web app for staff and leadership; Android app for students and reviewers; PDF/XLSX exports back into RTE's existing workflows; email/notification hooks (in-app today) |
| **Customer relationships** | Self-service with role-scoped views; RTE admin as internal owner; audit trail and correction workflow build trust with students and exam boards |
| **Revenue streams** | Internal deployment (cost avoidance: staff hours per result cycle, reprint/reseat errors, appeals from data errors). Optional: per-institution licence or hosted SaaS for partner colleges; implementation and migration services |
| **Key resources** | The data model and pipeline (open source, MIT); Postgres with DB-level integrity rules; the seating and grading engines; the R&D department's 60-day evaluation window |
| **Key activities** | Confirm grading/progression regulations with RTE; migrate existing sheets via templates; harden auth (cookies, MFA); add push notifications; train RTE staff |
| **Key partners** | Islington College R&D and RTE departments; hosting (Neon, Antideploy, Vercel — all free tier today); the UK partner university for regulation alignment |
| **Cost structure** | Near-zero hosting at current scale (free tiers); developer time for the backlog; support during the first two result cycles |

**Impact metrics to track in the pilot:** hours from marks-in to results-out per module; number of post-publication corrections; seating-plan preparation time per exam session; student queries about results/seats at the RTE desk; data-quality issues open on the dashboard.
