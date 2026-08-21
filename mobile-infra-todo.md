# Pin Map — Mobile Infra TODO (backend side)

Companion to [mobile-infra-plan.md](mobile-infra-plan.md) and [todo.md](todo.md).
Backend/deploy work only — client-side iOS work is tracked in
`ivr-contacts-ios/pin-map-todo.md`.

Priority legend matches `todo.md`: **P0** architectural/security prerequisite,
**P1** next high-value, **P2** strong follow-up, **P3** later/experimental.

## P0 — Confirm the aorus4 landscape before building

- [x] Confirm `ivr.sohyper.com` / `ivr-contacts-ios`'s API is served by
      `voice-platform.service`, not a standalone service (done — see
      `mobile-infra-plan.md`).
- [ ] Audit `pin-map-notify-relay` (already running, port 8095) — read its
      source/config, determine if it's relevant to or reusable by the new
      API service before building anything overlapping.
- [ ] Pick and record a free port for the new service (`8090` is
      `pin-map-web`; `8095` is `pin-map-notify-relay`).
- [ ] Pick the real subdomain (e.g. `api.map.joggerjoel.com`) and confirm
      DNS/Cloudflare routing before first deploy.

## P0 — New REST API Service

- [ ] Scaffold `pin-map-api` as its own repo (decided — see
      `mobile-infra-plan.md`: mirrors `realtime-ivr`, which houses
      `voice-platform` as a standalone repo, own `deploy/` and
      `ansible.cfg`, decoupled from `ivr-contacts-ios`. Same shape here:
      `pin-map-api` separate from both `pin-map` and `pin-map-ios`).
- [ ] `POST /v1/auth/otp` — wraps Supabase Auth OTP send.
- [ ] `POST /v1/auth/verify` — wraps Supabase Auth OTP verify, returns a
      bearer token (decide raw Supabase session token vs. service-issued —
      see `mobile-infra-plan.md` open questions).
- [ ] `GET /v1/classes/:slug/roster` — RLS-scoped roster list.
- [ ] `GET /v1/classes/:slug/roster/:personId` — single person.
- [ ] `POST /v1/classes/:slug/roster/:personId/photo` — multipart upload to
      Storage, wire-format matching `ivr-contacts-ios`'s
      `APIClient.uploadPhoto` (so the forked client needs minimal changes).
- [ ] `GET /v1/classes/:slug/meetups` — list meetups for the map.
- [ ] `POST /v1/classes/:slug/meetups` — log a meetup; accept and dedup on
      a client-generated idempotency key (needed by the offline sync queue
      on the client side — see `ivr-contacts-ios/pin-map-todo.md`).
- [ ] Error response shape `{ "error": string }` matching the forked
      client's `APIError` decoding.
- [ ] `GET /healthz` (or similar) for the deploy playbook's post-task check.
- [ ] Holds the Supabase service-role key server-side only — never returned
      to any client.
- [ ] Integration tests against a local/test Supabase instance.

**Acceptance criteria**

- Every route enforces class-tenancy RLS (`todo.md` P0) — a token for
  class A cannot read/write class B's data through this API.
- `curl` smoke test passes for every route above.

## P0 — QR Token Issuance & Validation

- [ ] Depends on `todo.md` P1 "QR Badge / One-Tap Meetup" — a stable,
      safe-to-print per-person identifier.
- [ ] `GET /v1/classes/:slug/roster/:personId/qr-token` — issue/rotate a
      token encoding person + class but no private fields (name/email),
      since the printed QR image itself could be photographed by someone
      outside the class.
- [ ] `POST /v1/classes/:slug/checkin/:qrToken` — resolve a scanned token
      to a person record, gated by the scanning user's own auth.
- [ ] Token rotation — invalidate a lost/leaked QR without regenerating
      the whole badge print run.
- [ ] Tests: token from class A rejected against class B's checkin route;
      rotated/invalidated token rejected.

## P1 — Deployment

- [ ] New Ansible inventory group `pinmap_api_prod` in
      `pin-map/ansible/inventory.local.yml` (and the template entry in
      `inventory.example.yml`) — same host as `pinmap_prod`, separate
      group so the two deploy independently.
- [ ] New playbook `ansible/deploy-api.yml`, mirroring `deploy.yml`'s
      rsync + docker build + docker run + health-check shape.
- [ ] New nginx vhost for the API subdomain — isolated from
      `voice-platform`'s vhost entirely (own file under
      `/etc/nginx/sites-available/`).
- [ ] Verify with `ansible pinmap_api_prod -m ping` and a real
      `ansible-playbook deploy-api.yml --check --diff` before the first
      real run, same discipline as the web deploy playbook.

## P2 — Observability

- [ ] Structured request logging (method/path/status/duration), matching
      `voice-platform`'s own log shape isn't required, but something
      greppable is.
- [ ] Basic uptime/health monitoring for the new service, separate from
      whatever monitors `voice-platform`.

## Not Now

- Extending `voice-platform` with pin-map routes — explicitly rejected,
  see `mobile-infra-plan.md`.
- Migrating the web app off direct `supabase-js` calls onto this API —
  only the iOS app needs it for v1.
