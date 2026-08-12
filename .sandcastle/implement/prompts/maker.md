# Tracker contract

!`cat docs/agents/issue-tracker.md`

!`cat docs/agents/sandbox-rules.md`

Implement issue #{{TASK_ID}} on `{{BRANCH}}`, based on `{{RUN_TIP}}`. Read the full thread; newer comments win. Use `/tdd`, treating the acceptance criteria as the agreed seams, and `/writing-commit`.

This is maker pass {{CYCLE}}. On pass 1, create exactly one non-empty ticket commit. On later passes, amend that same commit to address the findings in the most recent `CHECKER FAIL` comment on the thread — stage the edits first (`git add <files> && git commit --amend --no-edit`).

Before every commit or amend, run `{{VERIFY_COMMAND}}`. It must pass.

Leave a clean worktree exactly one commit ahead of the run-tip base. Never change labels or close the issue.

Close every pass with one note. On pass 1, walk the acceptance criteria:

```
MAKER NOTES

- **AC1** — <brief reasoning that it is met>
- **AC2** — …

<test/lint evidence and commit SHA>
```

On later passes, do not restate the acceptance criteria — the checker re-verifies them all anyway. Write one bullet per checker finding addressed (what changed, where), then the same evidence and commit SHA:

```
MAKER NOTES

- <finding> — <what changed, where>
- …

<test/lint evidence and commit SHA>
```

On the ticket, you can only comment and never edit the description.

End with `<promise>COMPLETE</promise>`.
