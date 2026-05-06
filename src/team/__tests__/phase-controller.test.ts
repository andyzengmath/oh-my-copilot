import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPhaseController } from "../phase-controller.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "omghc-phase-test-"));
}

test("getCurrentPhase returns initial phase team-plan by default", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const controller = createPhaseController({
    team_name: "alpha",
    workingDirectory: dir,
  });

  assert.equal(controller.getCurrentPhase(), "team-plan");
  assert.equal(controller.getFixLoopCount(), 0);
  assert.deepEqual(controller.getHistory(), []);
});

test("getCurrentPhase respects custom initialPhase when no persisted state", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const controller = createPhaseController({
    team_name: "beta",
    workingDirectory: dir,
    initialPhase: "team-exec",
  });

  assert.equal(controller.getCurrentPhase(), "team-exec");
});

test("valid transition team-plan -> team-exec succeeds and updates phase", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const controller = createPhaseController({
    team_name: "gamma",
    workingDirectory: dir,
  });

  const event = controller.transitionPhase("team-exec", "kickoff");
  assert.equal(event.from, "team-plan");
  assert.equal(event.to, "team-exec");
  assert.equal(event.reason, "kickoff");
  assert.equal(typeof event.timestamp, "string");
  assert.equal(controller.getCurrentPhase(), "team-exec");
  assert.equal(controller.getHistory().length, 1);
});

test("invalid transition team-done -> team-plan throws INVALID_TRANSITION", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const controller = createPhaseController({
    team_name: "delta",
    workingDirectory: dir,
  });

  controller.transitionPhase("team-exec");
  controller.transitionPhase("team-verify");
  controller.transitionPhase("team-done");
  assert.equal(controller.getCurrentPhase(), "team-done");

  assert.throws(
    () => controller.transitionPhase("team-plan"),
    /INVALID_TRANSITION/,
  );
});

test("onPhaseChange listener fires on transitions and unsubscribe stops it", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const controller = createPhaseController({
    team_name: "epsilon",
    workingDirectory: dir,
  });

  const events: string[] = [];
  const off = controller.onPhaseChange((e) => {
    events.push(`${e.from}->${e.to}`);
  });

  controller.transitionPhase("team-exec");
  controller.transitionPhase("team-verify");
  off();
  controller.transitionPhase("team-done");

  assert.deepEqual(events, ["team-plan->team-exec", "team-exec->team-verify"]);
});

test("getFixLoopCount increments on team-verify -> team-fix transitions", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const controller = createPhaseController({
    team_name: "zeta",
    workingDirectory: dir,
    maxFixLoops: 5,
  });

  controller.transitionPhase("team-exec");
  controller.transitionPhase("team-verify");
  assert.equal(controller.getFixLoopCount(), 0);

  controller.transitionPhase("team-fix", "regression");
  assert.equal(controller.getFixLoopCount(), 1);

  controller.transitionPhase("team-exec");
  controller.transitionPhase("team-verify");
  controller.transitionPhase("team-fix", "regression-2");
  assert.equal(controller.getFixLoopCount(), 2);
});

test("State persists to .omghc/state/team-<name>/phase-state.json and is reloaded", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const team_name = "persisty";
  const stateFile = join(
    dir,
    ".omghc",
    "state",
    `team-${team_name}`,
    "phase-state.json",
  );

  const first = createPhaseController({
    team_name,
    workingDirectory: dir,
  });
  first.transitionPhase("team-exec", "go");
  first.transitionPhase("team-verify");

  assert.ok(existsSync(stateFile), "phase-state.json should exist on disk");
  const parsed = JSON.parse(readFileSync(stateFile, "utf-8")) as {
    current_phase: string;
    history: unknown[];
  };
  assert.equal(parsed.current_phase, "team-verify");
  assert.equal(parsed.history.length, 2);

  // Re-create controller — should pick up persisted state.
  const second = createPhaseController({
    team_name,
    workingDirectory: dir,
  });
  assert.equal(second.getCurrentPhase(), "team-verify");
  assert.equal(second.getHistory().length, 2);
});

test("transitionPhase to team-fix beyond maxFixLoops throws INVALID_TRANSITION", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const controller = createPhaseController({
    team_name: "capped",
    workingDirectory: dir,
    maxFixLoops: 1,
  });

  controller.transitionPhase("team-exec");
  controller.transitionPhase("team-verify");
  controller.transitionPhase("team-fix");
  assert.equal(controller.getFixLoopCount(), 1);

  controller.transitionPhase("team-exec");
  controller.transitionPhase("team-verify");
  assert.throws(
    () => controller.transitionPhase("team-fix"),
    /INVALID_TRANSITION/,
  );
});
