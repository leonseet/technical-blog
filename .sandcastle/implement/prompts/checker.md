# Tracker contract

!`cat docs/agents/issue-tracker.md`

!`cat docs/agents/sandbox-rules.md`

Invoke `/code-review` for issue #{{TASK_ID}} using `{{RUN_TIP}}` as the fixed point and `{{BRANCH}}` as the committed branch. You are read-only on the branch; your writes are to the tracker.

Review to full depth on this pass. Every later pass costs another maker run, so raising one blocker now and a deeper one next round is expensive.

The maker ran `{{VERIFY_COMMAND}}` before committing and the fold re-runs it before this branch lands, so do not re-run the full suite. Run targeted commands only to verify a specific claim you doubt.

The acceptance-criteria checklist in the issue description is the standing record of what is settled. Tick every criterion this branch now meets by flipping `- [ ]` to `- [x]` and change nothing else.

Post exactly one verdict comment:

```
CHECKER FAIL

- **AC3** — <what fails, where, and what would fix it>
- **AC7** — ...

Met and re-verified: AC1, AC2, AC4–AC6.

## Blocking

- <finding the maker must fix>

## Non-blocking

- <finding worth recording>
```

or:

```
CHECKER PASS

- **AC1** — <how it was verified>
- **AC2** — ...

## Non-blocking

- <surviving finding worth recording>
```

On FAIL, write a detailed entry only for criteria that fail or are partial; compress the rest into the single `Met and re-verified:` line. The Blocking list is the maker's work list for the next pass. On PASS, keep each AC entry to one line. In both verdicts, write every review finding as a one-line bullet — a pointer to the problem and its location, not a paragraph.

On FAIL leave `ready-for-agent`. On PASS replace it with `in-review`.

Return `<review>{"approved":true}</review>`, or `false` on failure.
