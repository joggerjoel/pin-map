# Pin Map — Overall Idea

Deployed at **https://map.joggerjoel.com**.

Started as a one-shot tool ("paste a list of places, see them on a map") and grew into
two related but independent products sharing one codebase and one Supabase backend:

1. **Personal Travel Map** — the owner's public, ongoing record of everywhere they've
   pinned.
2. **Class Reunion** (`?class=<slug>`) — a shared, login-gated meetup map + portrait
   roster for a specific group (currently `belding1989`), reusable for future groups
   (e.g. `wtc2026`) under the same URL pattern.

A small nav button lets a visitor swap between whichever they're on and the other,
remembering the last class they visited.

---

## 1. Personal Travel Map (`/`)

**Public by default** — no login required to view. Signing in unlocks editing.

- Paste places (one per line) → geocoded via Mapbox and pinned. Handles categories,
  custom icons/tags, explicit `lat,lng` coordinates, and date prefixes.
- **Declutter ("Spider") mode** — overlapping pins spread apart into a fan with thin
  connector lines back to their true position, toggleable, off by default.
- Photo galleries per pin, with a fullscreen lightbox.
- Owner vs. visitor: the owner can add/edit/relocate pins; a signed-in non-owner is
  capped by a shared Mapbox-quota limiter before being forced onto their own token.
- Sidebar: search/filter, tag editor, state-coloring, sign-in/out.

## 2. Class Reunion (`?class=<slug>`)

A **completely separate mode**, gated behind login (unlike the travel map) but with no
per-class membership check — "must be signed in and know the URL" is the access model.

**Public teaser** (signed-out visitors): the globe with avatar pins at each person's
cached "Living" location — photo only, no names, no roster, no meetup data. Clicking a
pin shows just the portrait.

**Signed-in app**, two tabs:

- **Meetup Map** — log "who I met, where, when." Click a roster portrait or a map
  avatar to select someone; type a city; it geocodes (US-biased) and drops a pin.
  Clicking an avatar also fills the search box and flies the map to them; clicking
  away deselects.
- **Edit Roster** — grid of portraits (Birth name, Current name, Hometown, Current
  Residence, Current Location — the last two independently geocoded/cached for the map
  avatar pins). Double-click a portrait for a photo modal (upload a "recent" or
  year-dated photo; hovering the original portrait reveals the current look if one's
  been uploaded). Deceased classmates (`living` starts with "RIP") get a grayscale
  portrait and an "In Memoriam" label.

**Admin tab** (visible only to `joel.labelle@gmail.com`): a sign-in audit log (who's
signed in, when, how many times) and a per-person Active / Read-only / Disabled
control. Enforced in Postgres RLS, not just the UI, so a restricted user can't bypass
it by calling the API directly.

**Portraits**: 121 yearbook photos hosted on Cloudflare R2 (`files.sohyper.com`),
publicly readable — this is intentional (explicitly approved) since they're shown to
signed-out visitors too.

## 3. Shared Infrastructure

- **Stack**: Vite + React + TypeScript (strict), `mapbox-gl` used directly, `bun`
  exclusively. TDD throughout — every feature has a matching `*.test.ts(x)` file.
- **Backend**: self-hosted Supabase (Postgres + GoTrue + Storage) on `aorus4`. Auth is
  email OTP (no passwords). Photos live in the `pin-photos` Storage bucket.
- **Deploy**: `rsync` to `aorus4` → multi-stage Docker build (bun build → nginx) →
  container restart. `index.html` is `no-cache`; hashed `/assets/*` are
  `immutable`.
- **RLS posture**: travel-map data is owner-scoped; class-reunion data is
  `authenticated`-wide (not per-class-scoped) except where the admin/access-control
  layer narrows it; the public class view uses a dedicated Postgres view exposing only
  `id`, `image_url`, and cached lat/lng — never names.

## Status

Both surfaces are live and in active use. The class-reunion feature (avatar map,
roster editor, photo uploads, admin controls, public teaser, cross-navigation) was
built entirely in this working session on top of the pre-existing travel map.
