# Pin Map — Mobile Infra Plan (backend side)

Companion to [plan.md](plan.md). Covers the **server side** of the iOS effort
only — the new REST API service and its deployment. The client side (the
forked iOS app itself) is planned separately in `ivr-contacts-ios/pin-map-plan.md`,
since that work happens in that repo.

## What's already on aorus4 (found by inspection, 2026-08-21)

Before designing a new service, checked what's actually running. aorus4 is a
**shared, multi-purpose box** — not dedicated to pin-map:

- `ivr.sohyper.com` (the host `ivr-contacts-ios`'s `APIClient` talks to) is
  served by **`voice-platform.service`**, a systemd-managed Go binary at
  `/opt/voice-platform/voice-platform`, listening on `127.0.0.1:8080`.
- nginx (`/etc/nginx/sites-available/voice-platform`) proxies dozens of
  routes to it: Telnyx voice-call webhooks (`/voice/webhook`, `/voice/media`),
  an ops dashboard, `/api/contacts`, `/api/calls`, `/api/campaigns`, etc.,
  and a catch-all `location /` that also lands on port 8080 — which is how
  `/v1/contacts` (not an explicitly listed route) actually reaches it.
- So the REST API `ivr-contacts-ios` uses today is **one route surface
  inside a much larger voice/IVR monolith**, not a standalone contacts
  service.
- Also present but unrelated to this: `realtime-ivr-db` (its own Postgres,
  port 5433), `stubhub-recon-gui.service`, `ivr-avatars.service` (inactive),
  `ivr-stats.service` (inactive), a `rasa` NLU stack, and the existing
  `pin-map-web` / `supabase-*` / `pin-map-notify-relay` containers this repo
  already owns.

**Conclusion: do not extend `voice-platform`.** Bolting pin-map's roster/
meetup routes onto an unrelated voice/IVR call-handling binary would mean
every pin-map deploy risks a production voice system, and vice versa — the
opposite of the isolation this session already built for the web deploy
(`ansible/deploy.yml`, scoped to `pinmap_prod` only). The new REST API needs
its **own** process, own container, own deploy path, sharing nothing with
`voice-platform` except the physical host.

## What pin-map already has, that this reuses

- Self-hosted Supabase on aorus4 (Postgres + GoTrue + Storage) — the new API
  service sits in front of this, it doesn't replace it. The web app keeps
  talking to Supabase directly via `supabase-js`; only the iOS app goes
  through the new REST layer (see `ivr-contacts-ios/pin-map-plan.md` for
  why: matching the pattern `ivr-contacts-ios`'s `APIClient` already
  expects).
- `pin-map/ansible/` — the isolated-deploy pattern (a dedicated inventory
  group, no shared "dev" host, health-checked). The new service gets its
  own group and playbook here, not folded into `deploy.yml`.
- `pin-map-notify-relay` — already running on aorus4 (port 8095, internal).
  Worth checking what this does before building anything overlapping —
  found running but not yet audited; if it already relays notifications for
  pin-map, the new API service may be able to call it rather than
  reimplementing push/notification delivery.

## Architecture

- **Its own repo**, not a directory inside `pin-map`. Precedent:
  `realtime-ivr` — the Go monorepo housing `voice-platform` (`cmd/`,
  `internal/`, `store/`, its own `deploy/` and `ansible.cfg`) — is a
  standalone repo, separate from `ivr-contacts-ios` (the mobile client).
  Client and backend-services living in separate repos is a pattern
  already proven out in production for a directly comparable system;
  `pin-map`/`pin-map-api`/`pin-map-ios` follows the same shape.
- **New service**, working name `pin-map-api`. bun/TypeScript, matching this
  session's stack posture.
- **Docker container**, own image, own name (`pin-map-api`, not to be
  confused with `pin-map-web`), separate from `voice-platform` and every
  other aorus4 service.
- **Port**: pick something unused — `8090` is already `pin-map-web`; next
  free-and-documented slot, e.g. `8096` (after `pin-map-notify-relay`'s
  `8095`) — confirm against `docker ps`/`ss -tlnp` at build time, this list
  drifts.
- **nginx/Cloudflare**: new subdomain (e.g. `api.map.joggerjoel.com`) with
  its own vhost — do not reuse or extend `voice-platform`'s vhost, for the
  isolation reasons above.
- **Auth**: thin wrapper over Supabase Auth's own OTP endpoints — the API
  service never mints its own auth system, it proxies to GoTrue.
- **Data access**: the service holds the Supabase service-role key
  server-side (never shipped to the iOS client); RLS still the source of
  truth for who can read/write what — the API layer adds application logic
  (QR token issuance, dedup, image handling) on top of RLS, it doesn't
  replace it.

### Endpoint sketch

See `ivr-contacts-ios/pin-map-plan.md` for the full rationale; the shape:

```
POST   /v1/auth/otp
POST   /v1/auth/verify
GET    /v1/classes/:slug/roster
GET    /v1/classes/:slug/roster/:personId
POST   /v1/classes/:slug/roster/:personId/photo
GET    /v1/classes/:slug/meetups
POST   /v1/classes/:slug/meetups
GET    /v1/classes/:slug/roster/:personId/qr-token
POST   /v1/classes/:slug/checkin/:qrToken
```

## Deployment

- New Ansible inventory group in `pin-map/ansible/inventory.local.yml` —
  e.g. `pinmap_api_prod` — sibling to `pinmap_prod`, same host (`aorus4`)
  but its own group so the two services can be deployed independently and
  `deploy.yml` never accidentally touches the API service or vice versa.
- New playbook, `ansible/deploy-api.yml`, mirroring `deploy.yml`'s shape
  (rsync + docker build + docker run + health check) once the service
  exists to deploy.
- Health check endpoint (`GET /healthz` or similar) before wiring up the
  Ansible post-task, same pattern as the web deploy's `GET /`.

## Open questions

- Confirm what `pin-map-notify-relay` actually does before assuming it's
  unrelated or reusable.
- Confirm a free port and pick the real subdomain before first deploy.
- Decide whether the bearer token returned by `/v1/auth/verify` is the raw
  Supabase session access token (simplest, but ties the client to Supabase's
  token format/expiry) or a service-issued token the API can revoke
  independently (more flexible, more to build).
