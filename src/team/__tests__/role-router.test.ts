import { test } from "node:test";
import assert from "node:assert/strict";

import { createRoleRouter, type WorkerSlot } from "../role-router.js";

function slot(
  name: string,
  role: string,
  busy = false,
  taskCount = 0,
): WorkerSlot {
  return { name, role, busy, taskCount };
}

test("pickWorker(role) returns the least-loaded worker matching that role", () => {
  const router = createRoleRouter({
    workers: [
      slot("worker-1", "executor", false, 5),
      slot("worker-2", "executor", false, 1),
      slot("worker-3", "reviewer", false, 0),
      slot("worker-4", "executor", false, 3),
    ],
  });

  const picked = router.pickWorker("executor");
  assert.ok(picked);
  assert.equal(picked!.name, "worker-2");
  assert.equal(picked!.taskCount, 1);
});

test("markBusy excludes worker from excludeBusy=true picks", () => {
  const router = createRoleRouter({
    workers: [
      slot("w1", "executor", false, 0),
      slot("w2", "executor", false, 0),
    ],
  });

  router.markBusy("w1");
  const picked = router.pickWorker("executor", { excludeBusy: true });
  assert.ok(picked);
  assert.equal(picked!.name, "w2");

  router.markBusy("w2");
  const none = router.pickWorker("executor", { excludeBusy: true });
  assert.equal(none, null);

  // without excludeBusy, busy workers still picked
  const anyone = router.pickWorker("executor");
  assert.ok(anyone);
});

test("pickWorker returns null when no worker matches the requested role", () => {
  const router = createRoleRouter({
    workers: [
      slot("w1", "executor", false, 0),
      slot("w2", "reviewer", false, 0),
    ],
  });

  assert.equal(router.pickWorker("nonexistent"), null);
});

test("ties broken by index ascending (round-robin determinism)", () => {
  const router = createRoleRouter({
    workers: [
      slot("worker-A", "executor", false, 2),
      slot("worker-B", "executor", false, 2),
      slot("worker-C", "executor", false, 2),
    ],
  });

  // All have equal taskCount; first index wins.
  const first = router.pickWorker("executor");
  assert.ok(first);
  assert.equal(first!.name, "worker-A");

  // Returned slot is a clone; mutating it must not affect router state.
  first!.taskCount = 999;
  const again = router.pickWorker("executor");
  assert.equal(again!.name, "worker-A");
});

test("incrementTaskCount affects subsequent pick decisions", () => {
  const router = createRoleRouter({
    workers: [
      slot("a", "executor", false, 0),
      slot("b", "executor", false, 0),
    ],
  });

  router.incrementTaskCount("a");
  router.incrementTaskCount("a");
  const picked = router.pickWorker("executor");
  assert.equal(picked!.name, "b");
});

test("refreshWorkers replaces the entire roster", () => {
  const router = createRoleRouter({
    workers: [slot("old", "executor", false, 0)],
  });

  router.refreshWorkers([
    slot("new-1", "reviewer", false, 0),
    slot("new-2", "reviewer", true, 0),
  ]);

  assert.equal(router.pickWorker("executor"), null);
  const picked = router.pickWorker("reviewer", { excludeBusy: true });
  assert.equal(picked!.name, "new-1");
});

test("pickAnyWorker returns least-loaded across all roles, respects excludeBusy", () => {
  const router = createRoleRouter({
    workers: [
      slot("x", "exec", true, 0),
      slot("y", "review", false, 5),
      slot("z", "lint", false, 1),
    ],
  });

  const any = router.pickAnyWorker({ excludeBusy: true });
  assert.equal(any!.name, "z");

  const noBusyConstraint = router.pickAnyWorker();
  assert.equal(noBusyConstraint!.name, "x");
});
