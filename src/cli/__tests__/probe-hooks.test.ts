import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  probeHookWiring,
  runDoctor,
  type DoctorResult,
} from "../doctor.js";

const ENV_KEYS = [
  "COPILOT_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "COPILOT_PROVIDER_BASE_URL",
  "COPILOT_HOME",
] as const;

function isolateEnv(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "omghc-probe-hooks-test-"));
  const original: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    original[k] = process.env[k];
    delete process.env[k];
  }
  process.env.COPILOT_HOME = dir;
  t.after(() => {
    for (const k of ENV_KEYS) {
      const v = original[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

async function captureStdout<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string }> {
  const chunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, stdout: chunks.join("") };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

test(
  "runDoctor --probe-hooks --json populates hookWiringProbe field",
  { concurrency: false },
  async (t) => {
    isolateEnv(t);
    const { stdout } = await captureStdout(() =>
      runDoctor(["--probe-hooks", "--json"]),
    );
    const result = JSON.parse(stdout) as DoctorResult;
    assert.ok(
      result.hookWiringProbe,
      "doctor --probe-hooks must include hookWiringProbe",
    );
    assert.ok(
      ["pass", "fail", "inconclusive"].includes(result.hookWiringProbe.status),
      `hookWiringProbe.status must be a known value (got ${result.hookWiringProbe.status})`,
    );
    assert.equal(
      typeof result.hookWiringProbe.message,
      "string",
      "hookWiringProbe.message must be a string",
    );
  },
);

test(
  "with no auth and no login cache: probe result is INCONCLUSIVE (not FAIL)",
  { concurrency: false },
  (t) => {
    isolateEnv(t);
    // No env vars, no config.json with loggedInUsers — so hasCopilotAuth() is false.
    const probe = probeHookWiring();
    assert.equal(
      probe.status,
      "inconclusive",
      `probe must be INCONCLUSIVE without auth, got ${probe.status}: ${probe.message}`,
    );
    assert.notEqual(
      probe.status,
      "fail",
      "probe must NOT be FAIL when auth is missing — that would be a misleading verdict",
    );
  },
);
