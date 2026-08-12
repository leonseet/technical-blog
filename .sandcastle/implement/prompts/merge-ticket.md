# Tracker contract

!`cat docs/agents/issue-tracker.md`

Find or create the one open, unlabeled merge ticket for `{{RUN_TIP}}`:

Title: `Merge {{RUN_TIP}} into {{BASE_BRANCH}}`

Body:
```
Run tip: {{RUN_TIP}}
Target: {{BASE_BRANCH}}
```

Reuse an existing ticket with that exact Run tip. Return
`<merge-ticket>{"number":42}</merge-ticket>`.
