!`cat docs/agents/sandbox-rules.md`

Invoke `/simplify` over `{{BASE_BRANCH}}...{{RUN_TIP}}`.

Every commit in that range has already passed code review. You are removing
duplication and dead altitude, not redesigning: no observable behavior may
change, including numeric output bit-for-bit. If a cleanup would alter behavior,
skip it and say so rather than adjudicating it yourself.

Then run `{{VERIFY_COMMAND}}`. Every test must pass before you finish — fix whatever your
own cleanup broke. If a failure predates your changes, leave it alone and say so.

Leave a clean worktree, and any change as exactly one visible commit. Make one
pass; do not keep hunting for further cleanups after that commit.

On merge ticket #{{MERGE_TICKET}}, post `POST MERGE CLEANUP` exactly once, with
the commit (or `no changes`), summary, and verification.

End with `<promise>COMPLETE</promise>`.
