# Ops runbook

Fill the placeholders when the services are created (never paste secrets here).

| Piece | Where | URL |
|---|---|---|
| API (`backend/`) | Antideploy, auto-deploys `main` | `{{ANTIDEPLOY_APP_URL}}` |
| Database | Neon project `{{NEON_PROJECT}}` (pooled connection string in `DATABASE_URL`) | — |
| Web (`web/`) | Vercel, root directory `web/`, production tracks `main` | `{{VERCEL_URL}}` |
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
