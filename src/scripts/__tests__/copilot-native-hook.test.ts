import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Resolves to dist/scripts/copilot-native-hook.js since this test runs from
// dist/scripts/__tests__/copilot-native-hook.test.js.
const HOOK_SCRIPT = resolve(HERE, "..", "copilot-native-hook.js");

interface SpawnOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runHook(
  args: string[],
  stdinJson: string | null,
): SpawnOutcome {
  const result = spawnSync("node", [HOOK_SCRIPT, ...args], {
    input: stdinJson ?? "",
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function makeTmpCwd(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "omghc-native-hook-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test(
  "invoking with no event arg exits with code 2",
  { concurrency: false },
  () => {
    const out = runHook([], "{}");
    assert.equal(out.status, 2, `expected exit 2, got ${out.status}`);
    assert.match(
      out.stderr,
      /Usage:/,
      "stderr should contain usage hint",
    );
  },
);

test(
  "sessionStart with valid stdin JSON returns { additionalContext } shape",
  { concurrency: false },
  (t) => {
    const cwd = makeTmpCwd(t);
    const payload = JSON.stringify({
      timestamp: Date.now(),
      cwd,
      source: "startup",
    });
    const out = runHook(["sessionStart"], payload);
    assert.equal(
      out.status,
      0,
      `expected exit 0, got ${out.status}; stderr=${out.stderr}`,
    );
    const parsed = JSON.parse(out.stdout) as Record<string, unknown>;
    assert.ok(
      "additionalContext" in parsed,
      "sessionStart response must contain additionalContext field",
    );
    assert.equal(
      typeof parsed.additionalContext,
      "string",
      "additionalContext must be a string",
    );
  },
);

test(
  "preToolUse with a known-safe tool returns permissionDecision: allow",
  { concurrency: false },
  (t) => {
    const cwd = makeTmpCwd(t);
    const payload = JSON.stringify({
      timestamp: Date.now(),
      cwd,
      toolName: "shell",
      toolArgs: { command: "echo hello" },
    });
    const out = runHook(["preToolUse"], payload);
    assert.equal(
      out.status,
      0,
      `expected exit 0, got ${out.status}; stderr=${out.stderr}`,
    );
    const parsed = JSON.parse(out.stdout) as {
      permissionDecision: string;
    };
    assert.equal(
      parsed.permissionDecision,
      "allow",
      "safe command must be allowed",
    );
  },
);

test(
  "preToolUse with `rm -rf /` returns permissionDecision: deny",
  { concurrency: false },
  (t) => {
    const cwd = makeTmpCwd(t);
    const payload = JSON.stringify({
      timestamp: Date.now(),
      cwd,
      toolName: "shell",
      toolArgs: { command: "rm -rf /" },
    });
    const out = runHook(["preToolUse"], payload);
    assert.equal(
      out.status,
      0,
      `expected exit 0, got ${out.status}; stderr=${out.stderr}`,
    );
    const parsed = JSON.parse(out.stdout) as {
      permissionDecision: string;
      permissionDecisionReason?: string;
    };
    assert.equal(
      parsed.permissionDecision,
      "deny",
      "rm -rf / must be denied",
    );
    assert.ok(
      typeof parsed.permissionDecisionReason === "string" &&
        parsed.permissionDecisionReason.length > 0,
      "deny decision must include a reason",
    );
  },
);
