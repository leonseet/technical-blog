import { git, mainWorktreeRoot } from "../helpers/git.mts";
import { logger } from "../helpers/log.mts";
import {
  isMergeBranch,
  parseIssueBranch,
  removeBranchWorkspace,
} from "./stages/planWave.mts";

const log = logger();
const root = mainWorktreeRoot(process.cwd());
const branches = git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads")
  .split("\n")
  .filter(
    (branch) => parseIssueBranch(branch) !== null || isMergeBranch(branch),
  );

for (const branch of branches) {
  log.step(`removing ${branch}`);
  removeBranchWorkspace(root, branch);
}
log.ok(`removed ${branches.length} implement-loop branch(es) and worktree(s)`);
