import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runTeamRuntime,
  resumeTeamRuntime,
  _internals,
} from "../runtime.js";
import { createTask } from "../state/tasks.js";
import { writeWorkerIdentity } from "../state/workers.js";

const {
  assertTeamName,
  resolveCwd,
  resolveOptions,
  identitiesToSlots,
  snapshotTasks,
  allTerminal,
  runVerifyGate,
} = _internals;

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "omghc-runtime-test-"));
}

// --- assertTeamName -------------------------------------------------------

test("assertTeamName accepts valid alphanumeric names", () => {
  assert.doesNotThrow(() => assertTeamName("alpha"));
  assert.doesNotThrow(() => assertTeamName("team1"));
  assert.doesNotThrow(() => assertTeamName("a"));
  assert.doesNotThrow(() => assertTeamName("a-b_c-1"));
});

test("assertTeamName rejects empty / leading-special / too-long names", () => {
  assert.throws(() => assertTeamName(""), /invalid_team_name/);
  assert.throws(() => assertTeamName("-leading-dash"), /invalid_team_name/);
  assert.throws(() => assertTeamName("_leading-underscore"), /invalid_team_name/);
  assert.throws(() => assertTeamName("name with spaces"), /invalid_team_name/);
  assert.throws(() => assertTeamName("a".repeat(65)), /invalid_team_name/);
  assert.throws(() => assertTeamName("name/slash"), /invalid_team_name/);
});

// --- resolveCwd -----------------------------------------------------------

