import { z } from "zod";

import { PLAN_WAVE_AGENT } from "../config/agents.mts";
import { gitResult, releaseBranchWorktrees } from "../../helpers/git.mts";
import type { ImplementContext } from "../context.mts";
import type { RunTip } from "../index.mts";

export const planSchema = z
  .object({ issues: z.array(z.number().int().positive()) })
  .strict();

export type PlannedIssue = z.infer<typeof planSchema>["issues"][number];
export type WavePlan = z.infer<typeof planSchema>;

export {
  issueBranch,
  parseIssueBranch,
  isMergeBranch,
} from "../naming.mts";

export function removeBranchWorkspace(repoRoot: string, branch: string): void {
  releaseBranchWorktrees(repoRoot, branch);
  // The branch may already be absent after manual cleanup.
  gitResult(repoRoot, "branch", "-D", branch);
}

export async function planNextWave(
  tip: RunTip,
  context: ImplementContext,
): Promise<WavePlan> {
  return await context.headAgentOutput(
    {
      name: "plan-wave",
      prompt: "plan-wave",
      agent: PLAN_WAVE_AGENT,
      promptArgs: {
        RUN_TIP: tip.branch,
        SCOPE:
          context.ids.length === 0
            ? "all eligible issues"
            : `${context.ids.join(", ")} and their children only`,
      },
    },
    "plan",
    planSchema,
  );
}
