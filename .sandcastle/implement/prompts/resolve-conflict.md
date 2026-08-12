!`cat docs/agents/sandbox-rules.md`

Resolve the active rebase conflict while folding `{{BRANCH}}` onto
`{{RUN_TIP}}`. Invoke `/resolving-merge-conflicts`. Read the relevant ticket
threads and preserve both intentions where compatible. Run configured checks,
complete the rebase (`git rebase --continue` until none remains), and leave a
clean worktree. Do not change tracker state.

End with `<promise>COMPLETE</promise>`.
