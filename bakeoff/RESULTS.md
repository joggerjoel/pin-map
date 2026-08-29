# Bakeoff Results — superpowers vs pstack (2026-08-29)

Task: rich paste parser core (`src/lib/pasteParser.ts`), identical spec, same
model, same base commit (4eade1a), isolated worktrees. Gates and decision rule
written before either arm ran (see GATES.md, judge-rubric.md).

## Measured outcomes

| Measure                 | Arm S (superpowers)  | Arm P (pstack)       |
| ----------------------- | -------------------- | -------------------- |
| Held-out gates (12)     | **12/12**            | **12/12**            |
| Blind judge total (/25) | **22** (Candidate B) | **21** (Candidate A) |
| — Correctness risk      | 4                    | 3                    |
| — Simplicity            | 4                    | 5                    |
| — Reuse                 | 5                    | 5                    |
| — Type design           | 4                    | 4                    |
| — Test quality          | 5                    | 4                    |
| Subagent tokens         | **64,175**           | 74,619               |
| Wall-clock              | **209 s**            | 235 s                |
| Tool uses               | **13**               | 18                   |
| Impl + test lines       | 122 + 293 = 415      | **96 + 198 = 294**   |
| Own tests written       | 36                   | 27                   |
| Full suite + tsc        | clean                | clean                |

## Judge's confirmed findings (blind)

- **pstack arm — real latent bug, triggerable today:** its `extractPeople`
  re-tokenizes/re-joins every line, collapsing internal whitespace
  (`"New  York"` → `"New York"`), diverging from the delegated
  `resolvePlainLineName` semantics. The held-out gates didn't catch it.
- **superpowers arm — latent design flaw, dead today:** a defensive try/catch
  fabricates a plain-name result if the (currently non-throwing) pipeline ever
  throws — converts a loud future failure into a silent wrong answer.
  Violates fail-fast / no-silent-error-swallowing.
- Both arms independently chose the same architecture: thin composition over
  the existing modules. The process changed details and tests, not the design.

## Decision rule applied (verbatim from judge-rubric.md)

1. Gates: 12 vs 12 — tie.
2. Judge totals: 22 vs 21 — within 2 points → tie per rule 3.
3. Cheaper arm wins. Wall-clock: S (209 s < 235 s). Tokens: S (64k < 75k).
   Diff size: P (294 < 415 lines, though 95 of S's extra lines are the tests
   the judge scored 5/5). Two of three cost measures favor S.

**Verdict: Arm S — superpowers — wins the tiebreak, narrowly.**

## Scope limits (pre-committed)

One pilot, one task class (feature-sized pure-logic module with a fixed spec,
single agent, same model). It does NOT measure: pstack's fan-out tools
(arena/swarm/interrogate were not exercised — this was pstack's _principles_
arm only), open-ended design tasks where arena should differentiate, debugging
tasks, or multi-model panels. The honest summary is **statistical tie with a
cost edge to superpowers on spec-driven implementation work** — consistent
with the static assessment that pstack's depth pays off on _open_ problems,
not fixed-spec ones.

## Artifacts

- Arms (uncommitted, inspectable): `.claude/worktrees/bakeoff-arm-s`,
  `.claude/worktrees/bakeoff-arm-p` (branches bakeoff-arm-s / bakeoff-arm-p)
- Held-out gates: bakeoff/gates.pasteParser.test.ts (12/12 in both worktrees)
- Blind candidates as judged: bakeoff/judge/
- Judge transcript summary: recorded above; scores unaltered.
