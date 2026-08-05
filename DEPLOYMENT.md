# Deployment Guide

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Docker Engine | ≥ 24.0 | `docker --version` |
| Docker Compose | ≥ 2.20 | `docker compose version` |
| Git | Any | |
| Ports | 3000, 4000 | Must be free on host |

## Local Deployment (docker compose)

```bash
# 1. Clone repository
git clone <repo-url>
cd kspdb-fault-system

# 2. Configure environment
cp .env.example .env
# Optionally edit .env to add OPENAI_API_KEY for AI summaries

# 3. Start the stack
docker compose up

# 4. Wait for seeding to complete (watch for "[Seed] Ready")
# First run: ~60s for image builds + ~30s for DB seed

# 5. Open the app
open http://localhost:3000
```

**Verify it worked:** You should see the KSPDB Control Room with a map showing thousands of poles.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_PASSWORD` | No | `password` | PostgreSQL password |
| `DB_HOST` | No | `postgres` | DB host (use `localhost` outside Docker) |
| `DB_PORT` | No | `5432` | DB port |
| `DB_NAME` | No | `kspdb` | Database name |
| `DB_USER` | No | `postgres` | Database user |
| `PORT` | No | `4000` | Backend port |
| `NODE_ENV` | No | `development` | Node environment |
| `OPENAI_API_KEY` | No | *(empty)* | OpenAI key for AI summaries. If empty, template summaries are used. System works without this. |

## Cloud Deployment (Railway)

Railway.app supports Docker Compose natively and has a generous free tier.

```bash
# Install Railway CLI
npm install -g @railway/cli
railway login

# Create project
railway new kspdb-fault-system
railway up

# Set environment variables in Railway dashboard:
# DB_PASSWORD, OPENAI_API_KEY (optional)
```

Railway auto-assigns a public URL. Set it in DEPLOYMENT.md and README.md.

## Cloud Deployment (Render)

1. Push repo to GitHub
2. On Render: New → Docker Compose → select your repo
3. Set env vars: `DB_PASSWORD`, `OPENAI_API_KEY`
4. Deploy

> **Note:** Render free tier cold-starts after 15 minutes of inactivity. The app may take 30s to wake up. This is normal — the README notes this.

## Troubleshooting

### Port 3000 or 4000 already in use
```
Error: Bind for 0.0.0.0:3000 failed: port is already allocated
```
**Fix:** Kill the conflicting process (`lsof -ti:3000 | xargs kill`) or change ports in `docker-compose.yml`.

### Postgres takes too long to start
```
Error: Connection refused — ECONNREFUSED 127.0.0.1:5432
```
**Cause:** Backend started before Postgres was ready.  
**Fix:** The `depends_on: condition: service_healthy` in docker-compose.yml handles this. If it still fails, run `docker compose down && docker compose up`.

### Seed runs but poles show no state (map all grey)
**Cause:** pole_states only populated for poles with a `device_id`. Poles without devices (9%) are grey by design.  
**Fix:** Not a bug. Inject a fault to see state changes.

### WebSocket disconnects behind a reverse proxy
**Symptom:** "Offline" indicator; real-time updates stop working.  
**Cause:** Proxy not configured to forward `Upgrade: websocket` header.  
**Fix:** See nginx config in `frontend/nginx.conf` — ensure `proxy_http_version 1.1` and `Connection "Upgrade"` headers are forwarded. On Railway/Render, WebSocket is supported natively.

### ARM vs x86 image mismatch
**Symptom:** Container immediately exits with `exec format error`.  
**Fix:** Add `platform: linux/amd64` to each service in `docker-compose.yml`, or build locally with `docker buildx build --platform linux/amd64`.

### docker compose up hangs at "Generating synthetic network"
**Cause:** Seeder generating data for first time — takes 15–20s for 5,000 poles.  
**Fix:** Wait. If it hangs > 60s, check `docker compose logs backend`.

### "Ticket not found" error on status update
**Cause:** Race condition — ticket was auto-closed before you clicked.  
**Fix:** Refresh the ticket list. This is the system working correctly.

## Reset to Clean State

```bash
docker compose down -v   # removes volumes including postgres data
docker compose up        # re-seeds from scratch
```
