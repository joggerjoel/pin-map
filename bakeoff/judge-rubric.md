# Blind Judge Rubric + Pre-Committed Decision Rule

Written BEFORE either arm ran. The judge receives two unlabeled diffs
("Candidate A", "Candidate B") of `src/` changes only — no DESIGN-NOTES, no
process artifacts, no stack identification.

## Judge scoring (1–5 each)

1. **Correctness risk** — likelihood of latent bugs beyond the acceptance
   tests: edge handling, ordering assumptions, regex fragility.
2. **Simplicity** — smallest change that solves the problem; no speculative
   abstraction; readable without archaeology.
3. **Reuse** — appropriate use of the existing modules (datePrefix,
   explicitCoords, checklist, plainLineName) vs unjustified reimplementation.
4. **Type design** — illegal states unrepresentable; contract types used well.
5. **Test quality (their own tests)** — meaningful cases, edge coverage, not
   just happy-path mirrors of the implementation.

## Decision rule (pre-committed — no post-hoc adjustment)

1. **Primary:** held-out gates passed (out of 12). More gates passed wins.
2. **Tie on gates:** higher blind-judge total (out of 25) wins.
3. **Judge totals within 2 points:** tie — the cheaper arm (wall-clock, and
   diff size as proxy for review cost) wins.
4. The winner's stack is recorded in workflow-skills.md §4b as the measured
   default for feature-sized pure-logic tasks; the loser keeps its on-demand
   roles. One pilot does not generalize beyond this task class — record scope.
