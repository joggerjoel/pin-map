# Pin Map — Strategy

## Positioning

> Pin Map shows you where your life, your people, and what's happening
> intersect.

Broader than a travel map, much tighter than "maps + reunions + concerts +
social."

**Commerce pays for Pin Map. Groups pay for Pin Map. Personal history makes
people love Pin Map.**

That last part matters a lot. Not every emotionally valuable feature needs
to be monetized. Some things should exist precisely because they make
someone think: _this is where my life is, I don't want to lose this._ That
bond is worth more than squeezing another $5/month out of them.

Internally, Pin Map isn't fundamentally a mapping product — the map is the
interface, not the product. What it's building is **a personal geographic
memory graph that helps you decide what to do next.** Memory drives
retention. People drive participation. Groups drive acquisition and direct
revenue. Events drive transactions. The map is what makes all of it legible
to a user, not what it's for.

## The unique core

> Pin Map's moat is the longitudinal graph connecting people, places,
> events, and memories across a user's past, present, and future.

Most competitors own one piece:

- **FindPenguins** — where I went
- **Radiate** — where people/events are happening
- **Bandsintown** — what shows I might like
- **Facebook** — people I know
- **Ticket marketplaces** — tickets I can buy

Pin Map can connect them:

**Where I've been → where I'm going → who I know there → what's happening
there → whether it's worth going.**

That combination — captured over time, not at a single moment — is what
makes it a graph and not a snapshot.

Travel history isn't the business by itself — it's the user's accumulated
investment in Pin Map. After two years, Pin Map might know: 480 places
visited, 32 trips, 600 photos, 70 people encountered, 14 concerts attended,
where you lived, places you return to, future trips, memories attached to
all of it. At that point, switching to another app means abandoning part of
your personal history. That's enormously valuable retention.

## Three layers, not three separate products

**ME** — my places, trips, photos, memories. FindPenguins-like territory,
but its real purpose is identity and retention.

**PEOPLE** — people connected to my life. Classmates initially, eventually
family, coworkers, friends, travel companions, alumni groups. This creates
the emotional network.

**NOW** — what's happening near me or where I'm going. Concerts, sports,
comedy, nightlife, selected events. This is the commercial engine.

User experience: **Me → People → Now.** Extremely understandable concepts,
and every one reinforces the others.

A naming note: "Now" is doing double duty — the layer includes future plans
("where I'm going"), which isn't literally now. `LIVE` (live entertainment /
the active world, rather than literal present tense) is the more
semantically accurate label. Worth keeping in mind, but not worth changing
the UI copy over yet — `Me / People / Now` reads better emotionally, and the
mismatch is cosmetic, not architectural. See "Past + present + future"
below for why the underlying tense axis matters more than the label does.

### How the layers map to what's already built

These three layers aren't a wishlist — each has something live or proven
elsewhere already, across the repos that make up this one product (see
`mobile-infra-plan.md`'s "One product, multiple repos"):

- **Me** — `pin-map`'s personal travel map. Live today.
- **People** — the class-reunion surface (live: shared meetup map, roster,
  declutter — auto-spreading overlapping pins apart so no marker hides
  another) plus `pin-map-ios`, planned as a fork of `ivr-contacts-ios`.
  That repo's `Contact`/`ContactCircle` model (a "Circle" is conceptually a
  "Class"), its `SyncOutbox` offline write queue, `AvatarLoader`, and —
  notably — `ContactTimelineItem` are not analogues to build from scratch;
  `ContactTimelineItem` already _is_ the Person Timeline / voice-memo
  concept described elsewhere in `plan.md`. See
  `ivr-contacts-ios/pin-map-plan.md` for the full reuse plan.
