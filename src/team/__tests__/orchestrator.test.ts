import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startOrchestrator,
  resumeOrchestrator,
  _internals,
} from "../orchestrator.js";
import { createTask, claimTask, transitionTaskStatus } from "../state/tasks.js";
import {
  writeWorkerIdentity,
  writeWorkerHeartbeat,
} from "../state/workers.js";

const {
  assertTeamName,
  resolveCwd,
  teamStateDir,
  metaFilePath,
  workerName,
  bootstrapInvocation,
  aggregateTaskStatus,
  classifyWorkerState,
  readMeta,
  writeMeta,
  statusFor,
} = _internals;

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "omghc-orchestrator-test-"));
}

// --- assertTeamName -------------------------------------------------------

test("assertTeamName accepts valid names", () => {
  assert.doesNotThrow(() => assertTeamName("alpha"));
  assert.doesNotThrow(() => assertTeamName("team-1"));
  assert.doesNotThrow(() => assertTeamName("a_b_c"));
});

test("assertTeamName rejects invalid names", () => {
  assert.throws(() => assertTeamName(""), /invalid_team_name/);
  assert.throws(() => assertTeamName("-bad"), /invalid_team_name/);
  assert.throws(() => assertTeamName("with space"), /invalid_team_name/);
});

// --- resolveCwd -----------------------------------------------------------

