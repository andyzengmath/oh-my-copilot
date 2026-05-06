import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runContinue, _internals } from "../continue.js";

interface CapturedIo {
  stdout: string;
  stderr: string;
}

async function captureIo<T>(
  fn: () => Promise<T>,
): Promise<{ result: T } & CapturedIo> {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: unknown) => {
    outChunks.push(typeof c === "string" ? c : String(c));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: unknown) => {
    errChunks.push(typeof c === "string" ? c : String(c));
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, stdout: outChunks.join(""), stderr: errChunks.join("") };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

function withTmpCwd(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "omghc-continue-test-"));
  const original = process.cwd();
  process.chdir(dir);
  t.after(() => {
    process.chdir(original);
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function writeRalphHint(
  cwd: string,
  capturedAt = new Date().toISOString(),
): string {
  const dir = join(cwd, ".omghc", "state");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "ralph-resume-hint.json");
  const hint = {
    mode: "ralph",
    session_id: "test-session-1",
    captured_at: capturedAt,
    next_action: "Continue ralph iteration 5",
    resume_command: "omghc ralph",
    state_snapshot: { iteration: 4 },
  };
  writeFileSync(path, JSON.stringify(hint, null, 2), "utf-8");
  return path;
}

function writeTeamHint(cwd: string, name = "alpha"): string {
  const dir = join(cwd, ".omghc", "state");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "team-resume-hint.json");
  const hint = {
    mode: "team",
    session_id: "test-session-2",
    captured_at: new Date().toISOString(),
    next_action: `Resume team ${name} from team-exec`,
    resume_command: `omghc team resume ${name}`,
  };
  writeFileSync(path, JSON.stringify(hint, null, 2), "utf-8");
  return path;
}

test("--help exits 0 and prints usage", { concurrency: false }, async (t) => {
  withTmpCwd(t);
  const { result, stdout } = await captureIo(() => runContinue(["--help"]));
  assert.equal(result, 0);
  assert.match(stdout, /Usage: omghc continue/);
  assert.match(stdout, /--mode/);
  assert.match(stdout, /--list/);
});

test(
  "-h short flag exits 0 and prints usage",
  { concurrency: false },
  async (t) => {
    withTmpCwd(t);
    const { result, stdout } = await captureIo(() => runContinue(["-h"]));
    assert.equal(result, 0);
    assert.match(stdout, /Usage: omghc continue/);
  },
);

test(
  "--list with empty state dir prints 'No active OMGHC mode' and exits 0",
  { concurrency: false },
  async (t) => {
    withTmpCwd(t);
    const { result, stdout } = await captureIo(() => runContinue(["--list"]));
    assert.equal(result, 0);
    assert.match(stdout, /No active OMGHC mode/);
  },
);

test(
  "--list lists hints when present",
  { concurrency: false },
  async (t) => {
    const cwd = withTmpCwd(t);
    writeRalphHint(cwd);
    writeTeamHint(cwd, "beta");
    const { result, stdout } = await captureIo(() =>
      runContinue(["--list"]),
    );
    assert.equal(result, 0);
    assert.match(stdout, /Found 2 resume hint/);
    assert.match(stdout, /\bralph\b/);
    assert.match(stdout, /\bteam\b/);
    assert.match(stdout, /Continue ralph iteration 5/);
  },
);

test(
  "--clear --mode ralph removes only ralph hint",
  { concurrency: false },
  async (t) => {
    const cwd = withTmpCwd(t);
    const ralphPath = writeRalphHint(cwd);
    const teamPath = writeTeamHint(cwd);
    assert.ok(existsSync(ralphPath));
    assert.ok(existsSync(teamPath));

    const { result, stdout } = await captureIo(() =>
      runContinue(["--clear", "--mode", "ralph"]),
    );
    assert.equal(result, 0);
    assert.match(stdout, /Cleared ralph/);
    assert.equal(
      existsSync(ralphPath),
      false,
      "ralph hint should be removed",
    );
    assert.equal(
      existsSync(teamPath),
      true,
      "team hint must remain",
    );
  },
);

test("--clear without --mode removes all hints", { concurrency: false }, async (t) => {
  const cwd = withTmpCwd(t);
  const ralphPath = writeRalphHint(cwd);
  const teamPath = writeTeamHint(cwd);

  const { result, stdout } = await captureIo(() =>
    runContinue(["--clear"]),
  );
  assert.equal(result, 0);
  assert.match(stdout, /Cleared 2 resume hint/);
  assert.equal(existsSync(ralphPath), false);
  assert.equal(existsSync(teamPath), false);
});

test(
  "--dry-run prints command but does not spawn",
  { concurrency: false },
  async (t) => {
    const cwd = withTmpCwd(t);
    writeRalphHint(cwd);

    const { result, stdout } = await captureIo(() =>
      runContinue(["--dry-run"]),
    );
    assert.equal(result, 0);
    assert.match(stdout, /Resuming ralph/);
    assert.match(stdout, /Command: omghc ralph/);
    assert.match(stdout, /dry-run/);
  },
);

test(
  "no hint with no flags prints 'No active' and exits 0",
  { concurrency: false },
  async (t) => {
    withTmpCwd(t);
    const { result, stdout } = await captureIo(() => runContinue([]));
    assert.equal(result, 0);
    assert.match(stdout, /No active OMGHC mode/);
  },
);

test(
  "--mode with invalid value exits 2",
  { concurrency: false },
  async (t) => {
    withTmpCwd(t);
    const { result, stderr } = await captureIo(() =>
      runContinue(["--mode", "invalid-mode"]),
    );
    assert.equal(result, 2);
    assert.match(stderr, /invalid --mode/);
  },
);

test(
  "unknown flag exits 2",
  { concurrency: false },
  async (t) => {
    withTmpCwd(t);
    const { result, stderr } = await captureIo(() =>
      runContinue(["--bogus-flag"]),
    );
    assert.equal(result, 2);
    assert.match(stderr, /unknown flag/);
  },
);

test(
  "--mode picks specific hint even when newer hints exist for other modes",
  { concurrency: false },
  async (t) => {
    const cwd = withTmpCwd(t);
    // Older ralph hint, newer team hint.
    writeRalphHint(cwd, "2020-01-01T00:00:00.000Z");
    writeTeamHint(cwd);

    const { result, stdout } = await captureIo(() =>
      runContinue(["--dry-run", "--mode", "ralph"]),
    );
    assert.equal(result, 0);
    assert.match(stdout, /Resuming ralph/);
    assert.doesNotMatch(stdout, /Resuming team/);
  },
);

test(
  "splitCommand parses simple commands and quoted args",
  { concurrency: false },
  () => {
    const a = _internals.splitCommand("omghc ralph");
    assert.deepEqual(a, { cmd: "omghc", args: ["ralph"] });
    const b = _internals.splitCommand("omghc team resume 'my team'");
    assert.deepEqual(b, { cmd: "omghc", args: ["team", "resume", "my team"] });
    const c = _internals.splitCommand("");
    assert.equal(c, null);
  },
);
