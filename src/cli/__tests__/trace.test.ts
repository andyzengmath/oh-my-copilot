import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTrace } from "../trace.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "omghc-cli-trace-test-"));
}

function input(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

test("runTrace() with no args prints help and exits 0", async () => {
  const code = await runTrace([]);
  assert.equal(code, 0);
});

test("runTrace(['--help']) exits 0", async () => {
  const code = await runTrace(["--help"]);
  assert.equal(code, 0);
});

test("runTrace(['help']) exits 0", async () => {
  const code = await runTrace(["help"]);
  assert.equal(code, 0);
});

test("runTrace(['-h']) exits 0", async () => {
  const code = await runTrace(["-h"]);
  assert.equal(code, 0);
});

test("runTrace(['unknown-sub']) exits 2", async () => {
  const code = await runTrace(["unknown-sub"]);
  assert.equal(code, 2);
});

test("runTrace parseArgs: missing --input value exits 2", async () => {
  const code = await runTrace(["summary", "--input"]);
  assert.equal(code, 2);
});

test("runTrace parseArgs: invalid JSON exits 2", async () => {
  const code = await runTrace(["summary", "--input", "{bad-json"]);
  assert.equal(code, 2);
});

test("runTrace parseArgs: array input rejected exits 2", async () => {
  const code = await runTrace(["summary", "--input", "[1]"]);
  assert.equal(code, 2);
});

test("runTrace parseArgs: unknown flag exits 2", async () => {
  const code = await runTrace(["summary", "--bogus"]);
  assert.equal(code, 2);
});

test("runTrace summary on empty dir succeeds with --json", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runTrace([
    "summary",
    "--json",
    "--input",
    input({ workingDirectory: dir }),
  ]);
  assert.equal(code, 0);
});

test("runTrace summary on empty dir without --json succeeds", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runTrace([
    "summary",
    "--input",
    input({ workingDirectory: dir }),
  ]);
  assert.equal(code, 0);
});

test("runTrace summary with since/until succeeds", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runTrace([
    "summary",
    "--input",
    input({
      workingDirectory: dir,
      since: "2026-01-01T00:00:00Z",
      until: "2026-12-31T23:59:59Z",
    }),
  ]);
  assert.equal(code, 0);
});

test("runTrace timeline on empty dir succeeds", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runTrace([
    "timeline",
    "--input",
    input({ workingDirectory: dir }),
  ]);
  assert.equal(code, 0);
});

test("runTrace timeline with limit + eventFilter succeeds", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runTrace([
    "timeline",
    "--input",
    input({
      workingDirectory: dir,
      limit: 10,
      eventFilter: "hook.preToolUse",
    }),
  ]);
  assert.equal(code, 0);
});

test("runTrace timeline with --input=<json> inline form works", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runTrace([
    "timeline",
    `--input=${input({ workingDirectory: dir })}`,
  ]);
  assert.equal(code, 0);
});
