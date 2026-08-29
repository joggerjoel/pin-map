# Skills Review & Recommended Workflow — pin-map

Reviewed 2026-08-29. Covers the skills currently installed globally + via plugins,
which ones matter for this project, where they overlap, and the canonical workflow
for a typical pin-map task.

Project shape: React 18 + TypeScript + Vite + Mapbox + Supabase frontend, Bun +
vitest, Ansible deploys (prod + review slot), plus scraper/capture side-work
(StubHub MITM capture, backfill scripts).

---

## 1. The Canonical Workflow

Process skills (superpowers) set the _order_; capability skills fill each phase.

```
IDEA ──► superpowers:brainstorming
              │
PLAN ──► superpowers:writing-plans        (multi-step work; skip for one-liners)
              │
BUILD ─► superpowers:test-driven-development
         + typescript-best-practices      (any .ts/.tsx edit)
         + design skills (see §3)         (any UI-touching change)
              │
DEBUG ─► superpowers:systematic-debugging (any bug/unexpected behavior — BEFORE fixing)
              │
VERIFY ► verify                           (typecheck + test + lint + build)
         superpowers:verification-before-completion
              │
REVIEW ► review-changes                   (uncommitted diff, pre-commit)
         /code-review                     (PRs / committed work)
              │
SHIP ──► commit-commands:commit / commit-push-pr
         superpowers:finishing-a-development-branch
```

Phase-by-phase:

| Phase            | Skill                                                                      | When                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Idea             | `superpowers:brainstorming`                                                | Before ANY creative work — new feature, component, behavior change. Non-negotiable per the superpowers rule.                       |
| Plan             | `superpowers:writing-plans`                                                | Multi-step tasks with a spec. Pin-map already keeps `*-plan.md` / `*-todo.md` files at repo root — write plans in that same style. |
| Plan (hardening) | `council`                                                                  | Optional: adversarial audit of a plan/spec before code, for high-stakes work (e.g. deploy changes, data-loss-risk migrations).     |
| Execute a plan   | `superpowers:executing-plans` or `superpowers:subagent-driven-development` | The former for a separate session with checkpoints; the latter to fan independent plan tasks out to subagents in-session.          |
| Build            | `superpowers:test-driven-development`                                      | Default for logic changes. Tests run via `bun run test` (vitest).                                                                  |
| Build            | `typescript-best-practices`                                                | Reading or editing any `.ts`/`.tsx` — i.e., almost always in this repo.                                                            |
| Debug            | `superpowers:systematic-debugging`                                         | Any bug, failing test, or "that's weird" moment — invoke before proposing a fix.                                                   |
| Verify           | `verify`                                                                   | Before commit/merge: typecheck, test, lint, build in one pass.                                                                     |
| Review           | `review-changes`                                                           | Uncommitted diff review (bugs, security, quality).                                                                                 |
| Ship             | `commit-commands:commit` / `commit-push-pr`                                | Commit style: match repo history (imperative, occasionally prefixed e.g. `ansible:`, `docs:`).                                     |
| Wrap up          | `superpowers:finishing-a-development-branch`                               | Merge/PR/cleanup decision, especially since this repo uses git worktrees heavily.                                                  |

Worktree note: feature work already runs in `.claude/worktrees/*` — pair
`superpowers:using-git-worktrees` (start) with
`superpowers:finishing-a-development-branch` (end).

---

## 1b. The pstack Alternative (see `~/.claude/references/workflow-skills.md` §1–2)

A second process stack lives in `~/.claude/skills/`: **poteto-mode** routes work
through 21 `principle-*` rules and delegation skills — `architect` (types-first
design), `arena` (N-candidate bakeoff + graft), `swarm` (parallel fan-out),
`interrogate` (multi-model adversarial review), `blast-radius` (what does this
diff break elsewhere), `show-me-your-work` (decision trail), `recall` (resume
context). These are user-invoked (name them or slash them); they don't appear in
the auto-invoke skill list. For pin-map they're most useful at specific points:

- `arena` — when the UI/UX shape is genuinely open (e.g. a new Browse layout).
- `blast-radius` — before shipping capture-filter or Redis/TTL changes, where a
  small diff has broken distant behavior before.
- `unlazy` + `show-me-your-work` — backfill runs and other long autonomous jobs:
  write acceptance gates first, keep a decision trail, report against the gates.
- `recall` + `claude-mem:mem-search` — resuming the StubHub investigation.

Model-per-role routing for pstack panels is configured via `setup-pstack`.

## 2. Overlap Resolutions (decided once, so we stop re-deciding)

Several capabilities have 2–4 competing skills. Defaults:

### Code review — 3 options

| Winner         | `review-changes` for uncommitted work; `/code-review` for PRs                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Also available | `pr-review-toolkit:review-pr` (multi-agent deep review — use for large/risky PRs only), `feature-dev:code-reviewer` agent, `codex:rescue` second opinion                             |
| Rationale      | `review-changes` is fast and fits the pre-commit slot; the pr-review-toolkit fan-out (test-analyzer, silent-failure-hunter, type-design-analyzer) is worth its cost only on big PRs. |