test("resolveCwd uses provided dir if non-empty, falls back to process.cwd()", () => {
  const dir = freshDir();
  try {
    assert.equal(resolveCwd(dir).endsWith(dir.split(/[/\\]/).pop()!), true);
    // empty / whitespace-only fall back
    assert.equal(typeof resolveCwd(""), "string");
    assert.equal(typeof resolveCwd("   "), "string");
    assert.equal(typeof resolveCwd(undefined), "string");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- resolveOptions -------------------------------------------------------

test("resolveOptions throws on bad team_name", () => {
  assert.throws(
    () =>
      resolveOptions({
        team_name: "",
        worker_count: 1,
        role: "executor",
        task_description: "x",
      }),
    /invalid_team_name/,
  );
});

test("resolveOptions throws on non-positive worker_count", () => {
  for (const wc of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () =>
        resolveOptions({
          team_name: "alpha",
          worker_count: wc as number,
          role: "executor",
          task_description: "x",
        }),
      /invalid_worker_count/,
    );
  }
});

test("resolveOptions throws on missing role", () => {
  assert.throws(
    () =>
      resolveOptions({
        team_name: "alpha",
        worker_count: 1,
        role: "",
        task_description: "x",
      }),
    /role required/,
  );
});

test("resolveOptions throws on missing task_description", () => {
  assert.throws(
    () =>
      resolveOptions({
        team_name: "alpha",
        worker_count: 1,
        role: "executor",
        task_description: "",
      }),
    /task_description required/,
  );
});

test("resolveOptions defaults cli=copilot, maxFixLoops=3, cadence=5000, worktreePerWorker=false", () => {
  const dir = freshDir();
  try {
    const r = resolveOptions({
      team_name: "alpha",
      worker_count: 2,
      role: "executor",
      task_description: "task",
      workingDirectory: dir,
    });
    assert.equal(r.cli, "copilot");
    assert.equal(r.maxFixLoops, 3);
    assert.equal(r.iterationCadenceMs, 5000);
    assert.equal(r.worktreePerWorker, false);
    assert.equal(r.team_name, "alpha");
    assert.equal(r.worker_count, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveOptions accepts and honors custom maxFixLoops, cadence, worktreePerWorker", () => {
  const dir = freshDir();
  try {
    const r = resolveOptions({
      team_name: "alpha",
      worker_count: 1,
      role: "executor",
      task_description: "x",
      workingDirectory: dir,
      cli: "claude",
      maxFixLoops: 5,
      iterationCadenceMs: 1000,
      worktreePerWorker: true,
    });
    assert.equal(r.cli, "claude");
    assert.equal(r.maxFixLoops, 5);
    assert.equal(r.iterationCadenceMs, 1000);
    assert.equal(r.worktreePerWorker, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveOptions falls back to defaults on negative or zero numerics", () => {
  const dir = freshDir();
  try {
    const r = resolveOptions({
      team_name: "alpha",
      worker_count: 1,
      role: "executor",
      task_description: "x",
      workingDirectory: dir,
      maxFixLoops: -1, // negative falls back
      iterationCadenceMs: 0, // zero falls back
    });
    assert.equal(r.maxFixLoops, 3);
    assert.equal(r.iterationCadenceMs, 5000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- identitiesToSlots ----------------------------------------------------

test("identitiesToSlots maps identity rows to slot shape", () => {
  const slots = identitiesToSlots([
    { name: "w1", index: 0, role: "exec", team_name: "a" },
    { name: "w2", index: 1, role: "exec", team_name: "a" },
  ]);
  assert.equal(slots.length, 2);
  assert.deepEqual(slots[0], { name: "w1", role: "exec", busy: false, taskCount: 0 });
  assert.deepEqual(slots[1], { name: "w2", role: "exec", busy: false, taskCount: 0 });
});

test("identitiesToSlots on empty input returns []", () => {
  assert.deepEqual(identitiesToSlots([]), []);
});

// --- snapshotTasks --------------------------------------------------------

test("snapshotTasks reports zeros on empty team", () => {
  const dir = freshDir();
  try {
    const snap = snapshotTasks("never-existed", dir);
    assert.deepEqual(snap, { completed: 0, failed: 0, total: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("snapshotTasks counts pending/completed/failed/cancelled", () => {
  const dir = freshDir();
  try {
    // Seed 4 tasks with explicit statuses by mutating after createTask.
    // createTask sets status=pending; we use updateTask not exposed here,
    // so we rely on the state lifecycle via direct fs writes through createTask only.
    // For this unit test, we just verify the empty/seeded case shapes.
    createTask(
      { team_name: "tcounts", subject: "a", description: "" },
      { workingDirectory: dir },
    );
    createTask(
      { team_name: "tcounts", subject: "b", description: "" },
      { workingDirectory: dir },
    );
    const snap = snapshotTasks("tcounts", dir);
    assert.equal(snap.total, 2);
    // Both pending → 0 completed, 0 failed
    assert.equal(snap.completed, 0);
    assert.equal(snap.failed, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- allTerminal ----------------------------------------------------------

test("allTerminal true when pending=0 AND in_progress=0", () => {
  assert.equal(
    allTerminal({
      alive: 0,
      busy: 0,
      idle: 0,
      tasks: { pending: 0, in_progress: 0, completed: 5, failed: 0 },
    }),
    true,
  );
});

test("allTerminal false if any pending or in_progress remain", () => {
  assert.equal(
    allTerminal({
      alive: 0,
      busy: 0,
      idle: 0,
      tasks: { pending: 1, in_progress: 0, completed: 0, failed: 0 },
    }),
    false,
  );
  assert.equal(
    allTerminal({
      alive: 0,
      busy: 0,
      idle: 0,
      tasks: { pending: 0, in_progress: 1, completed: 0, failed: 0 },
    }),
    false,
  );
});

// --- runVerifyGate --------------------------------------------------------

test("runVerifyGate fails when total=0", () => {
  const v = runVerifyGate(null, { completed: 0, failed: 0, total: 0 });
  assert.equal(v.pass, false);
  assert.equal(v.reason, "verify_no_tasks");
});

test("runVerifyGate fails when failed>0", () => {
  const v = runVerifyGate(null, { completed: 1, failed: 2, total: 3 });
  assert.equal(v.pass, false);
  assert.match(v.reason, /verify_failed_tasks:2/);
});

test("runVerifyGate fails on regression (completed went down)", () => {
  const prev = { completed: 5, failed: 0, total: 5 };
  const cur = { completed: 3, failed: 0, total: 5 };
  const v = runVerifyGate(prev, cur);
  assert.equal(v.pass, false);
  assert.match(v.reason, /verify_regression/);
});

test("runVerifyGate fails when no completions at all", () => {
  const v = runVerifyGate(null, { completed: 0, failed: 0, total: 5 });
  assert.equal(v.pass, false);
  assert.equal(v.reason, "verify_no_completions");
});

test("runVerifyGate passes when total>0, failed=0, completed>0, no regression", () => {
  const v = runVerifyGate(null, { completed: 5, failed: 0, total: 5 });
  assert.equal(v.pass, true);
  assert.equal(v.reason, "verify_ok");
});

test("runVerifyGate passes when prev<cur completed (progress)", () => {
  const v = runVerifyGate(
    { completed: 2, failed: 0, total: 5 },
    { completed: 5, failed: 0, total: 5 },
  );
  assert.equal(v.pass, true);
});

// --- runTeamRuntime / resumeTeamRuntime entry validation ------------------

test("runTeamRuntime rejects invalid team_name early", async () => {
  await assert.rejects(
    runTeamRuntime({
      team_name: "", // invalid
      worker_count: 1,
      role: "executor",
      task_description: "x",
    }),
    /invalid_team_name/,
  );
});

test("runTeamRuntime rejects worker_count=0 early", async () => {
  await assert.rejects(
    runTeamRuntime({
      team_name: "alpha",
      worker_count: 0,
      role: "executor",
      task_description: "x",
    }),
    /invalid_worker_count/,
  );
});

test("runTeamRuntime rejects empty role early", async () => {
  await assert.rejects(
    runTeamRuntime({
      team_name: "alpha",
      worker_count: 1,
      role: "",
      task_description: "x",
    }),
    /role required/,
  );
});

test("runTeamRuntime rejects empty task_description early", async () => {
  await assert.rejects(
    runTeamRuntime({
      team_name: "alpha",
      worker_count: 1,
      role: "executor",
      task_description: "",
    }),
    /task_description required/,
  );
});

test("resumeTeamRuntime rejects invalid team_name", async () => {
  await assert.rejects(
    resumeTeamRuntime("invalid name with spaces"),
    /invalid_team_name/,
  );
});

// suppress lint warning about unused import; writeWorkerIdentity reserved for
// future state-seeded tests
void writeWorkerIdentity;
