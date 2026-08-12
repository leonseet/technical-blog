# Tracker contract

!`cat docs/agents/issue-tracker.md`

Create or update the single open integration change request from `{{RUN_TIP}}`
to `{{BASE_BRANCH}}`, using whichever surface the tracker contract above names.
Read git history, ancestry, the complete diff, relevant
implementation-ticket threads, merge ticket #{{MERGE_TICKET}} and its full thread,
and any existing change request.

The explainer is hosted at `{{EXPLAINER}}` (a URL, or `omitted` when the step
degraded). Include it in the change request as a clickable link; fetching its
content is optional.
Git alone proves landed tickets; only proven ancestors get `Closes #n`.
Also include `Closes #{{MERGE_TICKET}}`.

Synthesize `Digest`, `Tickets`, `Left out`, and `Review`. Carry the `QA MENU`
comment from the merge ticket thread into the change request body verbatim as
a `QA` section; when there is none, write `QA: absent`. Include `Integration
notes` only when supported by a `MERGE NOTE` or a notable integration or
cleanup decision. Mark NOT APPROVED when the evidence disagrees with itself or
when a required step degraded; `qa` is advisory — its degradation alone never
causes NOT APPROVED. Steps that degraded, one per line, or `none`:

```text
{{FAILURES}}
```

Never close implementation tickets directly.

Create or update the change request exactly once.

End with `<promise>COMPLETE</promise>`.
