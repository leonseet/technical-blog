# Sandbox rules

- Never run any `git worktree` subcommand.
- To inspect or run another branch's tree: `git archive <branch> | tar -x -C "$(mktemp -d)"`
- For merge experiments or other real-repo operations: `git clone --shared . "$(mktemp -d)" -b <branch>`
- Clean up scratch directories with `rm -rf`.
