import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isWorkerAlive,
  listAliveWorkers,
  listWorkerIdentities,
  readWorkerIdentity,
  writeWorkerHeartbeat,
  writeWorkerIdentity,
} from "../workers.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "omghc-workers-test-"));
}

test("writeWorkerIdentity + readWorkerIdentity round-trip", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeWorkerIdentity(
    {
      name: "worker-1",
      index: 0,
      role: "scout",
      team_name: "alpha",
      cli: "copilot",
      pid: 4242,
    },
    { workingDirectory: dir },
  );

  const round = readWorkerIdentity("alpha", "worker-1", {
    workingDirectory: dir,
  });
  assert.ok(round);
  assert.equal(round!.name, "worker-1");
  assert.equal(round!.index, 0);
  assert.equal(round!.role, "scout");
  assert.equal(round!.team_name, "alpha");
  assert.equal(round!.cli, "copilot");
  assert.equal(round!.pid, 4242);
});

test("isWorkerAlive returns true for fresh heartbeat, false for stale", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeWorkerIdentity(
    { name: "w1", index: 0, role: "x", team_name: "alpha" },
    { workingDirectory: dir },
  );

  // Fresh heartbeat: now.
  const fresh = writeWorkerHeartbeat(
    {
      worker_name: "w1",
      team_name: "alpha",
      last_beat_at: new Date().toISOString(),
      alive: true,
    },
    { workingDirectory: dir },
  );
  assert.equal(isWorkerAlive(fresh), true);

  // Stale heartbeat: 5 minutes ago.
  const stale = writeWorkerHeartbeat(
    {
      worker_name: "w1",
      team_name: "alpha",
      last_beat_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      alive: true,
    },
    { workingDirectory: dir },
  );
  assert.equal(isWorkerAlive(stale), false);

  // alive=false explicitly => not alive even if recent.
  const claimedDead = writeWorkerHeartbeat(
    {
      worker_name: "w1",
      team_name: "alpha",
      last_beat_at: new Date().toISOString(),
      alive: false,
    },
    { workingDirectory: dir },
  );
  assert.equal(isWorkerAlive(claimedDead), false);

  // null beat => not alive.
  assert.equal(isWorkerAlive(null), false);
});

test("listAliveWorkers filters identities by heartbeat staleness", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Three workers in team "alpha": one fresh, one stale, one with no heartbeat.
  writeWorkerIdentity(
    { name: "fresh", index: 0, role: "r", team_name: "alpha" },
    { workingDirectory: dir },
  );
  writeWorkerIdentity(
    { name: "stale", index: 1, role: "r", team_name: "alpha" },
    { workingDirectory: dir },
  );
  writeWorkerIdentity(
    { name: "ghost", index: 2, role: "r", team_name: "alpha" },
    { workingDirectory: dir },
  );

  writeWorkerHeartbeat(
    {
      worker_name: "fresh",
      team_name: "alpha",
      last_beat_at: new Date().toISOString(),
      alive: true,
    },
    { workingDirectory: dir },
  );
  writeWorkerHeartbeat(
    {
      worker_name: "stale",
      team_name: "alpha",
      last_beat_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      alive: true,
    },
    { workingDirectory: dir },
  );

  const alive = listAliveWorkers("alpha", { workingDirectory: dir });
  assert.deepEqual(
    alive.map((w) => w.name).sort(),
    ["fresh"],
  );

  const allIdentities = listWorkerIdentities("alpha", {
    workingDirectory: dir,
  });
  assert.equal(allIdentities.length, 3);
  // listWorkerIdentities sorts by index ascending.
  assert.deepEqual(
    allIdentities.map((w) => w.name),
    ["fresh", "stale", "ghost"],
  );
});
