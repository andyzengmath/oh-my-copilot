import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// dist/scripts/__tests__/copilot-native-hook-resume.test.js → ../copilot-native-hook.js
const HOOK_SCRIPT = resolve(HERE, "..", "copilot-native-hook.js");

interface SpawnOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runHook(args: string[], stdinJson: string): SpawnOutcome {
  const result = spawnSync("node", [HOOK_SCRIPT, ...args], {
    input: stdinJson,
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
  const dir = mkdtempSync(join(tmpdir(), "omghc-hook-resume-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

interface ModeStateLike {
  mode: string;
  active: boolean;
  current_phase?: string;
  iteration?: number;
  state?: Record<string, string>;
  _meta?: { sessionId?: string | null; updatedAt?: string };
}

function writeModeState(cwd: string, state: ModeStateLike): string {
  const dir = join(cwd, ".omghc", "state");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${state.mode}-state.json`);
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
  return path;
}

function readJsonIfExists<T = unknown>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

test(
  "sessionEnd writes team-resume-hint.json when team mode is active",
  { concurrency: false },
  (t) => {
    const cwd = makeTmpCwd(t);
    writeModeState(cwd, {
      mode: "team",
      active: true,
      current_phase: "team-exec",
      state: { team_name: "alpha" },
      _meta: { sessionId: "sess-1", updatedAt: new Date().toISOString() },
    });

    const ts = Date.now();
    const payload = JSON.stringify({
      timestamp: ts,
      cwd,
      reason: "user_exit",
    });
    const out = runHook(["sessionEnd"], payload);
    assert.equal(
      out.status,
      0,
      `expected exit 0, got ${out.status}; stderr=${out.stderr}`,
    );

    const hintPath = join(cwd, ".omghc", "state", "team-resume-hint.json");
    assert.ok(existsSync(hintPath), `team hint should exist at ${hintPath}`);

    const hint = readJsonIfExists<Record<string, unknown>>(hintPath);
    assert.ok(hint, "hint must be readable JSON");
    assert.equal(hint.mode, "team");
    assert.equal(hint.resume_command, "omghc team resume alpha");
    assert.match(String(hint.next_action), /Resume team alpha from team-exec/);
    assert.equal(hint.session_id, "sess-1");
    assert.equal(typeof hint.captured_at, "string");
  },
);

test(
  "sessionEnd writes no hints when all modes are inactive",
  { concurrency: false },
  (t) => {
    const cwd = makeTmpCwd(t);
    writeModeState(cwd, {
      mode: "ralph",
      active: false,
      current_phase: "completed",
    });
    writeModeState(cwd, {
      mode: "team",
      active: false,
      current_phase: "team-fix",
      state: { team_name: "alpha" },
    });

    const ts = Date.now();
    const payload = JSON.stringify({
      timestamp: ts,
      cwd,
      reason: "complete",
    });
    const out = runHook(["sessionEnd"], payload);
    assert.equal(
      out.status,
      0,
      `expected exit 0, got ${out.status}; stderr=${out.stderr}`,
    );

    const ralphHint = join(cwd, ".omghc", "state", "ralph-resume-hint.json");
    const teamHint = join(cwd, ".omghc", "state", "team-resume-hint.json");
    assert.equal(existsSync(ralphHint), false);
    assert.equal(existsSync(teamHint), false);

    const parsed = JSON.parse(out.stdout) as { hintsWritten?: number };
    assert.equal(parsed.hintsWritten, 0);
  },
);

test(
  "sessionEnd skips terminal-phase modes",
  { concurrency: false },
  (t) => {
    const cwd = makeTmpCwd(t);
    // Active flag is true but phase signals terminal.
    writeModeState(cwd, {
      mode: "ralph",
      active: true,
      current_phase: "completed",
      iteration: 7,
    });

    const payload = JSON.stringify({
      timestamp: Date.now(),
      cwd,
      reason: "complete",
    });
    const out = runHook(["sessionEnd"], payload);
    assert.equal(out.status, 0, `stderr=${out.stderr}`);

    const ralphHint = join(cwd, ".omghc", "state", "ralph-resume-hint.json");
    assert.equal(
      existsSync(ralphHint),
      false,
      "no hint written for terminal phase",
    );
  },
);

test(
  "sessionEnd writes ralph hint with iteration N+1 in next_action",
  { concurrency: false },
  (t) => {
    const cwd = makeTmpCwd(t);
    writeModeState(cwd, {
      mode: "ralph",
      active: true,
      current_phase: "ralph-loop",
      iteration: 4,
    });

    const payload = JSON.stringify({
      timestamp: Date.now(),
      cwd,
      reason: "user_exit",
    });
    const out = runHook(["sessionEnd"], payload);
    assert.equal(out.status, 0, `stderr=${out.stderr}`);

    const hintPath = join(cwd, ".omghc", "state", "ralph-resume-hint.json");
    const hint = readJsonIfExists<Record<string, unknown>>(hintPath);
    assert.ok(hint, "ralph hint should exist");
    assert.equal(hint.resume_command, "omghc ralph");
    assert.match(String(hint.next_action), /iteration 5/);
  },
);

test(
  "sessionEnd skips skill-active mode (not in resumable set)",
  { concurrency: false },
  (t) => {
    const cwd = makeTmpCwd(t);
    writeModeState(cwd, {
      mode: "skill-active",
      active: true,
      current_phase: "running",
      state: { skill: "research-lit" },
    });

    const payload = JSON.stringify({
      timestamp: Date.now(),
      cwd,
      reason: "user_exit",
    });
    const out = runHook(["sessionEnd"], payload);
    assert.equal(out.status, 0, `stderr=${out.stderr}`);

    const hintPath = join(
      cwd,
      ".omghc",
      "state",
      "skill-active-resume-hint.json",
    );
    assert.equal(
      existsSync(hintPath),
      false,
      "skill-active is not resumable; no hint should be written",
    );
  },
);
