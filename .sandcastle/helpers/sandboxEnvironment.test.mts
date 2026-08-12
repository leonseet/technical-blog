import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  codingProviderOptions,
  codingSandbox,
  mountsIfPresent,
  setupHook,
  trackerSandbox,
} from "./sandboxes.mts";
import {
  SANDBOX_NETWORK,
  SANDBOX_SETUP_COMMANDS,
} from "../implement/config/knobs.mts";

test("network mode follows the knob's platform auto-detection", () => {
  assert.equal(codingProviderOptions.network, SANDBOX_NETWORK);
  assert.equal(
    SANDBOX_NETWORK,
    process.platform === "linux" ? "host" : "bridge",
  );
  assert.equal(codingProviderOptions.env, undefined);
});

test("mounts are taken only when their host source exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-mounts-"));
  try {
    const present = {
      hostPath: dir,
      sandboxPath: "/present",
      readonly: true,
    };
    const absent = {
      hostPath: path.join(dir, "missing"),
      sandboxPath: "/absent",
      readonly: true,
    };
    assert.deepEqual(mountsIfPresent([present, absent]), [present]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("every configured mount's source exists, so Docker never creates one as root", () => {
  for (const mount of codingProviderOptions.mounts ?? []) {
    assert.ok(
      fs.existsSync(mount.hostPath),
      `mount source missing: ${mount.hostPath}`,
    );
  }
});

test("the worktrees dir is mounted read-only at its host path for prune safety", () => {
  const worktreesDir = path.join(process.cwd(), ".sandcastle", "worktrees");
  assert.deepEqual(
    (codingProviderOptions.mounts ?? []).filter(
      (mount) => mount.hostPath === worktreesDir,
    ),
    [{ hostPath: worktreesDir, sandboxPath: worktreesDir, readonly: true }],
  );
});

test("a setup command gets one bounded retry", () => {
  assert.deepEqual(setupHook("cd backend && uv sync --frozen"), {
    command:
      "timeout 180 sh -c 'cd backend && uv sync --frozen' || timeout 180 sh -c 'cd backend && uv sync --frozen'",
    timeoutMs: 370_000,
  });
});

test("both bundles share one provider; only the coding bundle runs setup commands", () => {
  assert.equal(trackerSandbox.sandbox, codingSandbox.sandbox);
  const trackerHooks = trackerSandbox.hooks.sandbox?.onSandboxReady ?? [];
  const codingHooks = codingSandbox.hooks.sandbox?.onSandboxReady ?? [];
  assert.deepEqual(codingHooks, [
    ...trackerHooks,
    ...SANDBOX_SETUP_COMMANDS.map(setupHook),
  ]);
  assert.doesNotMatch(
    JSON.stringify(codingSandbox.hooks),
    /pnpm install|config\.toml|host-codex/,
  );
});

test("codex auth travels only when the host is logged in", () => {
  const hostAuth = path.join(os.homedir(), ".codex", "auth.json");
  const hooks = trackerSandbox.hooks.sandbox?.onSandboxReady ?? [];
  if (fs.existsSync(hostAuth)) {
    assert.deepEqual(hooks, [
      {
        command:
          'mkdir -p "/home/agent/.codex" && cp "/home/agent/.codex-host-auth.json" "/home/agent/.codex/auth.json"',
      },
    ]);
  } else {
    assert.deepEqual(hooks, []);
  }
});
