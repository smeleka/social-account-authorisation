# Social Account Authorisation Hub

A self-contained MVP for a Leadsie-style platform that lets agencies connect their own operator accounts and collect delegated access to ad and social accounts from clients.

## What it does

- Lets an operator connect their own provider accounts first
- Creates short-lived client-facing authorisation sessions
- Generates provider OAuth handoff URLs for Facebook, Google Ads, LinkedIn, and TikTok
- Exchanges OAuth codes for provider access tokens
- Discovers provider assets where the provider API access is fully configured
- Accepts provider callbacks and stores connected accounts/assets
- Tracks which accounts a client approved for a partner
- Exposes API endpoints for downstream sync or internal CRM ingestion
- Persists state to JSON on disk so the service survives restarts

## Local run

```bash
cp .env.example .env
npm start
```

Server defaults to `http://localhost:3000`.

## Main pages

- `/` home
- `/operator` connect your own provider accounts
- `/clients` build client authorisation links
- `/settings` advanced provider app setup for self-hosting
- `/health` health check


## Current storage mode

The app now supports two storage backends:

- JSON fallback when `DATABASE_URL` is not set
- Postgres when `DATABASE_URL` is set

A default workspace is created automatically and current records are scoped to that workspace. This keeps the app single-tenant in practice for now, while making it easier to add future tiers later.

## Railway preparation

This project is prepared to run on Railway as a Node service.

### Files added for deployment

- `railway.toml`
- `.gitignore`

### Runtime assumptions

- Start command: `npm start`
- Health check path: `/health`
- Persistent data directory: `/app/data`
- App must listen on `0.0.0.0`

### Railway environment variables

Set these in Railway:

- `DATABASE_URL=<railway-postgres-connection-string>` if you add Railway Postgres
- `PORT=3000`
- `HOST=0.0.0.0`
- `BASE_URL=https://<your-railway-domain>`
- `APP_NAME=Authorisation Hub`
- `SESSION_TTL_MINUTES=30`
- `DATA_DIR=/app/data`
- `ALLOW_DEMO_PROVIDER_AUTH=true`
- `PROVIDER_DISCOVERY_FALLBACK=true`

### Railway volume

Create a volume and mount it at:

- `/app/data`

### What Railway still needs

Because this project currently only exists locally, Railway still needs one of these before the app code itself can be deployed:

1. local CLI deployment with `railway up`
2. a connected GitHub repo
3. another supported source upload path

## Provider credentials

For a self-hosted live OAuth setup, the system owner must add provider app credentials in `/settings`.
Normal users should not need to enter those; they just log into the provider through the app.

## Current limitations

- Tokens are persisted to local JSON and should be encrypted before production use.
- A real database is a better long-term fit than local JSON storage.
- LinkedIn and TikTok usually need a proper HTTPS deployment for realistic testing.
