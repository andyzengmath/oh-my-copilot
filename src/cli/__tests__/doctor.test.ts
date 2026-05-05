import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runDoctor,
  runDoctorChecks,
  type DoctorCheck,
} from "../doctor.js";

const ENV_KEYS = [
  "COPILOT_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "COPILOT_PROVIDER_BASE_URL",
  "COPILOT_HOME",
] as const;

function withEnvAndHome(
  t: TestContext,
  env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
): string {
  const dir = mkdtempSync(join(tmpdir(), "omghc-doctor-test-"));
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    original[key] = process.env[key];
    delete process.env[key];
  }
  for (const [key, val] of Object.entries(env)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
  process.env.COPILOT_HOME = dir;
  t.after(() => {
    for (const key of ENV_KEYS) {
      const orig = original[key];
      if (orig === undefined) delete process.env[key];
      else process.env[key] = orig;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function writeLoginCache(dir: string, users: unknown): void {
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({ loggedInUsers: users }, null, 2),
    "utf8",
  );
}

function findCheck(checks: DoctorCheck[], name: string): DoctorCheck {
  const c = checks.find((x) => x.name === name);
  assert.ok(c, `expected check named '${name}'`);
  return c as DoctorCheck;
}

async function captureStdoutAsync<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = await fn();
    return { result, stdout: chunks.join("") };
  } finally {
    process.stdout.write = original;
  }
}

test(
  "auth: COPILOT_GITHUB_TOKEN beats GH_TOKEN",
  { concurrency: false },
  (t) => {
    withEnvAndHome(t, {
      COPILOT_GITHUB_TOKEN: "copilot-token-value",
      GH_TOKEN: "gh-token-value",
      GITHUB_TOKEN: "gh-old-token-value",
    });
    const { checks } = runDoctorChecks();
    const auth = findCheck(checks, "Auth");
    assert.equal(auth.status, "ok");
    assert.match(auth.message, /COPILOT_GITHUB_TOKEN/);
    assert.doesNotMatch(auth.message, /\bGH_TOKEN\b/);
  },
);

test(
  "auth: GH_TOKEN beats GITHUB_TOKEN when COPILOT_GITHUB_TOKEN unset",
  { concurrency: false },
  (t) => {
    withEnvAndHome(t, {
      GH_TOKEN: "gh-token-value",
      GITHUB_TOKEN: "github-token-value",
    });
    const { checks } = runDoctorChecks();
    const auth = findCheck(checks, "Auth");
    assert.equal(auth.status, "ok");
    assert.match(auth.message, /GH_TOKEN/);
    assert.doesNotMatch(auth.message, /GITHUB_TOKEN/);
  },
);

test(
  "auth: empty GH_TOKEN falls through to GITHUB_TOKEN",
  { concurrency: false },
  (t) => {
    withEnvAndHome(t, {
      GH_TOKEN: "",
      GITHUB_TOKEN: "github-token-value",
    });
    const { checks } = runDoctorChecks();
    const auth = findCheck(checks, "Auth");
    assert.equal(auth.status, "ok");
    assert.match(auth.message, /GITHUB_TOKEN/);
  },
);

test(
  "auth: login cache used when no env vars",
  { concurrency: false },
  (t) => {
    const dir = withEnvAndHome(t, {});
    writeLoginCache(dir, [{ host: "github.com", login: "andyz" }]);
    const { checks } = runDoctorChecks();
    const auth = findCheck(checks, "Auth");
    assert.equal(auth.status, "ok");
    assert.match(auth.message, /login cache/);
    assert.match(auth.message, /github\.com/);
    assert.match(auth.message, /andyz/);
  },
);

test(
  "auth: fails when no env vars and no login cache",
  { concurrency: false },
  (t) => {
    withEnvAndHome(t, {});
    const { checks } = runDoctorChecks();
    const auth = findCheck(checks, "Auth");
    assert.equal(auth.status, "fail");
    assert.equal(auth.severity, "high");
    assert.match(auth.advice ?? "", /copilot login/);
  },
);

test(
  "auth: BYOK mode passes when COPILOT_PROVIDER_BASE_URL is set",
  { concurrency: false },
  (t) => {
    withEnvAndHome(t, {
      COPILOT_PROVIDER_BASE_URL: "https://my-llm-proxy.example.com",
      GH_TOKEN: "gh-token-value",
    });
    const { checks } = runDoctorChecks();
    const auth = findCheck(checks, "Auth");
    assert.equal(auth.status, "ok");
    assert.match(auth.message, /BYOK/i);
    assert.match(auth.message, /my-llm-proxy\.example\.com/);
  },
);

test(
  "auth: token contents never appear in --json output",
  { concurrency: false },
  async (t) => {
    withEnvAndHome(t, {
      GH_TOKEN: "ghp_TESTSECRET12345",
    });
    const { stdout } = await captureStdoutAsync(() =>
      runDoctor(["--json"]),
    );
    assert.doesNotMatch(
      stdout,
      /TESTSECRET/,
      "doctor output must not contain token contents",
    );
    assert.doesNotMatch(
      stdout,
      /ghp_TESTSECRET/,
      "doctor output must not contain raw token prefix",
    );
  },
);

test(
  "auth: login cache with empty array falls through to FAIL",
  { concurrency: false },
  (t) => {
    const dir = withEnvAndHome(t, {});
    writeLoginCache(dir, []);
    const { checks } = runDoctorChecks();
    const auth = findCheck(checks, "Auth");
    assert.equal(auth.status, "fail");
    assert.match(auth.advice ?? "", /copilot login/);
  },
);
