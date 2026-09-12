# Ops runbook

Fill the placeholders when the services are created (never paste secrets here).

| Piece | Where | URL |
|---|---|---|
| API (`backend/`) | Render `biggys-api` (Oregon, free), auto-deploys `main` | https://biggys-api.onrender.com |
| Database | Render `biggys-db` (Oregon, free PostgreSQL 18) | — |
| Web (`web/`) | Render `biggys-web` (Singapore, free), root directory `web/`, tracks `main` | https://biggys-web.onrender.com |
| APK | GitHub Release `v1.0.0-hackathon` | `https://github.com/Salokya-1/The-Biggys/releases` |
| Status page | UptimeRobot public page | `{{STATUS_PAGE_URL}}` |

## Environment variables

**Antideploy (API):** `DATABASE_URL` (Neon pooled), `JWT_SECRET`, `JWT_REFRESH_SECRET` (≥ 32 random chars each), `CORS_ORIGIN` = `{{VERCEL_URL}}` (comma-separate extra origins), `NODE_ENV=production`, optional `GIT_SHA`.
**Vercel (web):** `NEXT_PUBLIC_API_URL` = `{{ANTIDEPLOY_APP_URL}}`.
**APK:** built with `--dart-define=API_URL={{ANTIDEPLOY_APP_URL}}`; switchable at runtime in the app's Settings.

## Health and keep-alive

- `GET /health` liveness · `GET /health/ready` readiness (503 when the DB is unreachable) · `GET /health/version` commit + build time.
- **cron-job.org:** `keepalive-api` → `GET {{ANTIDEPLOY_APP_URL}}/health/ready` every 3 minutes (keeps the container and Neon warm; Neon suspends after 5 min idle). `keepalive-web` → `GET {{VERCEL_URL}}` every 10 minutes. Failure notifications to `{{ALERT_EMAILS}}`.
- **UptimeRobot:** HTTP(S) monitor on `/health/ready` every 5 min with keyword `"status":"ok"`; second monitor on `{{VERCEL_URL}}`; alert contacts = whole team; public status page linked in the README.
- **Antideploy** emails on Healthy → Degraded → Down and on failed builds (previous version keeps serving).
- Optional: `.github/workflows/keepalive.yml` on `*/5 * * * *` as a backup pinger.

## Procedures

**Deploy:** merge to `main` → CI (migrate, seed, typecheck, tests, build) → Antideploy and Vercel auto-deploy. `Procfile` runs `prisma migrate deploy` in the release phase; `server.ts` runs it again before listening (idempotent).

**Rollback (API):** Antideploy → Deployments → previous image → Restore (~40 s). **Rollback (web):** Vercel → Deployments → Promote previous.

**Reseed demo data:** locally `cd backend && npm run seed` (truncates and rebuilds in ~5 s). Against Neon: same command with `DATABASE_URL` pointing at the Neon pooled string. Or reset the `main` branch from the `demo-clean` Neon branch created after the final seed.

**If Antideploy is down:** point `NEXT_PUBLIC_API_URL` (Vercel) and the app's Settings screen at the Render backup (`{{RENDER_BACKUP_URL}}`), which is pre-created against the same Neon database.

**If the venue Wi-Fi is down:** laptop runs `backend` + `web` locally against local Postgres (`docker compose up -d` or the portable Postgres), `npm run seed`, phones use `http://<laptop-ip>:8080` from Settings.

**Verify before freeze (10:30):** `curl {{ANTIDEPLOY_APP_URL}}/health/ready` → `"status":"ok"`; `{{VERCEL_URL}}` login as each demo account; APK on two phones logs in and shows results + seat; `demo-clean` branch fresh; status page green.


## Deploying everything to Render (alternative to Antideploy + Vercel + Neon)

`render.yaml` at the repo root is a blueprint that creates all three pieces at once: a free Postgres, the API and the web app.

1. Render dashboard → **Blueprints** → *New Blueprint Instance* → select `Salokya-1/The-Biggys` → Apply. It creates `biggys-db`, `biggys-api` and `biggys-web`.
2. When `biggys-api` is live, copy its URL (`https://biggys-api-xxxx.onrender.com`) and set it as `NEXT_PUBLIC_API_URL` on **biggys-web**, then *Manual Deploy → Clear build cache & deploy* (Next.js bakes public variables at build time).
3. Copy the web URL and set it as `CORS_ORIGIN` on **biggys-api** (comma-separate several origins). The API restarts by itself.
4. Optional: set `OPENROUTER_API_KEY` on `biggys-api` to switch the assistant on.
5. Seed the demo data once, from a laptop, against the Render database:
   ```bash
   cd backend && DATABASE_URL="<Render external connection string>" npm run seed
   ```
   Use the **External** connection string from the `biggys-db` page; the internal one only resolves inside Render.

Notes for the free tier: services sleep after 15 minutes idle and take roughly 50 seconds to wake, so keep the cron-job.org ping on `/health/ready` pointed at the Render URL as well. The free Postgres expires after 30 days — export with `pg_dump` before then if the project keeps running. Migrations run in `startCommand`, so a schema change ships with the deploy; a failed migration stops the release and Render keeps the previous version serving.

## Deployment gotchas worth knowing

Two things cost us a deploy each; both are in `render.yaml` now.

- **Database region.** A blueprint `databases:` entry with no `region` is created in Oregon while
  the services take whatever region they name. `fromDatabase` only resolves inside one region, so
  an API in Singapore pointing at an Oregon database is not created at all — the sync reports a
  failure against a service that never appears in the list. Pin the database region to the API's.
- **devDependencies.** `NODE_ENV=production` makes `npm ci` skip devDependencies, and both the
  TypeScript compiler and the Prisma CLI live there. Without `npm ci --include=dev` the build
  exits with status 2 before compiling anything.

**Mail:** set `SMTP_URL` (any SMTP connection string) and optionally `SMTP_FROM` to deliver
camera-access requests; `IT_SUPPORT_EMAIL` sets where they go. With no `SMTP_URL` the message is
written to the outbox and marked queued — visible under `GET /api/emails` — rather than lost.
