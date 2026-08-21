# Pin Map TODO

Priority legend:

- **P0** — architectural/security prerequisite
- **P1** — next high-value feature
- **P2** — strong follow-up
- **P3** — later / experimental

## P0 — Class Tenancy & Security

- Create `classes` table.
- Create `class_memberships` table.
- Add roles: `owner`, `admin`, `member`, `read_only`.
- Add membership/account states: `active`, `read_only`, `disabled`.
- Add `class_id` to every reunion-owned table.
- Backfill existing `belding1989` data with a real class ID.
- Create migration tests for existing reunion data.
- Replace slug-only data lookup with `class_id` resolution.
- Update all class queries to include `class_id`.
- Add RLS policy: authenticated user must belong to requested class.
- Add RLS policy: disabled user receives no private class data.
- Add RLS policy: read-only user cannot insert/update/delete.
- Add RLS policy: admin/owner can manage roster/access as permitted.
- Preserve public teaser through a dedicated restricted Postgres view.
- Verify public view exposes no names.
- Verify public view exposes no meetup records.
- Verify public view exposes only approved portrait/location fields.
- Replace hard-coded admin UI behavior with membership roles.
- Retain global system-owner override separately from class roles.
- Add audit logging for admin access changes.
- Add RLS regression test suite covering all class-owned tables.

**Acceptance criteria**

- A user authenticated for `belding1989` cannot query another class directly
  through Supabase.
- A disabled user cannot bypass UI restrictions via API calls.
- A read-only user can read allowed data but cannot mutate it.
- Signed-out visitors can still see only the intentionally public teaser
  fields.

## P0 — Shared Timeline/Event Model

- Create `timeline_events` table.
- Decide whether travel and reunion events share one table or use a shared
  domain wrapper.
- Add nullable `class_id`.
- Add nullable `owner_user_id`.
- Add nullable `person_id`.
- Add `event_type`.
- Add `event_date`.
- Add optional `event_time`.
- Add optional `lat` / `lng`.
- Add optional `location_label`.
- Add optional `text`.
- Add `metadata jsonb`.
- Create `timeline_event_people` join table.
- Create `timeline_event_photos` join table.
- Define supported initial event types.
- Write TypeScript domain types.
- Write validation schema.
- Write event CRUD tests.
- Write RLS tests.
- Migrate meetup records into or alongside the event model.

**Acceptance criteria**

- One event can reference multiple people.
- One event can reference multiple photos.
- Event records can represent both a meetup and a travel stop without
  special-case UI data structures.

## P1 — QR Badge / One-Tap Meetup

- Generate a stable QR URL for every class person.
- Include class slug and person-safe identifier in QR flow.
- Ensure QR URL does not expose private roster fields.
- Add QR display to roster admin/person modal.
- Create printable badge-friendly QR layout.
- Add QR route handler.
- Require login before private meetup logging.
- After login, return user to scanned person's page.
- Add "I Met Them" action.
- Auto-fill timestamp.
- Allow reunion/event default location.
- Allow browser geolocation when permitted.
- Add optional note/memory.
- Add optional photo.
- Prevent accidental duplicate meetup logging within a short time window.
- Write QR flow tests.
- Write post-login redirect tests.

**Acceptance criteria**

- A signed-in user can scan a badge and log a meetup in approximately two
  taps.
- A signed-out user is returned to the same person after OTP login.

## P1 — Group Photo Tagging

- Add "Who is in this photo?" action after upload.
- Reuse roster portrait grid as a multi-select picker.
- Associate one photo with multiple people.
- Associate photo with current meetup/location event.
- Show tagged photos on every related person's timeline.
- Allow tag editing/removal.
- Add tests for multi-person associations.

## P1 — Then → Now → Where

- Add global reunion display mode: `Then`, `Now`, `Where`.
- `Then`: display original yearbook portraits.
- `Now`: display most recent approved uploaded portrait.
- Add graceful fallback when no recent photo exists.
- Preserve grayscale/In Memoriam behavior for deceased classmates.
- Add per-person before/after photo interaction.
- `Where`: animate portrait transition from grid to map position.
- Decide whether `Where` uses Current Residence or Current Location by
  default.
- Add setting/toggle when both are available.
- Respect location privacy settings.
- Add reduced-motion accessibility mode.
- Add mobile layout tests.
- Add animation behavior tests where practical.

**Acceptance criteria**

- A visitor understands the Then/Now/Where concept without instructions.
- Missing recent images do not break the layout.
- No private precise location is revealed by the transition.

## P1 — Where Life Took Us

