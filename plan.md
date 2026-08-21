# Pin Map Product & Engineering Plan

## Vision

Pin Map should evolve from a mapping utility into a geographic memory system for
people, places, time, photos, and shared experiences.

The two current surfaces remain distinct products while sharing a common platform:

1. **Personal Travel Map** — a public, owner-editable record of places visited.
2. **Class Reunion** — a login-gated shared map and portrait roster for a specific
   group.

The long-term product idea is not merely "pins on a map." The underlying model is:

```
Person × Place × Time × Memory × Photo
```

(A memorable shorthand for the model, not exhaustive — §3 has the full
entity list: `person / place / event / trip / group / timeline_event /
media / relationship`.)

The strongest product theme is:

**Then → Now → Where → We Met Again**

## 1. Product Principles

### 1.1 Keep the two products independent

The Personal Travel Map and Class Reunion experiences should continue to feel like
separate products **to users** — distinct UX surfaces, no cross-product clutter.
That's a product-surface decision, not an architectural one: underneath, they
share one growing data model (`strategy.md`'s "same product growing outward"
refers to the graph/schema level, not the UI).

They may share:

```
authentication
geocoding
photo infrastructure
timeline/event primitives
map rendering
location caching
shared component library
shared data-access utilities
```

They should not share user-facing data unless explicitly designed to do so.

### 1.2 Do not become another social network

Avoid:

```
follower counts
public popularity metrics
algorithmic feeds
likes as the primary interaction
endless timelines
generic chat/messaging unless there is a very strong use case
```

Favor durable information attached to people, places, dates, and memories.

This extends to how connections between people are modeled. Do not build a
generic `user follows user` edge — every connection should carry the reason
it exists:

```
relationship
├── person_a
├── person_b
├── context_type
├── context_id
├── started_at
└── provenance
```

E.g. `Joel ↔ Michelle, context = belding1989` or `Joel ↔ Alice, context =
attended_event_293`. That's more meaningful than "friend," and it unlocks a
query a generic social graph can't answer well: _why do I know this
person?_ — e.g. "You met twice: Belding reunion — 2026, Chicago trip —
2031." That's closer to externalized human memory than a friends list.

### 1.3 Capture should require very little effort

Every major workflow should favor:

```
paste and parse
one-click selection
automatic geocoding
inferred dates/locations
suggested grouping
QR shortcuts
reuse of cached data
```

The user should confirm good suggestions rather than manually structure everything.

### 1.4 Privacy must be explicit

Any feature involving current location, travel plans, or proximity must expose
privacy controls clearly.

Possible visibility levels:

```
Exact
Approximate
City
State
Country
Private
```

Possible location delay modes:

```
Immediate
24-hour delay
3-day delay
After departure
Never public
```

### 1.5 No speculative surfaces

No major surface gets built without either an existing user behavior or a
concrete experiment capable of validating it. AI-assisted development makes
writing code feel free; it doesn't make owning it free — every surface adds
schema, migrations, tests, interfaces, maintenance, assumptions, and future
compatibility obligations regardless of how cheap it was to generate. This
is the concrete version of `strategy.md`'s "don't build for a market that
isn't there" — see that doc's Milestones for what "validating it" means in
practice for the NOW layer specifically.

## 2. Immediate Architectural Priority: Make Classes Real Tenants

The current reunion access model is acceptable for one class but should be
hardened before onboarding additional groups.

### Goal

Every class becomes a first-class tenant protected by Postgres RLS.

### Proposed entities

```
classes           the tenant itself (one row per class/group)
class_memberships one row per (user, class): role + account state
class_people      roster entries — a person in the class, whether or not
                   they have a user account yet (invite-before-signup)
class_access      the *invite/check-in* QR codes and invite links
                   themselves (the tokens, which expire or are single-use —
                   that's what's "short-lived," not any access they grant).
                   Scanning a still-valid one creates a standing
                   class_memberships row with role `member`, state
                   `active`; there is no separate parallel access path
                   once that happens. Distinct from a roster
                   person's own badge QR (§4.1), which identifies a person
                   but grants nothing by itself; acting on it requires the
                   scanner to already be an authenticated class member.
```

