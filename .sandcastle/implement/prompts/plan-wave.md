# Tracker contract

!`cat docs/agents/issue-tracker.md`

# Label vocabulary

!`cat docs/agents/triage-labels.md`

Plan one implementation wave against `{{RUN_TIP}}`.

Scope: {{SCOPE}}

Read every open `ready-for-agent` candidate and its full thread; newer comments
win. The explicit scope includes named issues and their children only. Exclude
blocked work after checking code dependencies, file overlap, spec/API
dependencies, and parent/child double work. Never emit a blocked fallback.

Return only:

<plan>{"issues":[42,17]}</plan>
