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
bond is worth more than squeezing another $4.99/month out of them.

## The unique core

Most competitors own one piece:

- **FindPenguins** — where I went
- **Radiate** — where people/events are happening
- **Bandsintown** — what shows I might like
- **Facebook** — people I know
- **Ticket marketplaces** — tickets I can buy

Pin Map can connect them:

**Where I've been → where I'm going → who I know there → what's happening
there → whether it's worth going.**

That combination is the moat.

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

## Where the money comes from

Deliberately avoid depending primarily on subscriptions.

### 1. Transaction revenue

Live entertainment discovery creates ticket purchases — potentially the
largest revenue source, since Pin Map is already economically involved in
ticket markets. Surface "Great deal tonight — $42," someone buys. Revenue
through: inventory, affiliate/referral economics, marketplace
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
business model. A 40-year reunion book generated automatically from
then/now portraits, where everyone lives, reunion photos, memories, and
the meetup map could sell extremely well — but it's ancillary revenue.

## The killer loop

Not isolated features — a sequence:

1. You add a trip: **New York — October 8–12**.
2. Pin Map: _"You're going to New York."_
3. _"6 people you know are there."_
4. _"23 live events match your interests during your trip."_
5. _"Two have unusually good ticket prices."_
6. _"Lana is 1.8 miles from one of them."_
7. Afterward: _"Add this night to your trip?"_ — tap yes.
8. The show, person, photographs, and location permanently join your life
   map.

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

## Don't build a generic social network

If messages, followers, public feeds, random people nearby, dating, likes,
or influencers get added, Pin Map becomes Radiate/Facebook-lite — and
inherits their moderation and network-effect problems.

The social graph should have context: _we graduated together, we worked
together, we traveled together, we attended this event, we met here._
That's distinctive. Ten million random people isn't the goal — 40
meaningful people may be more valuable.

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

## What to build next (reduced roadmap)

1. **Personal future travel dates.** A pin/trip needs `arrive_at` /
   `leave_at`. This is the bridge to commercial discovery.
2. **Live events around current/future locations.** Not every feature —
   just: _"You're in NYC October 8–12. Here are the genuinely interesting
   things happening."_
3. **Ticket intelligence.** Tag each event: Great value / Fair / Expensive.
4. **People intersection.** _"3 people you know are nearby."_ This is
   where Pin Map starts to feel magical.
5. **Automatic memory creation afterward.** _"You attended Fred again with
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

It also doubles as the first real test of the "Paid groups" revenue stream
above (§ Where the money comes from) — a live reunion is close to exactly
the `$99–299 per event/group` case described there, not just a features
testbed.

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
`timeline_event` → QR badge / reunion mobile work). Treat this doc's
roadmap as what the reunion work is _building toward architecturally_ —
the `timeline_event` model, the People layer, and eventually trip
dates/discovery should all be designed so the reunion feature and this
broader vision are the same product growing outward, not two products to
reconcile later.
