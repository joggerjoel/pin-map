# GATES — superpowers vs pstack bakeoff pipeline

Scope: one pilot task (rich paste parser), two arms, held-out gates, blind
judge, pre-committed decision rule. Base ref: current HEAD of
claude/skills-review-workflow-269c39.

- [x] B1 Shared task spec authored with the fixed contract
      CHECK: grep -q "parsePastedText" bakeoff/task-prompt.md && grep -q "never throw" bakeoff/task-prompt.md && echo SPEC_OK
      EXPECT: SPEC_OK

- [x] B2 Held-out gate test authored BEFORE arms ran, and RED against base (no pasteParser exists)
      CHECK: test ! -f src/lib/pasteParser.ts && grep -c "it(\"G" bakeoff/gates.pasteParser.test.ts
      EXPECT: 12

- [x] B3 Arm S (superpowers) implementation passes held-out gates in its worktree
      CHECK: cd ../bakeoff-arm-s && bun run vitest run src/lib/pasteParser.gates.test.ts 2>&1 | tail -5
      EXPECT: 12 passed

- [x] B4 Arm P (pstack) implementation passes held-out gates in its worktree
      CHECK: cd ../bakeoff-arm-p && bun run vitest run src/lib/pasteParser.gates.test.ts 2>&1 | tail -5
      EXPECT: 12 passed

- [x] B5 Blind judgment collected per rubric (judge sees unlabeled diffs only) — MANUAL
      Evidence: judge agent transcript summary recorded in bakeoff/RESULTS.md

- [x] B6 Decision rule from judge-rubric.md applied verbatim; verdict + scope limits reported — MANUAL
      Evidence: bakeoff/RESULTS.md verdict section quotes the rule and the measured numbers
