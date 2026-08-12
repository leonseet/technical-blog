// Shared coding-agent, Docker-provider, and sandbox-hook configuration.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as sandcastle from "@ai-hero/sandcastle";
import { type CodingAgentConfig } from "../implement/config/agents.mts";
import {
  SANDBOX_NETWORK,
  SANDBOX_SETUP_COMMANDS,
} from "../implement/config/knobs.mts";
import { mainWorktreeRoot } from "./git.mts";
import {
  docker,
  type DockerOptions,
} from "@ai-hero/sandcastle/sandboxes/docker";

/** Mounted read-only at its host path so a `git worktree prune` run inside a
 *  sandbox sees every registered checkout as present and deletes nothing.
 *  Docker creates a missing bind source as root, so ensure it exists first. */
const worktreesDir = path.join(
  mainWorktreeRoot(process.cwd()),
  ".sandcastle",
  "worktrees",
);
fs.mkdirSync(worktreesDir, { recursive: true });

const sandboxCodexAuth = "/home/agent/.codex-host-auth.json";
const sandboxCodexHome = "/home/agent/.codex";

type Mount = { hostPath: string; sandboxPath: string; readonly: boolean };

/** Hosts differ in what they have — Codex auth, a uv cache, a `.models` dir,
 *  system CA certs. Each mount is taken only when its source exists: Docker
 *  would otherwise create the missing source as a root-owned dir on the host,
 *  and a sandbox is better off without a cache than broken by one. */
export function mountsIfPresent(candidates: readonly Mount[]): Mount[] {
  return candidates.filter((mount) => fs.existsSync(mount.hostPath));
}

const hostCodexAuth = path.join(os.homedir(), ".codex", "auth.json");

export const codingProviderOptions: DockerOptions = {
  network: SANDBOX_NETWORK,
  mounts: mountsIfPresent([
    {
      hostPath: hostCodexAuth,
      sandboxPath: sandboxCodexAuth,
      readonly: true,
    },
    {
      hostPath: "/etc/ssl/certs",
      sandboxPath: "/etc/ssl/certs",
      readonly: true,
    },
    {
      hostPath: path.join(os.homedir(), ".cache", "uv"),
      sandboxPath: "/home/agent/.cache/uv",
      readonly: false,
    },
    {
      hostPath: path.join(os.homedir(), ".local", "share", "pnpm", "store"),
      sandboxPath: "/home/agent/workspace/.pnpm-store",
      readonly: false,
    },
    {
      hostPath: path.join(mainWorktreeRoot(process.cwd()), ".models"),
      sandboxPath: "/home/agent/workspace/.models",
      readonly: true,
    },
    {
      hostPath: worktreesDir,
      sandboxPath: worktreesDir,
      readonly: true,
    },
  ]),
};

/** One project-owned provider. Sandcastle adds `.sandcastle/.env` itself. */
const codingProvider = docker(codingProviderOptions);

/** Codex rewrites `auth.json` on refresh, so the read-only mount is copied, not
 *  used in place. Claude needs nothing here; it reads the injected `.env`.
 *  Skipped entirely on hosts without a Codex login (the mount is absent too). */
const codexAuthHooks = fs.existsSync(hostCodexAuth)
  ? [
      {
        command:
          `mkdir -p "${sandboxCodexHome}" && ` +
          `cp "${sandboxCodexAuth}" "${sandboxCodexHome}/auth.json"`,
      },
    ]
  : [];

/** A setup command gets one bounded retry: transient network failures are the
 *  common cause, and a second attempt is cheaper than a lost run. */
export function setupHook(command: string) {
  const attempt = `timeout 180 sh -c '${command}'`;
  return { command: `${attempt} || ${attempt}`, timeoutMs: 370_000 };
}

/** Hooks run once, before the long-lived sandbox is used. */
const authHooks: sandcastle.SandboxHooks = {
  sandbox: { onSandboxReady: codexAuthHooks },
};

const codingHooks: sandcastle.SandboxHooks = {
  sandbox: {
    onSandboxReady: [...codexAuthHooks, ...SANDBOX_SETUP_COMMANDS.map(setupHook)],
  },
};

/** Provider and hooks travel together so no caller can take one without the
 *  other. Only sandboxes that run repo code pay for the installs. */
export const trackerSandbox = {
  sandbox: codingProvider,
  hooks: authHooks,
} as const;

export const codingSandbox = {
  sandbox: codingProvider,
  hooks: codingHooks,
} as const;

export function codingAgent(config: CodingAgentConfig) {
  switch (config.agent) {
    case "claude":
      return sandcastle.claudeCode(config.modelId, {
        effort: config.reasoningEffort,
      });
    case "codex":
      return sandcastle.codex(config.modelId, {
        effort: config.reasoningEffort,
      });
  }
}