- Add hometown origin coordinates.
- Reuse cached Current Residence geocodes.
- Reuse cached Current Location geocodes where permitted.
- Create origin-to-current migration animation.
- Add class-level title and summary panel.
- Add state-count aggregation.
- Add country-count aggregation.
- Add distance-from-hometown calculation.
- Add farthest-person calculation.
- Add count-within-50-miles calculation.
- Add count-still-in-Michigan calculation for `belding1989`.
- Generalize all stats for future class locations.
- Respect hidden/private locations in aggregates.
- Add minimum-group-size guard for privacy-sensitive stats.
- Add tests for distance/stat calculations.

## P1 — Class Statistics

- Build reusable aggregate-stat service.
- Add states represented.
- Add countries represented.
- Add distance distribution.
- Add hometown retention rate.
- Add reunion participation count.
- Add meetup count.
- Add most common meetup locations.
- Add number of recent-photo uploads.
- Add number of people with current locations.
- Make all stats privacy-aware.

## P2 — Person Timeline

- Create person timeline component.
- Render yearbook/start event.
- Render current residence event.
- Render current location event where allowed.
- Render meetup events.
- Render uploaded photos.
- Render manually entered memories.
- Sort events chronologically.
- Support incomplete dates.
- Support year-only dates.
- Add timeline filters by event type.
- Add empty-state design.
- Add timeline tests.

## P2 — Reunion Replay

- Define replay data query.
- Normalize meetup timestamps.
- Build chronological replay engine.
- Animate avatar appearance and connections.
- Fly map between important locations without excessive motion.
- Add play/pause.
- Add speed controls.
- Add scrubber timeline.
- Add running counters.
- Show photo overlays selectively.
- Add final summary card.
- Add reduced-motion mode.
- Add deterministic replay tests.
- Add mobile performance tests.

**Later**

- Export replay to WebM/MP4.
- Create shareable replay URL.
- Create static social-share summary image.

## P1 — Offline Reunion Mode

- Convert app shell to PWA-capable service-worker architecture.
- Cache roster data needed for reunion use.
- Cache portrait assets needed for roster interaction.
- Cache current meetup map state.
- Add offline meetup write queue.
- Add offline photo-upload staging.
- Sync queued writes after reconnection.
- Make queued operations idempotent.
- Resolve duplicate meetup submissions safely.
- Show visible offline/sync status.
- Add offline integration tests.

## P2 — Current Location Semantics

- Rename/define fields consistently in UI.
- Keep `Current Residence` as home/base location.
- Define `Current Location` as temporary/where-you-are-now location.
- Add optional `starts_at`.
- Add optional `ends_at`.
- Add expiration behavior.
- Add "clear after departure" option.
- Add precision setting.
- Add visibility setting.
- Add delayed-publication option.
- Add tests for expired current locations.

## P2 — Crossing Paths

- Define opt-in discoverability model.
- Add approximate proximity matching service.
- Never return exact residence coordinates to clients.
- Support city-level matching first.
- Add configurable radius matching later.
- Show count of nearby eligible classmates.
- Add "Who's around?" view.
- Add temporary travel-window matching.
- Add privacy controls per user/person.
- Add tests ensuring hidden users never appear.
- Add tests ensuring precise private coordinates are not exposed.

**Later**

- Optional mutual opt-in notification flow.
- Optional travel announcement: "I'll be in Austin Sep 12–15".

## P2 — Travel: Trip Grouping

- Create `trips` table/model.
- Allow pins to belong to a trip.
- Add manual "Create Trip" flow.
- Build date-based grouping suggestions.
- Build geographic-cluster suggestions.
- Detect probable travel start/end transitions.
- Suggest trip name from dominant city/region.
- Let user approve/edit/reject suggestions.
- Render trip route.
- Render trip photo gallery.
- Render people/memories attached to trip.
- Add trip tests.

## P2 — Travel: Rich Paste Parser

- Define parser grammar/heuristics.
- Parse date prefixes.
- Parse explicit `lat,lng`.
- Parse categories/tags.
- Parse free-form place names.
- Parse lines that may contain a person reference.
- Preserve original raw input.
- Show parsed preview before saving.
- Allow row-by-row correction.
- Reuse Mapbox cache.
- Add parser fixtures/tests for messy real-world input.

## P2 — Travel Imports

- CSV importer.
- GeoJSON importer.
- KML importer.
- GPX importer.
- Import preview.
- Duplicate detection.
- Tag imported records with source metadata.
- Add rollback for a just-completed import.
- Add large-import performance tests.

## P2 — EXIF Photo Import

- Read image timestamps client-side where practical.
- Read GPS EXIF client-side where practical.
- Strip unnecessary metadata before final upload when desired.
- Group photos by time and geography.
- Suggest trip stops.
- Match photos to existing pins when close enough.
- Present proposed trip before committing.
- Allow exclusion of selected photos.
- Add tests using fixture images.

## P2 — Place Memories

- Create memory entity or timeline-event type.
- Allow memory to reference a place.
- Allow memory to reference one or more people.
- Allow optional date/year.
- Allow optional photo.
- Build place detail page.
- Show memory count.
- Show photo count.
- Show years represented.
- Add memory prompts.
- Add moderation/edit permissions appropriate to class roles.

