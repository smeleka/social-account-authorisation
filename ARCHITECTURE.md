# Architecture

## Product scope

This MVP implements the backbone of a Leadsie/Admatic-style authorisation system:

- Partner creates a delegated access request for a client.
- Client receives a unique session link.
- Client connects one or more ad/social providers through OAuth.
- System discovers manageable assets under that provider login.
- Client chooses assets to grant.
- Partner retrieves confirmed grants through an API.

## Service boundaries

### Public API

Used by your app, CRM, onboarding flow, or partner dashboard.

- `POST /api/link-sessions`
- `GET /api/link-sessions/:token`
- `POST /api/link-sessions/:token/connections`
- `POST /api/link-sessions/:token/grants`
- `GET /api/partners/:partnerId/grants`
- `GET /api/providers`

### Client session surface

- `GET /link/:token`
- `GET /oauth/:provider/callback`

## Domain model

### Link session

Represents one client authorisation workflow.

Fields:
- partner identity
- client identity
- requested providers
- current connections
- confirmed grants
- audit log
- expiry

### Connection state

Short-lived record used to validate an OAuth round-trip.

### Provider connection

Stored result of a successful OAuth exchange.

Fields:
- provider id
- external user id
- external user name
- token metadata
- discovered assets
- optional discovery warning

### Grant

A client-approved asset permission record attached both to the session and to partner-level grant lookup.

## Frontend surface

The session link now serves a no-build browser client that uses the existing JSON APIs. The OAuth callback redirects back to the link page with a short success or error state so the client can continue selecting assets in one flow.

## Provider architecture

### Meta Business

- Real OAuth authorization URL
- Real token exchange
- Live discovery of businesses, ad accounts, and pages from Graph API

### Google Ads

- Real OAuth authorization URL
- Real token exchange
- Live user identity fetch
- Live accessible customer discovery when a developer token is configured
- Optional fallback assets when discovery is blocked by missing Ads API access

### LinkedIn

- Real OAuth authorization URL
- Real token exchange
- Live member identity fetch
- Asset discovery delegated to an environment-configured endpoint because available marketing endpoints vary by app entitlement

### TikTok

- Real OAuth authorization URL and token exchange plumbing
- Profile lookup where available
- Asset discovery delegated to environment-configured endpoints because advertiser access depends on business-specific API enablement

## Current persistence

JSON file at `data/store.json`.

This is enough for local development and proving the workflow. In production, replace with a transactional store and encrypt secrets.

## Production upgrade path

1. Register production apps with each provider and pin final callback URLs.
2. Replace LinkedIn/TikTok discovery placeholders with your approved marketing endpoints.
3. Store provider tokens encrypted at rest.
4. Add background jobs for asset refresh and token refresh.
5. Add signed partner API keys and rate limiting.
6. Add audit export and webhook notifications.
