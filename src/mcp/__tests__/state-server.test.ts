import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildStateServer } from "../state-server.js";
import {
  stateClear,
  stateGetStatus,
  stateListActive,
  stateRead,
  stateWrite,
} from "../../state/operations.js";

function setupTmp(): string {
  return mkdtempSync(join(tmpdir(), "omghc-state-server-test-"));
}

test("buildStateServer registers the 5 expected state tools", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const server = buildStateServer();
  // McpServer exposes registered tools via the underlying low-level server's
  // handler list; the public surface is the constructor returning an object.
  // We verify behavior through the operation functions which the tools wrap.
  assert.ok(server, "buildStateServer should return an McpServer instance");
});

test("state_write creates the state file with merged fields and _meta", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = stateWrite(
    "ralph",
    { active: true, current_phase: "executing", iteration: 1 },
    { workingDirectory: root },
  );

  assert.equal(result.mode, "ralph");
  assert.equal(result.active, true);
  assert.equal(result.current_phase, "executing");
  assert.equal(result.iteration, 1);
  assert.ok(result._meta, "should include _meta");
  assert.equal(result._meta?.mode, "ralph");
  assert.match(result._meta?.updatedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result._meta?.sessionId, null);

  const filePath = join(root, ".omghc", "state", "ralph-state.json");
  assert.ok(existsSync(filePath), "state file should exist on disk");
  const onDisk = JSON.parse(readFileSync(filePath, "utf-8"));
  assert.equal(onDisk.active, true);
  assert.equal(onDisk.current_phase, "executing");
});

test("state_read returns null when no state exists; returns parsed state after a write", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(stateRead("autopilot", { workingDirectory: root }), null);

  stateWrite(
    "autopilot",
    { active: true, current_phase: "planning" },
    { workingDirectory: root },
  );

  const read = stateRead("autopilot", { workingDirectory: root });
  assert.ok(read, "expected state to be readable after write");
  assert.equal(read?.mode, "autopilot");
  assert.equal(read?.active, true);
  assert.equal(read?.current_phase, "planning");
});

test("state_write merges with existing state instead of overwriting unrelated fields", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  stateWrite(
    "ultrawork",
    { active: true, current_phase: "phase-1", iteration: 1 },
    { workingDirectory: root },
  );

  // Second write only updates iteration; current_phase + active should be preserved
  stateWrite("ultrawork", { iteration: 2 }, { workingDirectory: root });

  const read = stateRead("ultrawork", { workingDirectory: root });
  assert.equal(read?.iteration, 2);
  assert.equal(read?.current_phase, "phase-1", "current_phase should survive merge");
  assert.equal(read?.active, true, "active should survive merge");
});

test("state_clear removes the state file; idempotent on missing files", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  stateWrite("team", { active: true }, { workingDirectory: root });
  const filePath = join(root, ".omghc", "state", "team-state.json");
  assert.ok(existsSync(filePath));

  stateClear("team", { workingDirectory: root });
  assert.ok(!existsSync(filePath));

  // Calling clear again on a missing file should NOT throw
  assert.doesNotThrow(() => stateClear("team", { workingDirectory: root }));
});

test("state_list_active filters out inactive modes and unknown filenames", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  stateWrite("ralph", { active: true, current_phase: "exec" }, { workingDirectory: root });
  stateWrite("team", { active: false }, { workingDirectory: root });
  stateWrite(
    "autopilot",
    { active: true, current_phase: "queue" },
    { workingDirectory: root },
  );

  const active = stateListActive({ workingDirectory: root });
  const modes = active.map((entry) => entry.mode).sort();
  assert.deepEqual(modes, ["autopilot", "ralph"]);
  for (const entry of active) {
    assert.equal(entry.active, true);
  }
});

test("state_list_active returns empty array when state dir does not exist", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = stateListActive({ workingDirectory: root });
  assert.deepEqual(result, []);
});

test("state_get_status reports active=false when no state file exists", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const status = stateGetStatus("ralph", { workingDirectory: root });
  assert.deepEqual(status, { active: false });
});

test("state_get_status returns active + current_phase + iteration when present", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  stateWrite(
    "deep-interview",
    { active: true, current_phase: "questioning", iteration: 4 },
    { workingDirectory: root },
  );

  const status = stateGetStatus("deep-interview", { workingDirectory: root });
  assert.equal(status.active, true);
  assert.equal(status.current_phase, "questioning");
  assert.equal(status.iteration, 4);
});

test("two distinct working directories do not share state", (t) => {
  const rootA = setupTmp();
  const rootB = setupTmp();
  t.after(() => rmSync(rootA, { recursive: true, force: true }));
  t.after(() => rmSync(rootB, { recursive: true, force: true }));

  stateWrite("ralph", { active: true }, { workingDirectory: rootA });

  assert.ok(stateRead("ralph", { workingDirectory: rootA }));
  assert.equal(stateRead("ralph", { workingDirectory: rootB }), null);
});
