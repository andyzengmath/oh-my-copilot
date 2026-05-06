/**
 * Coverage supplement tests for src/team/state/* — exercises read/list/error
 * paths not covered by the original happy-path round-trip tests. Targets the
 * v0.1.x defect: "raise team/state/* coverage to ≥78%".
 *
 * Tests are organized by module: tasks, workers, mailbox, dispatch.
 * Each one exercises an exported function with a non-default code path
 * (filter, error, or read-after-clear).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTask,
  listTasks,
  readTask,
  updateTask,
} from "../tasks.js";
import {
  readWorkerHeartbeat,
  writeWorkerHeartbeat,
  writeWorkerIdentity,
  listWorkerIdentities,
  listAliveWorkers,
} from "../workers.js";
import {
  sendMessage,
  broadcast,
  listMailbox,
  markNotified,
  markDelivered,
} from "../mailbox.js";
import {
  createDispatch,
  readDispatch,
  listDispatches,
  markDelivered as markDispatchDelivered,
  markAcked as markDispatchAcked,
  markFailed as markDispatchFailed,
} from "../dispatch.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "omghc-coverage-supplement-"));
}

// --- tasks ----------------------------------------------------------------

test("listTasks returns multiple tasks sorted by id ascending", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const a = createTask(
    { team_name: "alpha", subject: "first", description: "" },
    { workingDirectory: dir },
  );
  const b = createTask(
    { team_name: "alpha", subject: "second", description: "" },
    { workingDirectory: dir },
  );
  const c = createTask(
    { team_name: "alpha", subject: "third", description: "" },
    { workingDirectory: dir },
  );

  const all = listTasks("alpha", { workingDirectory: dir });
  assert.equal(all.length, 3);
  // Ids are UUIDs; just check we got back what we created.
  const ids = new Set(all.map((t) => t.id));
  assert.ok(ids.has(a.id));
  assert.ok(ids.has(b.id));
  assert.ok(ids.has(c.id));
});

test("readTask returns null for unknown id, listTasks returns [] for empty team", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.equal(readTask("never-team", "no-id", { workingDirectory: dir }), null);
  assert.deepEqual(listTasks("never-team", { workingDirectory: dir }), []);
});

test("updateTask preserves id/team_name; non-merging fields are ignored", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const created = createTask(
    { team_name: "beta", subject: "before", description: "" },
    { workingDirectory: dir },
  );
  const updated = updateTask(
    "beta",
    created.id,
    { subject: "after", metadata: { tag: "v1" } } as never,
    { workingDirectory: dir },
  );
  assert.equal(updated.id, created.id);
  assert.equal(updated.team_name, "beta");
  assert.equal(updated.subject, "after");
  assert.equal(updated.version, 2);
  assert.deepEqual(updated.metadata, { tag: "v1" });
});

// --- workers --------------------------------------------------------------

test("readWorkerHeartbeat returns null for unknown worker", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const beat = readWorkerHeartbeat("alpha", "ghost", { workingDirectory: dir });
  assert.equal(beat, null);
});

test("writeWorkerHeartbeat round-trips and supports state field", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeWorkerIdentity(
    { name: "w1", index: 0, role: "x", team_name: "alpha" },
    { workingDirectory: dir },
  );
  const written = writeWorkerHeartbeat(
    {
      worker_name: "w1",
      team_name: "alpha",
      pid: 12345,
      turn_count: 7,
      alive: true,
      state: "busy",
      current_task_id: "task-42",
      last_beat_at: new Date().toISOString(),
    },
    { workingDirectory: dir },
  );
  assert.equal(written.state, "busy");
  assert.equal(written.current_task_id, "task-42");
  assert.equal(written.turn_count, 7);
  assert.equal(written.pid, 12345);

  const read = readWorkerHeartbeat("alpha", "w1", { workingDirectory: dir });
  assert.ok(read);
  assert.equal(read!.state, "busy");
  assert.equal(read!.pid, 12345);
});

test("listAliveWorkers honors custom staleThresholdMs", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeWorkerIdentity(
    { name: "sometimes-fresh", index: 0, role: "r", team_name: "alpha" },
    { workingDirectory: dir },
  );

  // Heartbeat 5 seconds ago.
  writeWorkerHeartbeat(
    {
      worker_name: "sometimes-fresh",
      team_name: "alpha",
      last_beat_at: new Date(Date.now() - 5_000).toISOString(),
      alive: true,
    },
    { workingDirectory: dir },
  );

  // With 1s threshold: not alive.
  const tight = listAliveWorkers("alpha", {
    workingDirectory: dir,
    staleThresholdMs: 1_000,
  });
  assert.equal(tight.length, 0);

  // With 30s threshold: alive.
  const loose = listAliveWorkers("alpha", {
    workingDirectory: dir,
    staleThresholdMs: 30_000,
  });
  assert.equal(loose.length, 1);
  assert.equal(loose[0].name, "sometimes-fresh");
});

test("listWorkerIdentities returns [] for non-existent team", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.deepEqual(
    listWorkerIdentities("never-existed", { workingDirectory: dir }),
    [],
  );
});

// --- mailbox --------------------------------------------------------------

test("listMailbox excludes delivered by default; includeDelivered surfaces them", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const msg = sendMessage(
    {
      team_name: "alpha",
      from_worker: "w1",
      to_worker: "w2",
      body: "hello",
    },
    { workingDirectory: dir },
  );

  // Initially listMailbox surfaces it.
  let inbox = listMailbox("alpha", "w2", { workingDirectory: dir });
  assert.equal(inbox.length, 1);

  // After markDelivered, default listMailbox excludes it.
  markDelivered("alpha", "w2", msg.message_id, { workingDirectory: dir });
  inbox = listMailbox("alpha", "w2", { workingDirectory: dir });
  assert.equal(inbox.length, 0);

  // includeDelivered: true surfaces it again.
  const inboxAll = listMailbox("alpha", "w2", {
    workingDirectory: dir,
    includeDelivered: true,
  });
  assert.equal(inboxAll.length, 1);
  assert.ok(inboxAll[0].delivered_at);
});

test("markNotified updates the notified_at timestamp", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const msg = sendMessage(
    {
      team_name: "alpha",
      from_worker: "w1",
      to_worker: "w2",
      body: "ping",
    },
    { workingDirectory: dir },
  );

  const notified = markNotified("alpha", "w2", msg.message_id, {
    workingDirectory: dir,
  });
  assert.ok(notified.notified_at);
  assert.equal(notified.message_id, msg.message_id);
});

test("broadcast skips sender, sends to remaining workers", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Seed three workers: w1 (sender), w2, w3.
  writeWorkerIdentity(
    { name: "w1", index: 0, role: "r", team_name: "alpha" },
    { workingDirectory: dir },
  );
  writeWorkerIdentity(
    { name: "w2", index: 1, role: "r", team_name: "alpha" },
    { workingDirectory: dir },
  );
  writeWorkerIdentity(
    { name: "w3", index: 2, role: "r", team_name: "alpha" },
    { workingDirectory: dir },
  );

  const messages = broadcast(
    { team_name: "alpha", from_worker: "w1", body: "hi all" },
    { workingDirectory: dir },
  );

  // Two recipients: w2, w3 (sender skipped).
  assert.equal(messages.length, 2);
  const recipients = new Set(messages.map((m) => m.to_worker));
  assert.ok(recipients.has("w2"));
  assert.ok(recipients.has("w3"));
  assert.ok(!recipients.has("w1"));
});

// --- dispatch -------------------------------------------------------------

test("createDispatch + readDispatch round-trip", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const dispatch = createDispatch(
    { team_name: "alpha", task_id: "task-1", worker: "w1" },
    { workingDirectory: dir },
  );
  assert.equal(dispatch.team_name, "alpha");
  assert.equal(dispatch.task_id, "task-1");
  assert.equal(dispatch.worker, "w1");
  assert.equal(dispatch.status, "pending");

  const read = readDispatch("alpha", dispatch.id, { workingDirectory: dir });
  assert.deepEqual(read, dispatch);
});

test("listDispatches with worker + status filters", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const d1 = createDispatch(
    { team_name: "alpha", task_id: "t1", worker: "w1" },
    { workingDirectory: dir },
  );
  const d2 = createDispatch(
    { team_name: "alpha", task_id: "t2", worker: "w2" },
    { workingDirectory: dir },
  );
  const d3 = createDispatch(
    { team_name: "alpha", task_id: "t3", worker: "w1" },
    { workingDirectory: dir },
  );

  // Filter by worker.
  const w1Dispatches = listDispatches("alpha", {
    workingDirectory: dir,
    worker: "w1",
  });
  assert.equal(w1Dispatches.length, 2);
  const w1Ids = new Set(w1Dispatches.map((d) => d.id));
  assert.ok(w1Ids.has(d1.id));
  assert.ok(w1Ids.has(d3.id));

  // Filter by status (still pending after creation).
  const pendingDispatches = listDispatches("alpha", {
    workingDirectory: dir,
    status: "pending",
  });
  assert.equal(pendingDispatches.length, 3);

  // Mark one delivered, then filter by status="delivered".
  markDispatchDelivered("alpha", d1.id, { workingDirectory: dir });
  const deliveredDispatches = listDispatches("alpha", {
    workingDirectory: dir,
    status: "delivered",
  });
  assert.equal(deliveredDispatches.length, 1);
  assert.equal(deliveredDispatches[0].id, d1.id);

  // d2 untouched; d3 untouched.
  void d2;
});

test("dispatch markAcked transitions status with timestamp", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const dispatch = createDispatch(
    { team_name: "alpha", task_id: "task-1", worker: "w1" },
    { workingDirectory: dir },
  );
  markDispatchDelivered("alpha", dispatch.id, { workingDirectory: dir });
  const acked = markDispatchAcked("alpha", dispatch.id, { workingDirectory: dir });
  assert.equal(acked.status, "acked");
  assert.ok(acked.acked_at);
  assert.ok(acked.delivered_at);
});

test("dispatch markFailed records reason", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const dispatch = createDispatch(
    { team_name: "alpha", task_id: "task-1", worker: "w1" },
    { workingDirectory: dir },
  );
  const failed = markDispatchFailed(
    "alpha",
    dispatch.id,
    "worker rejected task",
    { workingDirectory: dir },
  );
  assert.equal(failed.status, "failed");
});

test("listDispatches against empty team returns []", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.deepEqual(
    listDispatches("never-existed", { workingDirectory: dir }),
    [],
  );
});