test("resolveCwd uses workingDirectory when present", () => {
  const dir = freshDir();
  try {
    const got = resolveCwd({ workingDirectory: dir });
    assert.ok(got.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCwd falls back to process.cwd() when empty/missing", () => {
  assert.equal(typeof resolveCwd({}), "string");
  assert.equal(typeof resolveCwd({ workingDirectory: "" }), "string");
  assert.equal(typeof resolveCwd({ workingDirectory: "   " }), "string");
});

// --- path helpers ---------------------------------------------------------

test("teamStateDir + metaFilePath build expected paths", () => {
  const cwd = "/some/path";
  const tDir = teamStateDir("alpha", cwd);
  assert.match(tDir.replace(/\\/g, "/"), /\/some\/path\/\.omghc\/state\/team-alpha$/);
  const mPath = metaFilePath("alpha", cwd);
  assert.match(mPath.replace(/\\/g, "/"), /team-alpha\/team\.json$/);
});

// --- workerName -----------------------------------------------------------

test("workerName converts 0-based index to 1-based name", () => {
  assert.equal(workerName(0), "worker-1");
  assert.equal(workerName(1), "worker-2");
  assert.equal(workerName(9), "worker-10");
});

// --- bootstrapInvocation --------------------------------------------------

test("bootstrapInvocation produces shell-appropriate command", () => {
  const cmd = bootstrapInvocation("/path/to/script.sh");
  // On Windows the runtime checks process.platform === 'win32'. Either form
  // contains the script path; both shapes are valid output.
  assert.ok(cmd.includes("/path/to/script.sh") || cmd.includes("\\path\\to\\script.sh"));
  if (process.platform === "win32") {
    assert.match(cmd, /pwsh/);
  } else {
    assert.match(cmd, /^bash /);
  }
});

// --- classifyWorkerState --------------------------------------------------

test("classifyWorkerState idle for null beat", () => {
  assert.equal(classifyWorkerState(null), "idle");
});

test("classifyWorkerState busy when state='busy'", () => {
  assert.equal(
    classifyWorkerState({
      worker_name: "w1",
      team_name: "a",
      last_beat_at: new Date().toISOString(),
      alive: true,
      state: "busy",
    }),
    "busy",
  );
});

test("classifyWorkerState busy when current_task_id present (no explicit state)", () => {
  assert.equal(
    classifyWorkerState({
      worker_name: "w1",
      team_name: "a",
      last_beat_at: new Date().toISOString(),
      alive: true,
      current_task_id: "t-42",
    }),
    "busy",
  );
});

test("classifyWorkerState idle when no state and no current task", () => {
  assert.equal(
    classifyWorkerState({
      worker_name: "w1",
      team_name: "a",
      last_beat_at: new Date().toISOString(),
      alive: true,
    }),
    "idle",
  );
});

test("classifyWorkerState idle when current_task_id is empty string", () => {
  assert.equal(
    classifyWorkerState({
      worker_name: "w1",
      team_name: "a",
      last_beat_at: new Date().toISOString(),
      alive: true,
      current_task_id: "",
    }),
    "idle",
  );
});

// --- aggregateTaskStatus --------------------------------------------------

test("aggregateTaskStatus zeros on empty team", () => {
  const dir = freshDir();
  try {
    const counts = aggregateTaskStatus("never-existed", dir);
    assert.deepEqual(counts, { pending: 0, in_progress: 0, completed: 0, failed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregateTaskStatus counts pending + in_progress + completed + failed", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Seed 4 tasks with distinct statuses.
  const taskA = createTask(
    { team_name: "agg", subject: "a", description: "" },
    { workingDirectory: dir },
  );
  const taskB = createTask(
    { team_name: "agg", subject: "b", description: "" },
    { workingDirectory: dir },
  );
  const taskC = createTask(
    { team_name: "agg", subject: "c", description: "" },
    { workingDirectory: dir },
  );
  createTask(
    { team_name: "agg", subject: "d-pending", description: "" },
    { workingDirectory: dir },
  );

  // Take A through claimed → in_progress
  const claimA = claimTask("agg", taskA.id, "w1", 1, { workingDirectory: dir });
  transitionTaskStatus(
    "agg",
    taskA.id,
    "claimed",
    "in_progress",
    claimA.claim_token,
    { workingDirectory: dir },
  );

  // Take B through claimed → in_progress → completed
  const claimB = claimTask("agg", taskB.id, "w1", 1, { workingDirectory: dir });
  transitionTaskStatus(
    "agg",
    taskB.id,
    "claimed",
    "in_progress",
    claimB.claim_token,
    { workingDirectory: dir },
  );
  transitionTaskStatus(
    "agg",
    taskB.id,
    "in_progress",
    "completed",
    claimB.claim_token,
    { workingDirectory: dir },
  );

  // Take C → claimed → in_progress → failed
  const claimC = claimTask("agg", taskC.id, "w1", 1, { workingDirectory: dir });
  transitionTaskStatus(
    "agg",
    taskC.id,
    "claimed",
    "in_progress",
    claimC.claim_token,
    { workingDirectory: dir },
  );
  transitionTaskStatus(
    "agg",
    taskC.id,
    "in_progress",
    "failed",
    claimC.claim_token,
    { workingDirectory: dir },
  );

  const counts = aggregateTaskStatus("agg", dir);
  // a in_progress, b completed, c failed, d pending
  assert.equal(counts.pending, 1);
  assert.equal(counts.in_progress, 1);
  assert.equal(counts.completed, 1);
  assert.equal(counts.failed, 1);
});

// --- readMeta / writeMeta -------------------------------------------------

test("readMeta returns null when file does not exist", () => {
  const dir = freshDir();
  try {
    assert.equal(readMeta("never-existed", dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readMeta returns null on malformed JSON", () => {
  const dir = freshDir();
  try {
    const tDir = teamStateDir("bad", dir);
    mkdirSync(tDir, { recursive: true });
    writeFileSync(metaFilePath("bad", dir), "{not-json", "utf-8");
    assert.equal(readMeta("bad", dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readMeta returns null on valid JSON but wrong shape", () => {
  const dir = freshDir();
  try {
    const tDir = teamStateDir("wrong-shape", dir);
    mkdirSync(tDir, { recursive: true });
    writeFileSync(
      metaFilePath("wrong-shape", dir),
      JSON.stringify({ team_name: 123, session_name: "s", workers: [] }),
      "utf-8",
    );
    assert.equal(readMeta("wrong-shape", dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeMeta + readMeta round-trip", () => {
  const dir = freshDir();
  try {
    const meta = {
      team_name: "round",
      session_name: "omghc-round",
      cli: "copilot" as const,
      role: "executor",
      workingDirectory: dir,
      worktreePerWorker: false,
      workers: [{ name: "worker-1", pane_id: "%0" }],
      created_at: "2026-05-06T00:00:00Z",
    };
    writeMeta(meta, dir);
    const round = readMeta("round", dir);
    assert.ok(round);
    assert.equal(round!.team_name, "round");
    assert.equal(round!.session_name, "omghc-round");
    assert.equal(round!.workers.length, 1);
    assert.equal(round!.workers[0]!.name, "worker-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- statusFor (filesystem-only — no tmux required) ----------------------

test("statusFor on empty team returns all zeros", async () => {
  const dir = freshDir();
  try {
    const s = await statusFor("never-existed", dir);
    assert.equal(s.alive, 0);
    assert.equal(s.busy, 0);
    assert.equal(s.idle, 0);
    assert.deepEqual(s.tasks, {
      pending: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("statusFor reports alive workers, classifies busy/idle from heartbeat", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Seed two workers — one busy, one idle.
  writeWorkerIdentity(
    { name: "busy-w", index: 0, role: "exec", team_name: "stat" },
    { workingDirectory: dir },
  );
  writeWorkerIdentity(
    { name: "idle-w", index: 1, role: "exec", team_name: "stat" },
    { workingDirectory: dir },
  );
  writeWorkerHeartbeat(
    {
      worker_name: "busy-w",
      team_name: "stat",
      last_beat_at: new Date().toISOString(),
      alive: true,
      state: "busy",
    },
    { workingDirectory: dir },
  );
  writeWorkerHeartbeat(
    {
      worker_name: "idle-w",
      team_name: "stat",
      last_beat_at: new Date().toISOString(),
      alive: true,
      state: "idle",
    },
    { workingDirectory: dir },
  );

  const s = await statusFor("stat", dir);
  assert.equal(s.alive, 2);
  assert.equal(s.busy, 1);
  assert.equal(s.idle, 1);
});

// --- startOrchestrator entry validation -----------------------------------

test("startOrchestrator rejects invalid team_name early", async () => {
  await assert.rejects(
    startOrchestrator({
      team_name: "",
      worker_count: 1,
      role: "executor",
      task_description: "x",
    }),
    /invalid_team_name/,
  );
});

test("startOrchestrator rejects worker_count <= 0", async () => {
  await assert.rejects(
    startOrchestrator({
      team_name: "alpha",
      worker_count: 0,
      role: "executor",
      task_description: "x",
    }),
    /invalid_worker_count/,
  );
});

test("startOrchestrator rejects empty role", async () => {
  await assert.rejects(
    startOrchestrator({
      team_name: "alpha",
      worker_count: 1,
      role: "",
      task_description: "x",
    }),
    /role required/,
  );
});

test("startOrchestrator rejects empty task_description", async () => {
  await assert.rejects(
    startOrchestrator({
      team_name: "alpha",
      worker_count: 1,
      role: "executor",
      task_description: "",
    }),
    /task_description required/,
  );
});

test("startOrchestrator rejects when team meta already exists", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Seed an existing meta file.
  const meta = {
    team_name: "exists",
    session_name: "omghc-exists",
    cli: "copilot" as const,
    role: "executor",
    workingDirectory: dir,
    worktreePerWorker: false,
    workers: [],
    created_at: "2026-05-06T00:00:00Z",
  };
  writeMeta(meta, dir);

  await assert.rejects(
    startOrchestrator({
      team_name: "exists",
      worker_count: 1,
      role: "executor",
      task_description: "x",
      workingDirectory: dir,
    }),
    /team_already_exists/,
  );
});

// --- resumeOrchestrator entry validation ---------------------------------

test("resumeOrchestrator rejects invalid team_name", async () => {
  await assert.rejects(
    resumeOrchestrator("name with spaces"),
    /invalid_team_name/,
  );
});

test("resumeOrchestrator throws team_not_found when meta missing", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(
    resumeOrchestrator("never-saved", { workingDirectory: dir }),
    /team_not_found/,
  );
});
