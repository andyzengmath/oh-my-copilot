import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "../index.js";

test("runCli('version') exits 0", async () => {
  // version writes to stdout but doesn't throw; we just check the exit code.
  const code = await runCli(["version"]);
  assert.equal(code, 0);
});

test("runCli('help') exits 0", async () => {
  const code = await runCli(["help"]);
  assert.equal(code, 0);
});

test("runCli('status') exits 0", async () => {
  const code = await runCli(["status"]);
  assert.equal(code, 0);
});

test("runCli('setup') is a stub and exits 0", async () => {
  const code = await runCli(["setup"]);
  assert.equal(code, 0);
});

test("runCli('bogus-command') exits 2", async () => {
  const code = await runCli(["bogus-command"]);
  assert.equal(code, 2);
});

test("runCli([]) shows help and exits 0", async () => {
  const code = await runCli([]);
  assert.equal(code, 0);
});