- **Now** — nothing pin-map-specific exists yet (see "Sequencing" below —
  deliberately not building this yet), but `realtime-ivr`'s
  `voice-platform` service already runs a grounded-LLM concierge engine
  (system prompt + grounded event inventory + LLM — its replies are
  constrained to that supplied inventory of real data rather than the
  model's free-form knowledge, which greatly reduces — not eliminates — the
  chance it invents an event that doesn't exist), proven out live via its
  `/ivr/simulator`. That's the shape a future "you're in NYC, here's what's
  worth going to" concierge needs — it's working today, just pointed at
  voice calls instead of trip context. `voice-platform`'s Telnyx voice
  channel is also sitting there if a spoken interface is ever worth adding.

Practical implication: when Now eventually gets built, the starting point
is adapting `voice-platform`'s existing concierge pattern, not designing a
recommendation engine from zero.

## Where the money comes from

Deliberately avoid depending primarily on subscriptions.

### 1. Transaction revenue

Live entertainment discovery creates ticket purchases — potentially the
largest revenue source, since a trip-planning flow sits naturally upstream
of a ticket purchase. Surface "Great deal tonight — $42," someone buys.
Revenue through: inventory, affiliate/referral economics, marketplace
relationships, eventually transaction fees. The user doesn't need to pay
Pin Map anything — that's powerful.

### 2. Paid groups

The second strong business. Class reunion organizer pays. Family reunion
organizer pays. Corporate alumni group pays.

- **$99–299 per event/group**, members participate free.
- Eventually organizations: **$500–2,500/year** for persistent communities.

### 3. Premium personal archive

Later, and modest. **$29–49/year** for things that genuinely cost money:
high-resolution photo storage, automatic photo imports, full-resolution
backups, advanced animated life maps, private family sharing, AI-generated
trip/memory books, export/archive, long-term preservation.

Not: _"give us $5/month to put pins on a map."_ That's weak.

### 4. Physical products

Books can exist later, but as an output of the memory system, not the
business model. A 45-year reunion book generated automatically from
then/now portraits, where everyone lives, reunion photos, memories, and
the meetup map could sell extremely well — but it's ancillary revenue.
(45 lands on the every-other-year cadence from 2026; see `plan.md` §14's
Time Capsule for the matching "August 15, 2034" example.)

## The killer loop

Not isolated features — a sequence:

1. You add a trip: **New York — October 8–12**.
2. Pin Map: _"You're going to New York."_
3. _"6 people you know are there."_
4. _"23 live events match your interests during your trip."_
5. _"Two have unusually good ticket prices."_
6. _"Lana (who's opted into nearby-friend visibility) is close to one of
   them."_ — approximate, opt-in only, per the privacy rules in `plan.md`
   §9 (no exact live coordinates by default).
7. Afterward: _"Add this night to your trip?"_ — tap yes.
8. The show, person, photographs, and location join your life map, subject
   to the visibility controls (`plan.md` §1.4) any location-bearing data
   gets, and deletable per `plan.md` §16's baseline account/data-deletion
   item. (Full data export is a separate, later capability — the Premium
   personal archive revenue stream above — this step doesn't promise that
   ahead of it.)

```
PLAN
 ↓
DISCOVER
 ↓
MEET / ATTEND
 ↓
CAPTURE
 ↓
REMEMBER
 ↓
BETTER FUTURE DISCOVERY
```

Much more defensible than a concert heat map.

## Past + present + future

Most apps live almost entirely in one tense:

- **FindPenguins** — PAST (where I've traveled)
- **Radiate** — NOW (what's happening)
- **Ticketmaster** — FUTURE (what's scheduled)

Pin Map can naturally cover all three:

- **PAST** — Where have I been? Who was there? What happened?
- **NOW** — Who's nearby? What's happening tonight? What's unusually
  interesting?
- **FUTURE** — Where am I going? Who's there? What's happening while I'm
  there?

This conceptual model should be part of the architecture, not just the
pitch.

Crossed with the three layers, this becomes a 3×3 model — arguably more
fundamental to the architecture than Me/People/Now alone, since it's what
keeps the product from needing nine separate screens. It's one conceptual
model, not nine features:

|            | Past             | Now              | Future            |
| ---------- | ---------------- | ---------------- | ----------------- |
| **Me**     | Places I've been | Where I am       | Upcoming trips    |
| **People** | Who I met        | Who's nearby     | Who will be there |
| **Now**    | What I attended  | What's happening | What's scheduled  |

(The Now-row × Now-column cell is deliberately the same word twice — that
intersection literally means "what's happening right now.")

Most mapping products represent _where_. Pin Map represents **where +
when** — which is what lets it answer "what happened here?" (past),
"what's happening here?" (now), and "what will happen while I'm here?"
(future) as the same question asked at different points on one axis,
rather than three unrelated features.

## Don't build a generic social network

If messages, followers, public feeds, random people nearby, dating, likes,
or influencers get added, Pin Map becomes Radiate/Facebook-lite — and
inherits their moderation and network-effect problems.

The social graph should have context: _we graduated together, we worked
together, we traveled together, we attended this event, we met here._
That's distinctive. Ten million random people isn't the goal — 40
meaningful people may be more valuable.

Concretely, this means no generic `user follows user` edge in the data
model either — every connection should carry the reason it exists. Full
schema and example in `plan.md` §1.2.

## Don't make the heat map the product either

Heat is a visualization — useful, cool, but "heat map of concerts" is
copyable in weeks. The moat isn't a Mapbox heat layer. It's the data
relationship:

```
USER
 ├── HISTORY
 ├── FUTURE TRAVEL
 ├── PEOPLE
 ├── INTERESTS
 └── BEHAVIOR

EVENT
 ├── LOCATION
 ├── TIME
 ├── INVENTORY
 ├── PRICE HISTORY
 └── DEMAND

CONNECTION
 ├── PERSON
 ├── PLACE
 ├── EVENT
 └── MEMORY
```

Difficult to reproduce once accumulated.

## The product promise

**Know what's happening wherever life takes you.** (Commercial.)

**And remember who was there.** (Emotional.)

Together: **Pin Map — Know what's happening wherever life takes you, and
remember who was there.** Much closer to a real company than "collaborative
travel map."

## What to measure

Not DAU — this isn't TikTok, and optimizing for daily opens would push the
product toward exactly the feed/notification patterns "Don't build a
generic social network" above rules out.

Milestone 1's actual near-term signal is simpler than a graph metric: did
someone add a new photo, memory, or meetup 60+ days after the reunion date
— not just log in. That's still no new instrumentation to build: photos,
memories, and meetups already carry `created_at`, so it's a query against
data that already exists once Milestone 1 is underway, not a raw
login/auth-timestamp check.

**Life Graph Density** is the longer-term metric this graduates into, once
there's more than one reunion's worth of data to make it meaningful.
Canonical name: **Life Graph Density**, tracked as **Meaningful Connections
per User** — the count of _cross-type_ links a user has accumulated (a
place tied to a person, a person tied to an event, a memory tied to a
place), not a raw pin count. A user with 300 pins and nothing else attached
to any of them has a shallow graph even though every pin is technically a
place-connection; a user with 40 places where 18 are also tied to a person,
12 to an event, and 14 carry a memory has a denser, more valuable graph
with far fewer total pins. The hypothesis to test: retention tracks graph
density, not raw activity. This gets built once Milestone 2 is in view and
there's a second group's data to compare against — not before (`plan.md`
§1.5).

## What to build next (reduced roadmap)

See "Sequencing" below for why this list's _commercial_ form doesn't start
before Milestone 3 (item 4's classmate-scoped precedent is scheduled sooner,
per build order item 18 — not built yet either, just not gated on
Milestone 3). Read this list as "what Milestone 3 eventually pilots," not a
current to-do list.

1. **Personal future travel dates.** Uses `timeline_event`'s existing
   `event_date`/`event_end_date` (`plan.md` §3), not a separate
   `arrive_at`/`leave_at` pair. This is a genuine Milestone 3 prerequisite
   — the funnel there starts with "trip created," and this is what creates
   one. Not the same thing as Crossing Paths' classmate-proximity dates
   (`plan.md` §9), which serve a different, separately-scheduled purpose
   (see item 4 below).
2. **Live events around current/future locations.** Not every feature —
   just: _"You're in NYC October 8–12. Here are the genuinely interesting
   things happening."_ Genuinely new infrastructure, deferred to Milestone
   3 (`plan.md` §1.5).
3. **Ticket intelligence.** Tag each event: Great value / Fair / Expensive.
   Depends on event inventory, pricing data, and an affiliate/marketplace
   relationship that doesn't exist yet — an open business-development
   question to resolve before attempting this (see `plan.md` §18's note:
   it's a precondition for entering Milestone 3, not a scheduled build
   task).
4. **People intersection.** _"3 people you know are nearby."_ This is
   where Pin Map starts to feel magical. The classmate-scoped version is
   scheduled as part of Crossing Paths' "who's around?" workflow (`plan.md`
   §9, build order item 18 — not built yet, but not gated on Milestone 3
   either); the commercial/general-public version is what's deferred here.
5. **Automatic memory creation afterward.** _"You attended a show with
   Michelle in Brooklyn on Oct 10. Add it to your map?"_ This creates the
   permanent history.

Everything else already planned — reunion replay, migration maps, Then/Now,
photo books, QR badges (see [plan.md](plan.md) / [todo.md](todo.md)) — is
an extension of this core, not a separate direction.

## Sequencing: reunion work stays first

This roadmap is the long-term commercial direction, but it isn't the
near-term execution order — `todo.md`'s reunion-first build order stands.
Reason: the reduced roadmap above (live-event discovery, ticket
intelligence, people-intersection) is a cold start with no users to test
against. The reunion side isn't — `belding1989` has roughly **80 active
classmates who already reconnect every other year**. That's a warm,
recurring, known user base to build and validate against right now, not a
hypothetical one to acquire later.

It also exercises the "Paid groups" revenue stream's pricing and packaging
operationally (§ Where the money comes from — the `$99–299 per event/group`
case) — though, per the gap noted below, that's rehearsal, not proof that
groups will actually pay.

**Until there are outside groups, reunion classmates ARE the whole current
market** — not a beachhead sitting alongside some other active user base.
That cuts the other way too: it's a reason _not_ to build the NOW/commerce
layer (live-event discovery, ticket intelligence) yet either. That layer's
"real customers" — people discovering concerts/events wherever their travel
takes them — don't exist in the product yet. Building it now would be
building for a market that isn't there, which is exactly the kind of
speculative build this project avoids elsewhere. It becomes worth building
once outside groups (a second class, a family reunion, an alumni org)
actually broaden the user base past "one reunion's classmates" — not
before.

Practical implication: keep executing `todo.md` as written (class tenancy →
role-based admin → `timeline_event` → QR badge), with `pin-map-ios` work
running in parallel rather than after it (`plan.md` §18). Treat this doc's
roadmap as what the reunion work is _building toward architecturally_ —
the `timeline_event` model, the People layer, and eventually trip
dates/discovery should all be designed so the reunion feature and this
broader vision are the same product growing outward, not two products to
reconcile later.

One gap in the reasoning above: Belding proving out the People/Memory
concept does **not** by itself validate that groups will pay $99–299 for
it. Joel is effectively both the organizer and the product owner, and the
group already existed before the product did — that's a perfect testing
population, not a paying customer. The milestones below make that
distinction concrete.

## Milestones

### Milestone 1 — Belding becomes excellent

Not proving scale — proving that the People/Memory concept produces real
behavior:

```
classmates return
update photos
update locations
record meetups
look at other people
contribute memories
use mobile
come back after the actual reunion
```

The last one matters most. If everyone disappears after reunion weekend,
that's excellent event software. If people keep returning months later —
concretely, at least one new photo, memory, or meetup added 60+ days after
the reunion date, not just an idle login — that's the beginning of the memory network
this product is actually betting on.

### Milestone 2 — Group #2 test

This is the crucial experiment, not Milestone 1 and not "1,000 users" or
nationwide marketing. The question it answers:

> Can someone who isn't Joel create a group, populate it, invite people,
> get engagement, and consider it worth paying for?

Success means an outside organizer can, with no custom database edits, no
Joel-specific code, no hardcoded admin, and no manual rescue for normal
setup:

```
create a group
import a roster
invite members
collect current photos/location information
use meetup/memory functionality
administer access
get meaningful participation (proxy: a majority of members who joined —
  not invited, joined — log at least one meetup or memory)
pay, or demonstrate credible willingness to pay (a signed agreement, a
  deposit, or an accepted invoice — "pay" does not require building
  checkout/billing infrastructure first; `plan.md` §1.5 still applies to
  Milestone 2 itself)
```

`plan.md` §2 already treats class-tenancy/RLS as an immediate architectural
priority, ahead of proof it's needed — an intentional exception to §1.5,
made because Milestone 2 depends on it entirely. This is where that bet pays
off or doesn't: if Milestone 2 passes, the reunion system stops being a
custom Belding application and becomes a product.

### Milestone 3 — One commercial intersection

Only after Milestone 2. "Milestone 3" covers two steps, not one: first
build items 1–2–3 above (trip dates, live-event discovery, ticket
intelligence — the actual entry gate), then run the pilot below using
them. Item 4 doesn't gate entry, since its classmate-scoped form is
separately scheduled via Crossing Paths (`plan.md` §9) rather than tied to
this milestone — though the general/commercial version this pilot needs is
still new work, same as items 1–3.

> You're visiting New York Oct 8–12. See what's happening.

Measured as a funnel: trip created → events viewed → event opened → price
checked → ticket clicked → transaction. That funnel is what tells you
whether commerce can actually pay for Pin Map, rather than assuming it will
because this document says it should. The funnel's instrumentation, like
Life Graph Density above, gets built when Milestone 3 is actually being
attempted (`plan.md` §1.5) — not stood up speculatively while still on
Milestone 1.
