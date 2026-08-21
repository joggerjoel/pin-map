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

The strongest product theme is:

**Then → Now → Where → We Met Again**

## 1. Product Principles

### 1.1 Keep the two products independent

The Personal Travel Map and Class Reunion experiences should continue to feel like
separate products.

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

## 2. Immediate Architectural Priority: Make Classes Real Tenants

The current reunion access model is acceptable for one class but should be
hardened before onboarding additional groups.

### Goal

Every class becomes a first-class tenant protected by Postgres RLS.

### Proposed entities

```
classes
class_memberships
class_people
class_access
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

### RLS rules

Class data access should require all of the following:

```
authenticated
AND user belongs to class_id
AND membership status allows access
AND requested operation is permitted by role
```

The existing public teaser must remain isolated through a dedicated public view
that exposes only approved fields such as:

```
id
image_url
cached_lat
cached_lng
```

Never expose names or meetup records through the public view.

### Administration

Replace hard-coded UI assumptions around a single admin email with role-based
administration while retaining a global system-owner capability.

## 3. Shared Domain Model

Before adding the larger memory features, introduce a reusable event model.

> A working prototype of most of this already exists: `ivr-contacts-ios`'s
> `ContactTimelineItem` (source, note, optional voice-memo audio, timestamp),
> offline-queued through `SyncOutbox` and playable from a contact's detail
> view. See `ivr-contacts-ios/pin-map-plan.md`'s "Voice moments → Person
> Timeline / Place Memories" section — this should directly inform the
> `timeline_event` shape below rather than being designed from scratch.

### Core entity: timeline_event

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
lat nullable
lng nullable
location_label nullable
text nullable
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
3. Scanning opens that person's reunion record.
4. User taps "I Met Them."
5. Date/time fills automatically.
6. Current event location or browser location may prefill.
7. Optional photo and memory can be attached.

**Optional group-photo workflow**

After uploading a photo:

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
- farthest resident
- number within 50 miles of Belding
- number who returned to Michigan
- number reunited this year

**Privacy**

Statistics must be aggregate-safe and should respect per-person visibility
settings.

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
126 reunions
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

Add temporary location support:

```
location_type = residence | current | travel
starts_at
ends_at
visibility
precision
```

**Acceptance standard**

The feature must remain useful without revealing private addresses or precise
live locations.

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

Later support semantic search for memory text.

## 13. Offline Reunion Mode

A reunion venue may have weak connectivity.

**Goals**

- cache roster portraits
- cache known meetup locations
- allow meetup logging offline
- queue uploads
- sync when network returns
- avoid duplicate meetup records

A PWA service worker is likely the natural implementation path.

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

**Required before broader rollout**

- per-class tenant isolation
- role-based administration
- audit admin actions
- rate-limit sensitive operations
- strict upload validation
- MIME validation for images
- image size limits
- metadata stripping where appropriate
- RLS tests for every protected table
- public-view regression tests
- access-state regression tests
- signed-in read-only regression tests
- disabled-account regression tests

**Public image posture**

Yearbook portraits on Cloudflare R2 remain publicly readable by design. Do not
expose additional private metadata through R2 naming conventions or predictable
object metadata.

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

**Long-term**

19. Place memories
20. Semantic search
21. Time capsule
22. Reunion book/export

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

**Pin Map remembers where life happened — and who was there.**

We will need an iOS app initially as well.
