import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimTask,
  createTask,
  listTasks,
  readTask,
  releaseClaim,
  transitionTaskStatus,
  updateTask,
} from "../tasks.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "omghc-tasks-test-"));
}

test("createTask + readTask round-trip with id and version=1", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const created = createTask(
    {
      team_name: "alpha",
      subject: "do the thing",
      description: "details",
      owner: "worker-1",
    },
    { workingDirectory: dir },
  );
  assert.equal(typeof created.id, "string");
  assert.notEqual(created.id, "");
  assert.equal(created.team_name, "alpha");
  assert.equal(created.subject, "do the thing");
  assert.equal(created.description, "details");
  assert.equal(created.owner, "worker-1");
  assert.equal(created.status, "pending");
  assert.equal(created.version, 1);
  assert.equal(created.claim_token, undefined);

  const round = readTask("alpha", created.id, { workingDirectory: dir });
  assert.deepEqual(round, created);
});

test("claimTask with correct expected_version succeeds; with stale version throws", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const created = createTask(
    { team_name: "alpha", subject: "claimable", description: "" },
    { workingDirectory: dir },
  );

  const { task, claim_token } = claimTask(
    "alpha",
    created.id,
    "worker-1",
    1,
    { workingDirectory: dir },
  );
  assert.equal(task.status, "claimed");
  assert.equal(task.owner, "worker-1");
  assert.equal(task.version, 2);
  assert.equal(typeof claim_token, "string");
  assert.notEqual(claim_token, "");

  assert.throws(
    () =>
      claimTask("alpha", created.id, "worker-2", 1, {
        workingDirectory: dir,
      }),
    /STALE_VERSION/,
  );
});

test("transitionTaskStatus with valid claim_token transitions; with mismatched token throws", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const created = createTask(
    { team_name: "beta", subject: "transition", description: "" },
    { workingDirectory: dir },
  );
  const { claim_token } = claimTask("beta", created.id, "worker-1", 1, {
    workingDirectory: dir,
  });

  const inProgress = transitionTaskStatus(
    "beta",
    created.id,
    "claimed",
    "in_progress",
    claim_token,
    { workingDirectory: dir },
  );
  assert.equal(inProgress.status, "in_progress");
  assert.equal(inProgress.version, 3);

  assert.throws(
    () =>
      transitionTaskStatus(
        "beta",
        created.id,
        "in_progress",
        "completed",
        "not-the-real-token",
        { workingDirectory: dir },
      ),
    /CLAIM_TOKEN_MISMATCH/,
  );

  const completed = transitionTaskStatus(
    "beta",
    created.id,
    "in_progress",
    "completed",
    claim_token,
    { workingDirectory: dir },
  );
  assert.equal(completed.status, "completed");
  // claim_token must be cleared on terminal transition.
  assert.equal(completed.claim_token, undefined);
});

test("listTasks returns all tasks for a team in deterministic numeric order", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const a = createTask(
    { team_name: "gamma", subject: "first", description: "" },
    { workingDirectory: dir },
  );
  const b = createTask(
    { team_name: "gamma", subject: "second", description: "" },
    { workingDirectory: dir },
  );
  const c = createTask(
    { team_name: "gamma", subject: "third", description: "" },
    { workingDirectory: dir },
  );
  // Different team — must NOT appear in listTasks("gamma").
  createTask(
    { team_name: "delta", subject: "other-team", description: "" },
    { workingDirectory: dir },
  );

  const list = listTasks("gamma", { workingDirectory: dir });
  assert.equal(list.length, 3);
  assert.deepEqual(
    list.map((task) => task.id),
    [a.id, b.id, c.id],
  );
  // numeric ordering: ids should be "1","2","3"
  assert.deepEqual(
    list.map((task) => task.id),
    ["1", "2", "3"],
  );
});

test("releaseClaim resets to pending and clears the claim token", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const created = createTask(
    { team_name: "epsilon", subject: "abandon-me", description: "" },
    { workingDirectory: dir },
  );
  const { claim_token } = claimTask(
    "epsilon",
    created.id,
    "worker-1",
    1,
    { workingDirectory: dir },
  );

  const released = releaseClaim(
    "epsilon",
    created.id,
    claim_token,
    "worker-1",
    { workingDirectory: dir },
  );
  assert.equal(released.status, "pending");
  assert.equal(released.owner, "");
  assert.equal(released.claim_token, undefined);
  assert.equal(released.version, 3);
});

test("updateTask merges fields and bumps version while preserving id/team_name", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const created = createTask(
    { team_name: "zeta", subject: "before", description: "" },
    { workingDirectory: dir },
  );

  const updated = updateTask(
    "zeta",
    created.id,
    {
      // attempt to change id/team_name should be ignored.
      id: "evil",
      team_name: "evil-team",
      subject: "after",
      metadata: { tag: "v1" },
    } as never,
    { workingDirectory: dir },
  );
  assert.equal(updated.id, created.id);
  assert.equal(updated.team_name, "zeta");
  assert.equal(updated.subject, "after");
  assert.equal(updated.version, 2);
  assert.deepEqual(updated.metadata, { tag: "v1" });
});
