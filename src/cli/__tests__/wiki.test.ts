import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWiki } from "../wiki.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "omghc-cli-wiki-test-"));
}

function input(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

test("runWiki() with no args prints help and exits 0", async () => {
  const code = await runWiki([]);
  assert.equal(code, 0);
});

test("runWiki(['--help']) exits 0", async () => {
  const code = await runWiki(["--help"]);
  assert.equal(code, 0);
});

test("runWiki(['help']) exits 0", async () => {
  const code = await runWiki(["help"]);
  assert.equal(code, 0);
});

test("runWiki(['-h']) exits 0", async () => {
  const code = await runWiki(["-h"]);
  assert.equal(code, 0);
});

test("runWiki(['unknown-sub']) exits 2", async () => {
  const code = await runWiki(["unknown-sub"]);
  assert.equal(code, 2);
});

test("runWiki parseArgs: missing --input value exits 2", async () => {
  const code = await runWiki(["read", "--input"]);
  assert.equal(code, 2);
});

test("runWiki parseArgs: invalid JSON exits 2", async () => {
  const code = await runWiki(["read", "--input", "{ bogus"]);
  assert.equal(code, 2);
});

test("runWiki parseArgs: array input rejected (not object) exits 2", async () => {
  const code = await runWiki(["read", "--input", "[]"]);
  assert.equal(code, 2);
});

test("runWiki parseArgs: unknown flag exits 2", async () => {
  const code = await runWiki(["list", "--bogus"]);
  assert.equal(code, 2);
});

test("runWiki list on empty dir succeeds (exit 0)", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runWiki([
    "list",
    "--input",
    input({ workingDirectory: dir }),
  ]);
  assert.equal(code, 0);
});

test("runWiki list with --json on empty dir succeeds", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runWiki([
    "list",
    "--json",
    "--input",
    input({ workingDirectory: dir }),
  ]);
  assert.equal(code, 0);
});

test("runWiki read on missing slug returns ok:false exit 1", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runWiki([
    "read",
    "--input",
    input({ slug: "no-such-page", workingDirectory: dir }),
  ]);
  assert.equal(code, 1);
});

test("runWiki read missing slug field exits 1", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runWiki([
    "read",
    "--input",
    input({ workingDirectory: dir }),
  ]);
  assert.equal(code, 1);
});

test("runWiki write + read round-trip succeeds", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const writeCode = await runWiki([
    "write",
    "--input",
    input({
      slug: "intro",
      title: "Introduction",
      body: "# Hello world",
      tags: ["intro", "hello"],
      workingDirectory: dir,
    }),
  ]);
  assert.equal(writeCode, 0);

  const readCode = await runWiki([
    "read",
    "--input",
    input({ slug: "intro", workingDirectory: dir }),
  ]);
  assert.equal(readCode, 0);
});

test("runWiki write missing required field exits 1", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Missing body
  const code = await runWiki([
    "write",
    "--input",
    input({
      slug: "x",
      title: "Y",
      workingDirectory: dir,
    }),
  ]);
  assert.equal(code, 1);
});

test("runWiki write with non-string-array tags is filtered", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // tags array with mix of strings and non-strings: non-strings filtered out.
  const code = await runWiki([
    "write",
    "--input",
    input({
      slug: "filtered",
      title: "T",
      body: "B",
      tags: ["valid", 42, null, "also-valid"],
      workingDirectory: dir,
    }),
  ]);
  assert.equal(code, 0);
});

test("runWiki search succeeds on empty dir", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runWiki([
    "search",
    "--input",
    input({ query: "nothing", workingDirectory: dir }),
  ]);
  assert.equal(code, 0);
});

test("runWiki search missing query exits 1", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runWiki([
    "search",
    "--input",
    input({ workingDirectory: dir }),
  ]);
  assert.equal(code, 1);
});

test("runWiki search with limit succeeds", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runWiki([
    "search",
    "--input",
    input({ query: "test", limit: 5, workingDirectory: dir }),
  ]);
  assert.equal(code, 0);
});

test("runWiki lint on empty dir succeeds", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runWiki([
    "lint",
    "--input",
    input({ workingDirectory: dir }),
  ]);
  assert.equal(code, 0);
});

test("runWiki refresh on empty dir succeeds", async (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const code = await runWiki([
    "refresh",
    "--input",
    input({ workingDirectory: dir }),
  ]);
  assert.equal(code, 0);
});
