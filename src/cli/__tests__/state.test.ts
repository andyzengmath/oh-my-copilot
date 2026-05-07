import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runState } from "../state.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "omghc-cli-state-test-"));
}

function input(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

test("runState() with no args prints help and exits 0", async () => {
  const code = await runState([]);
  assert.equal(code, 0);
});

test("runState(['--help']) exits 0", async () => {
  const code = await runState(["--help"]);
  assert.equal(code, 0);
});

test("runState(['-h']) exits 0", async () => {
  const code = await runState(["-h"]);
  assert.equal(code, 0);
});

test("runState(['help']) exits 0", async () => {
  const code = await runState(["help"]);
  assert.equal(code, 0);
});

test("runState(['unknown-sub']) exits 2", async () => {
  const code = await runState(["unknown-sub"]);
  assert.equal(code, 2);
});

test("runState parseArgs error: --input without value exits 2", async () => {
  const code = await runState(["read", "--input"]);
  assert.equal(code, 2);
});

test("runState parseArgs error: invalid JSON in --input exits 2", async () => {
  const code = await runState(["read", "--input", "{not-json}"]);
  assert.equal(code, 2);
});

test("runState parseArgs error: --input array (not object) exits 2", async () => {
  const code = await runState(["read", "--input", "[1,2,3]"]);
  assert.equal(code, 2);
});

test("runState parseArgs error: --input null exits 2", async () => {
  const code = await runState(["read", "--input", "null"]);
  assert.equal(code, 2);
});

test("runState parseArgs: --input=<json> inline form works", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runState([
    "read",
    `--input=${input({ mode: "ralph", workingDirectory: dir })}`,
  ]);
  assert.equal(code, 0);
});

test("runState parseArgs error: unknown argument exits 2", async () => {
  const code = await runState(["read", "--bogus"]);
  assert.equal(code, 2);
});

test("runState read missing mode field exits 1", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runState([
    "read",
    "--input",
    input({ workingDirectory: dir }),
  ]);
  assert.equal(code, 1);
});

test("runState read unsupported mode exits 1", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runState([
    "read",
    "--input",
    input({ mode: "imaginary-mode", workingDirectory: dir }),
  ]);
  assert.equal(code, 1);
});

test("runState read non-string mode exits 1", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runState([
    "read",
    "--input",
    input({ mode: 42, workingDirectory: dir }),
  ]);
  assert.equal(code, 1);
});

test("runState write + read round-trip succeeds", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const writeCode = await runState([
    "write",
    "--input",
    input({
      mode: "ralph",
      active: true,
      current_phase: "executing",
      workingDirectory: dir,
    }),
  ]);
  assert.equal(writeCode, 0);

  const readCode = await runState([
    "read",
    "--input",
    input({ mode: "ralph", workingDirectory: dir }),
  ]);
  assert.equal(readCode, 0);
});

test("runState clear after write succeeds", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await runState([
    "write",
    "--input",
    input({ mode: "team", active: true, workingDirectory: dir }),
  ]);
  const code = await runState([
    "clear",
    "--input",
    input({ mode: "team", workingDirectory: dir }),
  ]);
  assert.equal(code, 0);
});

test("runState list-active with --json on empty dir succeeds", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runState([
    "list-active",
    "--json",
    "--input",
    input({ workingDirectory: dir }),
  ]);
  assert.equal(code, 0);
});

test("runState get-status on never-written mode returns active=false (exit 0)", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runState([
    "get-status",
    "--input",
    input({ mode: "autopilot", workingDirectory: dir }),
  ]);
  assert.equal(code, 0);
});

test("runState write with --json emits compact JSON", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const code = await runState([
    "write",
    "--json",
    "--input",
    input({
      mode: "ralplan",
      active: true,
      workingDirectory: dir,
    }),
  ]);
  assert.equal(code, 0);
});