### Browser automation — 4 stacks

| Winner      | `agent-browser` CLI (per ~/.claude/CLAUDE.md tool priority)                                                                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fallbacks   | Claude in-app Browser pane for quick visual checks of the dev server; `chrome-devtools-mcp` only for network interception / performance traces / console; `claude-in-chrome` only when a real logged-in profile is needed (e.g. authenticated StubHub sessions). |
| For pin-map | `responsive-audit` is the high-value one — mobile/responsive sweep of the map UI at 4 viewport sizes with a shareable before/after page.                                                                                                                         |

### Skill authoring — 3 options

| Winner | `superpowers:writing-skills` (process discipline) with `skill-creator` for scaffolding                             |
| ------ | ------------------------------------------------------------------------------------------------------------------ |
| Also   | `plugin-dev:skill-development` only when the skill lives inside a plugin. Follow with `plugin-dev:skill-reviewer`. |

### Web scraping/fetch — many

| Winner | `firecrawl-mcp` for scraping; `context7` for library docs; `gh` CLI for GitHub                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Also   | `scrapegraph` for prompt-driven structured extraction; crawl4ai REST only if `CRAWL4AI_URL` is set. Never WebFetch when a faster authenticated tool exists. |

### Memory/history — claude-mem pack

`claude-mem:mem-search` to recall past work (the capture/backfill investigation
history lives there), `claude-mem:standup` / `timeline-report` for summaries.
Auto-memory (MEMORY.md) is for durable preferences; claude-mem is for episodic
"what did we discover about the grid endpoint" recall.

---

## 3. UI Work — the design stack (auto-invoke, per global CLAUDE.md)

Any task with ≥1% chance of touching UI invokes, in this order:

1. `ui-ux-pro-max` — vocabulary, styles, layout systems
2. `design-taste` — motion, polish, anti-slop
3. `color-strategy` — 60/30/10, OKLCH, WCAG (skip if a design system governs color)
4. Component sourcing: `react-bits` (large animated React components) or
   `uiverse` (small primitives — buttons, loaders, toggles)
5. `dataviz` — REQUIRED before any chart/graph/dashboard code

Pin-map relevance: the Browse view, photo Groups, tag filtering UI, and any
map-overlay work all qualify. React 18 stack means `react-bits` is usable.

---

## 4. Project-Specific Slots

| Task type                                | Skills                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase schema/queries                  | `supabase:supabase`, `supabase:supabase-postgres-best-practices`, `0.5.1:postgres*` pack (PostGIS design is directly relevant to a pin map)                 |
| Ansible deploy changes                   | No dedicated skill — use plan → `council` (guards around the prod/review slots are safety-critical) → `verify` → manual `--syntax-check` as done previously |
| Scraper/capture work (StubHub)           | `claude-mem:mem-search` first (deep prior findings), `superpowers:systematic-debugging` for capture filter bugs, `claude-in-chrome` for authenticated flows |
| Feature-gap tracking                     | `feature-gap-audit` — cumulative gap log vs reference projects                                                                                              |
| "How does X work" / "why is X like this" | `how` / `why`                                                                                                                                               |
| Writing docs, READMEs, plans             | `elements-of-style:writing-clearly-and-concisely` + `unslop`                                                                                                |
| Long autonomous multi-part work          | `unlazy` (acceptance gates before execution)                                                                                                                |
| Second-opinion / stuck                   | `codex:rescue` or `fusion` (/opinion, /fusion)                                                                                                              |
| Recurring checks                         | `loop` (interval runner)                                                                                                                                    |

---

## 5. Skills Reviewed and Deliberately Benched

Not wrong, just not part of the default pin-map loop:

- **n8n pack (16 skills)** — no n8n workflows in this repo.
- **printing-press pack (10)** — CLI generation for APIs; unrelated.
- **stripe / 9router / make-bot-ui / iOS simulator** — stack not present here.
- **autoresearch pack** — powerful (`:fix`, `:regression`, `:security` could
  slot into VERIFY for big efforts) but overkill for routine changes; opt in
  explicitly for e.g. a pre-release regression gate.
- **ralph-loop / babysit / cass / context-dump** — utility, on-demand only.

---

## 6. TL;DR Card

```
New feature:   brainstorm → plan → TDD (+ design stack if UI) → verify → review-changes → commit
Bug fix:       systematic-debugging → TDD (regression test) → verify → review-changes → commit
UI polish:     ui-ux-pro-max + design-taste (+ react-bits/uiverse) → responsive-audit → verify
Deploy change: plan → council → syntax-check/guard tests → verify → commit
Research:      mem-search (prior findings) → how/why → firecrawl/context7 → write up (+ unslop)
Pre-PR:        verify → review-changes → commit-push-pr
Big PR:        pr-review-toolkit:review-pr
Open design:   arena (bakeoff) instead of a single attempt
Risky diff:    blast-radius before shipping
Long backfill: unlazy (gates first) + show-me-your-work (decision trail)
```