Every class-owned table should contain:

```
class_id
```

### Roles

```
owner
admin
member
read_only
```

Account state remains separate from role:

```
active
read_only
disabled
```

`read_only` appears in both lists; account state wins when they conflict — a
`disabled` or state-`read_only` account can't act above that regardless of
role, since state governs whether the account can act on the class at all
before role governs what it can do.

### RLS rules

Class data access should require all of the following:

```
authenticated
AND user belongs to class_id
AND membership status allows access
AND requested operation is permitted by role
```

`timeline_event` rows aren't all class-owned — `class_id` and `owner_user_id`
are both nullable, giving three valid combinations (both null is invalid,
rejected by a check constraint):

- `class_id` set, `owner_user_id` null — a class event (e.g. the reunion
  itself); standard class RLS above applies.
- `owner_user_id` set, `class_id` null — a personal event; readable/writable
  only by that `owner_user_id`, independent of class RLS entirely.
- both set — a member's own event within a class context (e.g. "Joel met
  Michelle" logged inside `belding1989`); writable only by `owner_user_id`
  or an admin — a classmate's presence in someone else's meetup record
  doesn't grant them edit rights to it. Readable per standard class RLS
  **only when `visibility = 'class'`** (§3's default for these rows); if
  the owner sets `visibility = 'private'` on a class-scoped row, it's
  readable only by `owner_user_id` and admins, same as a class-less
  personal event — `visibility` narrows the base class RLS rule, it never
  widens it.

The existing public teaser must remain isolated through a dedicated public view
that exposes only approved fields such as:

```
id
image_url
cached_lat
cached_lng
```

Never expose names or meetup records through the public view. `cached_lat`/
`cached_lng` here must be reduced-precision (city-level or coarser, per §1.4's
visibility levels), not the exact stored coordinate — a face photo paired
with an exact coordinate is a re-identification and home-location risk the
rest of this document explicitly guards against elsewhere (§9).

### Administration

Replace hard-coded UI assumptions around a single admin email with role-based
administration. Any interim system-owner override (e.g. Joel's own account
bypassing role checks during early development) is a temporary bridge, not a
permanent fixture — it must be retired before Milestone 2 (`strategy.md`),
whose success criteria explicitly require "no hardcoded admin."

## 3. Shared Domain Model

Before adding the larger memory features, introduce a reusable event model.

> A working prototype of most of this already exists: `ivr-contacts-ios`'s
> `ContactTimelineItem` (source, note, optional voice-memo audio, timestamp),
> offline-queued through `SyncOutbox` and playable from a contact's detail
> view. See `ivr-contacts-ios/pin-map-plan.md`'s "Voice moments → Person
> Timeline / Place Memories" section — this should directly inform the
> `timeline_event` shape below rather than being designed from scratch.

### The conceptual model is broader than "reunion timeline"

`timeline_event` is likely to become the central abstraction of the whole
product, not just the reunion feature, so it should be designed against
the general shape now even though only the reunion-scoped columns get
built first. The entity set the domain model is moving toward:

```
person
place
event
trip
group
timeline_event
media
relationship
```

Under this model a reunion is an event, a meetup is an event, a future
concert is an event, a trip contains events, and a memory references an
event. That's what keeps the schema from needing a redesign when the NOW
layer eventually gets built — concerts and meetups become the same kind of
row instead of two systems bolted together later. Widening a nullable
column now is cheap; a migration plus a rewrite of everything built against
a narrower shape later is not (see 1.5 above).

`timeline_event` examples spanning the product's whole life, not just
reunions — today: "Joel met Michelle," "reunited with five classmates,"
"uploaded a memory from 1989"; later: "moved to Miami," "visited Tokyo,"
"attended a concert." The conceptual shape needs to hold all of these
without a rewrite, even though not every column is needed immediately:

```
timeline_event
├── actor/person
├── type
├── timestamp/range
├── place
├── related_people[]
├── related_event
├── related_trip
├── group
├── media[]
├── memory/text
└── visibility
```

### Core entity: timeline_event (current, buildable shape)

Suggested fields:

```
id
class_id nullable
owner_user_id nullable
person_id nullable
place_id nullable
event_type
event_date
event_time nullable
event_end_date nullable (for range-shaped types: lived_in, trip_stop,
  reunion, current_location)
lat nullable
lng nullable
location_label nullable
text nullable
visibility (audience: class | private — who can see the event; separate
  concept from §1.4's location-precision levels, which control how exact a
  shown location is regardless of who sees it. No `connected_people` tier
  yet — YAGNI per §1.5 until a feature actually needs an audience narrower
  than "the whole class" but broader than "just me." Not a static SQL
  default — set by the insert path: 'private' when class_id is null,
  'class' otherwise. A check constraint rejects visibility='class' with
  class_id null.)
metadata jsonb
created_by
created_at
updated_at
```

Supporting relations:

```
timeline_event_people
timeline_event_photos
```

Possible event types:

```
meetup
moved_to
visited
lived_in
trip_stop
memory
photo_taken
reunion
current_location
school
work
custom
```

This event model becomes the basis for:

```
person timelines
reunion replay
travel history
"where life took us"
memories tied to places
trip grouping
crossings between people and travel
```

## 4. Phase 1 — Reunion Utility

### 4.1 QR Badge / One-Tap Meetup

**Purpose**

Make meetup logging nearly frictionless during a real reunion.

**Flow**

1. Every roster person gets a QR code.
2. QR can appear on a printed badge or mobile roster profile.
3. Scanning opens that person's reunion record — gated by the same RLS as
   everything else in §2 (scanner must already be an authenticated member of
   that class; a photographed/copied badge alone reveals nothing without an
   authenticated session).
4. User taps "I Met Them."
5. Date/time fills automatically.
6. Current event location or browser location may prefill, subject to the
   visibility/delay controls in §1.4 like any other location capture.
7. Optional photo and memory can be attached.

**Optional group-photo workflow**

After uploading a photo:

- extract any GPS/timestamp EXIF data first (same extraction step as
  §10.4, reused here rather than reimplemented) — this is what §16's
  "strip EXIF only after extraction" rule depends on for reunion uploads
- choose "Who is in this photo?"
- select multiple portraits
- associate the same photo with all selected people and the meetup event

**Acceptance standard**

A meetup can be logged in roughly two taps after scanning.

## 5. Phase 2 — Then → Now → Where

**Purpose**

Create the first highly memorable visual experience specific to reunion data.

**Modes**

- **THEN** — Show yearbook portraits.
- **NOW** — Transition to uploaded recent photos when available.
- **WHERE** — Animate portraits from the roster/grid into current residence or
  current location positions on the map.

**Interaction ideas**

- single global mode switch
- per-person before/after slider
- hover to reveal current image
- graceful fallback when no recent photo exists
- deceased members remain visually distinct and respectful

**Acceptance standard**

A visitor should understand the whole concept without instructions within a few
seconds.

## 6. Phase 3 — Where Life Took Us

**Purpose**

Turn static roster data into a geographic life story.

**MVP**

Use existing fields:

```
Hometown
Current Residence
Current Location
```

Animate each person from hometown to current residence.

**Later**

Support multiple historical locations over time through `timeline_event`.

**Presentation**

Possible title: "Belding Class of 1989 — Where Life Took Us"

**Aggregate statistics**

Examples:

- number still in Michigan
- number outside Michigan
- states represented
- countries represented
- median distance from hometown
- farthest distance from hometown (a number with no name attached — see
  Privacy below for why that's exempt from the suppression rule)
- number within 50 miles of Belding
- number who returned to Michigan
- number reunited this year

**Privacy**

Statistics must be aggregate-safe: suppress any bucket with fewer than 5
people (e.g. a lightly-populated state) rather than showing a count that
re-identifies someone in an ~80-person class. "Farthest distance from
hometown" above is a number with no name attached, so it isn't subject to
this rule the way a named "farthest resident" would be.

Respect a simple per-person opt-out on the roster ("include me in class
statistics," on by default) — this is a plain roster flag, not the
location-precision/delay/proximity system built for Crossing Paths (§9,
build order items 16–18). This item (9) does not depend on those.

## 7. Phase 4 — Person Timeline

**Purpose**

Turn each roster entry into a life-and-memory page rather than a static profile.

**Example**

```
1989
Belding High School
Yearbook portrait

1998
Moved to Denver

2012
Moved to Boulder

2026
Lives in Boulder

August 15, 2026
Met at reunion
3 photos
```

**Timeline sources**

- roster fields
- meetup records
- uploaded photos
- manually added memories
- movement/location events
- reunion events

**Acceptance standard**

The timeline must render well even with only one or two known events.

## 8. Phase 5 — Reunion Replay

**Purpose**

Create an animated replay of reunion activity from meetup logs.

**Inputs**

- meetup events
- event timestamps
- meetup locations
- related people
- photos

**Experience**

A play button animates the reunion chronologically.

Possible sequence:

```
10:17 AM — Joel met Michelle — Water Tower
10:42 AM — Joel met Dave — Downtown
11:03 AM — Michelle met Karen
```

As events happen:

- avatar connections animate
- locations glow
- photos can appear
- running counts update

**Summary ending**

Display stats such as:

```
47 people
126 meetups
18 locations
1 weekend
```

**Export later**

Possible future outputs:

- MP4/WebM replay
- shareable replay URL
- still-image summary

## 9. Phase 6 — Crossing Paths

**Purpose**

Create the first meaningful bridge between the Personal Travel Map and Class
Reunion products.

**Core idea**

When a travel location overlaps geographically with classmates' approved
residence/current-location data, show an optional proximity insight.

Example: "4 people from Belding '89 are near Austin."

**Privacy requirements**

Never expose exact home coordinates by default. Use:

- city-level matching
- approximate radius
- opt-in discoverability
- hidden precise coordinates
- visibility controls

**Possible workflows**

- "Who's around?"
- "I'll be in Austin Sep 12–15"
- optionally notify eligible classmates later
- temporary Current Location with expiration date

**Data model**

Add temporary location support as new columns on `timeline_event` (not a
separate table). The period itself reuses §3's existing `event_date`/
`event_end_date` — no separate `starts_at`/`ends_at` pair. Only
`location_type` and `precision` are genuinely new here; `visibility` is
already on the table from §3, not redefined:

```
location_type = residence | current | travel
precision = §1.4's location-precision levels (Exact | Approximate | City |
  State | Country | Private)
```

**Acceptance standard**

The feature must remain useful without revealing private addresses or precise
live locations.

**Relationship to `strategy.md`'s deferred roadmap**

This is the classmate-scoped, non-commercial version of one item in
`strategy.md`'s "What to build next": item 4 (people intersection — "who's
around?"), via `event_date`/`event_end_date` on a `location_type = travel`
row — not gated on Milestone 3. Item 1 (trip dates in _commercial_ form — a
general Me-layer trip usable by Milestone 3's discovery funnel) is a
separate, still-deferred capability that this feature does not produce.

## 10. Personal Travel Map Enhancements

### 10.1 Places → Trips → Life

Introduce a hierarchy:

```
Pin
↓
Trip
↓
Travel History
```

A trip groups related pins by date and geography.

**Suggested trip detection**

Example source:

```
Aug 17 — JFK
Aug 17 — Manhattan
Aug 18 — Central Park
Aug 18 — Cooper Union
Aug 19 — JFK
```

Suggested result:

```
New York
Aug 17–19, 2026
```

The user approves or edits the suggestion.

### 10.2 Rich paste parser

Allow mixed free-form input:

```
Aug 12 Miami
Aug 13 JFK
The Standard High Line
Chelsea Market
Met Lana at Cooper Union
Aug 15 Belding MI
```

Parse:

- date
- place
- potential person reference
- coordinates
- category/tag

### 10.3 Imports

Prioritize support for:

1. CSV
2. GeoJSON
3. KML
4. GPX
5. EXIF-geotagged photos

### 10.4 Photo import

Allow users to drop many photos and infer candidate trip stops from:

- EXIF GPS
- EXIF timestamp
- existing pins

The result should be a proposed trip, not an automatic irreversible import.

## 11. Memories Attached to Places

**Purpose**

Allow locations to become memory containers rather than simple coordinates.

**Example place page**

```
Belding Water Tower

18 people mentioned this place
24 photos
Memories from 1988, 1989, 2004, 2026
```

**Possible memory prompts**

- What do you remember about this place?
- Who were you usually here with?
- What happened here?
- What changed the most?
- What do you remember that others may have forgotten?

These memories should attach to structured entities rather than a generic feed.

## 12. Search & Discovery

Introduce unified search across:

- people
- places
- memories
- tags
- trips
- dates

Examples:

```
Michelle
Belding Water Tower
1989
Florida
people I met
New York 2026
```

Later support semantic search for memory text. Build order item 23
("Unified search (+ later: semantic search)") covers both: base unified
search ships first as that item's MVP, semantic search is its later
enhancement — not two separate, unscheduled features.

## 13. Offline Reunion Mode

A reunion venue may have weak connectivity. This applies per platform, not
as one shared mechanism: the **web** class-reunion surface uses a PWA
service worker (below); the **native** `pin-map-ios` app uses the
`SyncOutbox` offline write queue it already has from `ivr-contacts-ios` (see
`mobile-infra-plan.md`). Same goals, different implementation per surface —
not a decision still pending between the two.

**Goals**

- cache roster portraits
- cache known meetup locations
- allow meetup logging offline
- queue uploads
- sync when network returns
- avoid duplicate meetup records: each offline-queued meetup write carries a
  client-generated UUID as its idempotency key (generated once, at capture
  time, not derived from person/date — two meetups with the same person on
  the same day are different rows); sync upserts on that key instead of
  inserting blind

A PWA service worker is likely the natural implementation path for the web
surface specifically.

## 14. Time Capsule

Allow a class or group to create a future-unlock collection.

**Possible content**

- photo
- message
- prediction
- memory
- note to future self/classmates

Example: "Open at the 45-year reunion — August 15, 2034"

This is not an MVP feature but fits the product extremely well.

## 15. Reunion Book / Export

Once enough structured data exists, generate a printable or downloadable
artifact containing:

- then/now portraits
- current geography
- reunion photos
- meetup summaries
- class statistics
- memories
- memorial section

This should be treated as an output generated from the graph, not a separate
content-entry system.

## 16. Data & Security Hardening

**Required before broader rollout** — "broader rollout" means Milestone 2
(`strategy.md`) specifically: the first _outside_ organizer's group, run by
someone who isn't Joel and isn't the founding Belding class. Belding's own
content at Milestone 1 doesn't trigger this gate; a second group's does.
This list is a gate on Milestone 2, not a someday-list — it must be
complete before that outside group's data enters the product.

- per-class tenant isolation
- role-based administration
- audit admin actions
- rate-limit sensitive operations
- strict upload validation
- MIME validation for images
- image size limits
- metadata stripping: extract GPS/timestamp EXIF, then strip, in the one
  shared photo-upload path every feature routes through (§1.1 lists "photo
  infrastructure" as shared) — a single implementation covers portraits,
  group photos, and travel-map imports alike, rather than each feature
  needing its own extraction step
- account/data deletion: a member can delete their own account and its
  associated content (roster entry, photos they uploaded, memories,
  meetups they logged); an admin can do the same for a member on request.
  Baseline right-to-delete, not the Premium archive's export feature —
  the two are separate capabilities
- RLS tests for every protected table
- public-view regression tests
- access-state regression tests
- signed-in read-only regression tests
- disabled-account regression tests
- basic content moderation: a report/flag action on photos and memories, and
  a way for an admin to remove content — group content from outside
  organizers is exactly the user-generated content the "don't build a
  generic social network" moderation-risk concern (`strategy.md`) is about

**Public image posture**

Belding's yearbook portraits on Cloudflare R2 are publicly readable by
design — a decision made for that specific, already-consenting class. It
does not carry over to Milestone 2 groups automatically: self-serve group
creation (item 19) includes a portrait-visibility choice, defaulting to
**not** publicly readable for any group created after this gate, since an
outside organizer's members haven't made the same implicit call Belding's
classmates did. Do not expose additional private metadata through R2
naming conventions or predictable object metadata. Any classmate may
request their own portrait be excluded —
simple opt-out, honored manually until volume justifies building a
self-serve flow (§1.5).

## 17. Technical Standards

Preserve the existing engineering posture:

- Vite
- React
- TypeScript strict
- direct `mapbox-gl`
- bun only
- self-hosted Supabase
- TDD
- `*.test.ts` / `*.test.tsx` beside corresponding features

Every new feature should include:

1. domain tests
2. RLS tests when data access changes
3. UI behavior tests
4. failure-state tests
5. loading-state tests
6. permissions tests where applicable

## 18. Recommended Build Order

§16's hardening checklist runs alongside this list, complete by the time
Milestone 2 begins (an outside organizer's group, not Belding's own use) —
matching §16's own gate — rather than as a separate later pass. The native `pin-map-ios`
client (Milestone 1's "use mobile" criterion) is planned and sequenced
separately in `mobile-infra-plan.md` and
`ivr-contacts-ios/pin-map-plan.md`/`pin-map-todo.md`, running in parallel
with this list rather than appearing as a line item here. Of
`strategy.md`'s "What to build next (reduced roadmap)" items: 1, 2, and 3
(commercial trip dates, live-event discovery, ticket intelligence) are
genuinely absent below and stay deferred to Milestone 3; 4
(people-intersection) has a classmate-scoped, non-commercial version
scheduled as part of Crossing Paths (item 18 — a related but distinct
capability from item 1; see that section's note); 5 (automatic memory
creation) remains deferred with the rest per §1.5. Resolving item 3's
sourcing question (an affiliate/marketplace relationship — see that item's
note) is itself a precondition for entering Milestone 3; it's a
business-development task for the product owner (Joel, at this project's
current size) to resolve before Milestone 3 is attempted, not an
engineering build item.

**Foundation**

1. Class tenancy + RLS isolation
2. Role-based admin
3. `timeline_event` model

**Reunion usefulness**

4. QR badge / one-tap meetup
5. Group-photo tagging
6. Offline meetup queue

**Emotional / visual differentiation**

7. Then → Now → Where
8. Where Life Took Us
9. Class statistics
10. Person Timeline
11. Reunion Replay

**Travel evolution**

12. Trip grouping
13. Rich paste parser
14. EXIF photo import
15. Import formats

**Product bridge**

16. Current-location expiration
17. Privacy radius controls
18. Crossing Paths

**Productization (Milestone 2 gate)**

Listed here because it depends on Foundation + Reunion usefulness (items
1–6) being done, not because items 7–18 must finish first. Milestone 2's
trigger is external (an outside organizer shows up) — if that happens
before items 7–18 are complete, pull 19–21 forward immediately; nothing
past item 6 gates them. §16's hardening checklist is still a hard
co-requisite regardless of when 19–21 land — it must be complete before
that outside organizer's data enters the product either way.

19. Self-serve group creation + roster import
20. Invite flow (member invitations, join links)
21. Payment/agreement capture — a manual Stripe payment link or a signed
    agreement is sufficient; no custom billing system gets built for this
    (§1.5)

**Long-term**

22. Place memories
23. Unified search (+ later: semantic search)
24. Time capsule
25. Reunion book/export

## 19. Success Criteria

Pin Map should increasingly answer questions such as:

- Where have I been?
- Who lives near where I am going?
- Where did everyone end up?
- Who did I reconnect with?
- Where did we meet?
- What happened at this place?
- What did this person look like then and now?
- How did this class scatter over time?
- What memories are connected to this place?
- What happened during the reunion, in order?

If a feature does not improve one of those questions, it should probably not be
a priority.

## 20. Product Positioning

Avoid positioning Pin Map as merely:

- a travel pin app
- a reunion directory
- an event planner
- a photo gallery

The broader product idea is:

**Pin Map remembers where life happened — and who was there.** (The
emotional half of `strategy.md`'s full product promise — "Know what's
happening wherever life takes you, and remember who was there" — this is
the memory side of it, not a competing tagline.)

The native mobile client this needs (`pin-map-ios`, forked from
`ivr-contacts-ios`) is planned in `mobile-infra-plan.md` and
`ivr-contacts-ios/pin-map-plan.md`/`pin-map-todo.md`, and is one of the
behaviors Milestone 1 (`strategy.md`) checks for ("use mobile").
