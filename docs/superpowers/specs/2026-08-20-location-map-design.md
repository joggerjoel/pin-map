# Location Map — Design Spec

**Date:** 2026-08-20
**Status:** Approved

## Purpose

A small, standalone tool: paste a list of places (one per line — city names, addresses,
landmarks), click a button, and see them pinned on an interactive map. No account, no
backend, no build infrastructure beyond a local dev server.

## Architecture

- Vite + React + TypeScript (strict mode, no `any`)
- `mapbox-gl` used directly (no React wrapper library) for the map and markers
- Single page, no routing, no backend
- Mapbox access token read from `VITE_MAPBOX_TOKEN` in `.env` (gitignored); `.env.example`
  ships a placeholder. If no env var is set at runtime, the app shows a one-time prompt
  and persists the token to `localStorage` so the app still works for someone who just
  clones and runs it without editing files.

## Components

- `App` — page layout: input panel (textarea + list) on the left, map filling the right
- `PlaceInput` — textarea for pasting places (one per line) + "Pin Places" button
- `MapView` — thin wrapper around a `mapbox-gl` `Map` instance; renders one marker per
  pinned place; fits map bounds to all current markers whenever the pin set changes
- `PlaceList` — sidebar list of successfully pinned places (click an entry to fly the
  map to it; × removes it) plus a separate "couldn't find" list for lines that failed
  to geocode
- `useGeocoder` hook — the only non-trivial logic in the app:
  - `parseLines(raw: string): string[]` — split on newlines, trim, drop blank lines and
    duplicates (case-insensitive comparison of the trimmed text)
  - `geocodeLine(line: string): Promise<GeocodeResult | null>` — calls the Mapbox
    Geocoding API (`GET /geocoding/v5/mapbox.places/{query}.json`), returns the first
    result's `{ name, lng, lat }` or `null` on no match
  - Batches all lines with `Promise.allSettled` so one slow/failed lookup doesn't block
    the rest

## Data Flow

1. User pastes lines into the textarea, clicks "Pin Places"
2. `parseLines` normalizes the raw text into a deduped list of query strings
3. Each line is geocoded independently via the Mapbox Geocoding API
4. Successes are appended to the pinned-places list (deduped against existing pins by
   the same case-insensitive trimmed-text rule as `parseLines`) and rendered as markers;
   the map refits bounds to include every current marker
5. Failures are appended to a separate "couldn't find" list shown next to the input,
   and do not block or roll back the successful pins from the same batch
6. Removing a place from `PlaceList` removes its marker and triggers a bounds refit

## Error Handling

- No Mapbox token configured (env var absent, nothing in `localStorage`) → the map area
  shows a setup screen with instructions instead of attempting to render a broken map
- Per-line geocode miss (no result) or per-line rate limit → surfaced inline in the
  "couldn't find" list; the rest of the batch still succeeds
- Geocoding API network failure (fetch throws / non-2xx) → an inline banner near the
  input with a retry button; does not crash the app or lose already-pinned places

## Explicit Scope Cuts (YAGNI)

- No persistence of pinned places across page reloads
- No CSV/JSON import or export
- No routing, drawing, or distance/area measurement tools
- No multi-map-provider support (Mapbox only — see trade-off note below)

These are deliberately deferred. Persistence in particular is a small, self-contained
addition (`localStorage` sync on the pinned-places list) if it turns out to be wanted
later.

## Trade-off Note: Mapbox vs. Google Maps

Mapbox was chosen over Google Maps because: (1) its free tier (50k geocodes/month) needs
no billing account to get started, and (2) its Geocoding API is straightforward to call
client-side with a public-scoped token. Google Maps has richer place data in some regions
but requires a Google Cloud billing account enabled even for free-tier API usage.

## Testing

- Vitest unit tests for `parseLines` (dedup, trimming, blank-line handling) and for the
  Mapbox response → `GeocodeResult` mapping (mocked `fetch`)
- No end-to-end tests — the app is small enough that manual verification of the paste →
  pin → view flow in a browser covers the remaining risk