## P2 — Unified Search

- Search people.
- Search places.
- Search tags.
- Search trips.
- Search dates/years.
- Search memory text.
- Add class-aware filtering.
- Add travel-map-owner filtering.
- Add search keyboard shortcut.
- Add search tests.

**Later**

- Semantic search over memories.

## P2 — Privacy Controls

- Define location precision enum.
- Define location visibility enum.
- Define publication-delay enum.
- Add per-person settings UI.
- Add per-location override.
- Add current-location expiration.
- Add privacy preview: "What others can see".
- Ensure precise hidden coordinates never leave trusted backend paths.
- Add privacy regression suite.

## P2 — Photo Infrastructure Hardening

- Validate MIME type.
- Validate file extension separately.
- Enforce size limits.
- Generate normalized derivatives/thumbnails.
- Decide whether to strip EXIF metadata on class uploads.
- Prevent executable/polyglot upload abuse.
- Add failed-upload cleanup.
- Add orphan cleanup job/process.
- Add test fixtures for invalid uploads.

## P3 — Time Capsule

- Create time-capsule entity.
- Allow future unlock date.
- Add message/photo content.
- Add class-wide capsule.
- Add individual capsule.
- Hide locked content server-side, not only in UI.
- Add countdown UI.
- Add unlock tests.

## P3 — Reunion Book / Export

- Define printable page templates.
- Generate then/now portrait spreads.
- Generate current-location maps.
- Generate class statistics pages.
- Generate meetup summary pages.
- Generate memorial section.
- Generate place-memory pages.
- Export PDF.
- Consider print-on-demand only after digital export works well.

## P3 — Replay / Share Artifacts

- Shareable class map snapshot.
- Shareable Then/Now roster image.
- Shareable Where Life Took Us image.
- Shareable reunion statistics image.
- Replay video export.
- Respect all privacy settings during export.

## UX Cleanup

- Clarify `Current Residence` vs `Current Location` everywhere.
- Add tooltips/help copy only where ambiguity remains.
- Keep signed-out reunion teaser minimal.
- Keep map/roster transitions fast on mobile.
- Add empty states for classes with incomplete roster data.
- Add loading skeletons for portrait-heavy screens.
- Audit keyboard navigation.
- Audit focus traps in photo modals/lightboxes.
- Audit reduced-motion support.
- Audit color contrast for grayscale/In Memoriam state.

## Deployment / Operations

- Keep `index.html` no-cache.
- Keep hashed assets immutable.
- Add deploy smoke test after container restart.
- Add health endpoint or static readiness check.
- Add database migration verification step before app restart.
- Add rollback procedure for failed migrations.
- Add backup verification for Supabase Postgres.
- Add backup verification for Storage metadata.
- Document Cloudflare R2 portrait dependency.
- Add Mapbox quota observability.
- Add geocode cache hit/miss metrics.
- Add sign-in OTP failure metrics.

## TDD Requirements for Every Feature

- Matching `*.test.ts` or `*.test.tsx` file exists.
- Happy path covered.
- Permission failures covered.
- Loading state covered.
- Empty state covered.
- Network/error state covered.
- RLS test added for database-access changes.
- Mobile behavior checked.
- Regression test added for every discovered bug.

## Suggested First Sprint

- Create `classes` and `class_memberships`.
- Backfill `belding1989`.
- Add `class_id` and RLS to existing reunion tables.
- Replace hard-coded admin logic with class role checks.
- Create `timeline_events` foundation.
- Build QR-person route.
- Build "I Met Them" one-tap action.
- Add duplicate protection.
- Add printable QR badge view.
- Ship with tests.

## Suggested Second Sprint

- Build Then mode.
- Build Now mode.
- Build Where mode.
- Add Current Residence/Current Location selector.
- Add reduced-motion support.
- Build initial class statistics service.
- Ship Where Life Took Us MVP.

## Suggested Third Sprint

- Build person timeline.
- Populate timeline from meetup events.
- Populate timeline from portrait/photo events.
- Add memory event type.
- Build place-memory view.
- Start Reunion Replay using real meetup data.

## Suggested Fourth Sprint

- Add trips model.
- Add trip grouping suggestions.
- Add rich paste parser preview.
- Add EXIF photo-import prototype.
- Add current-location expiration/privacy settings.
- Prototype Crossing Paths using city-level matching only.

## Not Now

Avoid spending significant time on these until the core memory graph is
strong:

- Generic social feed.
- Likes/reactions system.
- Follower/friend graph.
- Full chat/messaging platform.
- Event ticketing.
- Complex payment flows.
- Facial recognition.
- Exact live-location sharing by default.
- Building a separate native mobile app before the PWA/web experience proves
  the need.
