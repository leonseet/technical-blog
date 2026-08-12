# Tracker contract

!`cat docs/agents/issue-tracker.md`

!`cat docs/agents/sandbox-rules.md`

Build a hand-QA menu for `{{BASE_BRANCH}}...{{RUN_TIP}}`.

Read the complete diff and the implementation-ticket threads it lands, then
pick the 3–8 checks a human reviewer should run to judge whether the changes
are good, ordered most-load-bearing first. Each check proves one user-visible
behavior — the heading says what it proves, not what command it runs. Skip
filler the test suite already proves; refactor-only changes belong under
`Not covered`, not in the menu.

Verify before you write: run each runnable check in this worktree and paste
what you actually observed as its expectation. A check you cannot run here
(browser click-throughs, hardware) is allowed but must be marked
`⚠️ unverified`; for those, replace `Run` with numbered click steps and
describe the expected screen under `Expect`.

Post the menu on merge ticket #{{MERGE_TICKET}} as one comment, exactly once:

````markdown
## QA MENU

### 1. <behavior this check proves> (#<implementation ticket>) — ✅ verified
Run:
```bash
<command>
```
Expect:
```text
<observed output, trimmed to the stable excerpt that proves the behavior —
no timestamps, ids, durations, or log noise>
```

Not covered: <changes deliberately left un-QA'd, and why>
````

Rules:

- Commands run from the repo root as-is. Inline any helper script in the
  command itself (`python -c`, heredoc); never reference a file you created —
  the worktree is reset after this step, so such a file will not exist for the
  reviewer.
- Do not commit anything.

End with `<promise>COMPLETE</promise>`.
