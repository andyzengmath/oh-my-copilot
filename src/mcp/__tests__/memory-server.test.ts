import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildMemoryServerTools,
  handleMemoryToolCall,
  notepadPrune,
  notepadRead,
  notepadStats,
  notepadWriteManual,
  notepadWritePriority,
  notepadWriteWorking,
  projectMemoryAddDirective,
  projectMemoryAddNote,
  projectMemoryRead,
  projectMemoryWrite,
} from "../memory-server.js";

function setupTmp(): string {
  return mkdtempSync(join(tmpdir(), "omghc-memory-server-test-"));
}

test("buildMemoryServerTools advertises the 10 expected tools", () => {
  const tools = buildMemoryServerTools();
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "notepad_prune",
    "notepad_read",
    "notepad_stats",
    "notepad_write_manual",
    "notepad_write_priority",
    "notepad_write_working",
    "project_memory_add_directive",
    "project_memory_add_note",
    "project_memory_read",
    "project_memory_write",
  ]);
});

test("notepad_read returns empty strings when no notepad files exist", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = await notepadRead({ workingDirectory: root });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, { priority: "", working: "", manual: "" });
  }
});

test("notepad_write_priority appends a timestamped entry that survives subsequent reads", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const writeResult = await notepadWritePriority({
    workingDirectory: root,
    content: "ship the prototype",
  });
  assert.equal(writeResult.ok, true);

  const readResult = await notepadRead({ workingDirectory: root });
  assert.equal(readResult.ok, true);
  if (readResult.ok) {
    assert.match(readResult.data?.priority ?? "", /\[\d{4}-\d{2}-\d{2}T.*Z\] ship the prototype/);
    assert.equal(readResult.data?.working, "");
    assert.equal(readResult.data?.manual, "");
  }
});

test("notepad_write_priority rejects empty content with ok=false", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = await notepadWritePriority({
    workingDirectory: root,
    content: "",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /non-empty/);
  }
});

test("notepad writes go to the right section: working and manual are independent", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  await notepadWriteWorking({ workingDirectory: root, content: "in progress" });
  await notepadWriteManual({ workingDirectory: root, content: "manual note" });

  const read = await notepadRead({ workingDirectory: root });
  assert.equal(read.ok, true);
  if (read.ok) {
    assert.equal(read.data?.priority, "");
    assert.match(read.data?.working ?? "", /in progress/);
    assert.match(read.data?.manual ?? "", /manual note/);
  }
});

test("notepad_stats reports word/line counts per section", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  await notepadWritePriority({
    workingDirectory: root,
    content: "alpha beta gamma",
  });

  const stats = await notepadStats({ workingDirectory: root });
  assert.equal(stats.ok, true);
  if (stats.ok) {
    // Timestamp prefix [...] adds 1 word; the entry itself contributes 3.
    assert.ok(
      (stats.data?.priority.words ?? 0) >= 4,
      `expected priority words >= 4, got ${stats.data?.priority.words}`,
    );
    assert.equal(stats.data?.priority.lines, 1);
    assert.deepEqual(stats.data?.working, { words: 0, lines: 0 });
    assert.deepEqual(stats.data?.manual, { words: 0, lines: 0 });
  }
});

test("notepad_prune drops entries older than the cutoff but keeps fresh ones", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // Manually seed a priority notepad with a stale entry + a fresh entry
  const notepadDir = join(root, ".omghc", "memory", "notepad");
  mkdirSync(notepadDir, { recursive: true });
  const stale = "2000-01-01T00:00:00.000Z";
  const fresh = new Date().toISOString();
  writeFileSync(
    join(notepadDir, "priority.md"),
    `[${stale}] ancient entry\n[${fresh}] still good\n`,
    "utf-8",
  );

  const prune = await notepadPrune({ workingDirectory: root, days: 30 });
  assert.equal(prune.ok, true);
  if (prune.ok) {
    assert.equal(prune.data?.removed, 1);
  }

  const read = await notepadRead({ workingDirectory: root });
  if (read.ok) {
    assert.doesNotMatch(read.data?.priority ?? "", /ancient/);
    assert.match(read.data?.priority ?? "", /still good/);
  }
});

test("notepad_prune rejects negative or non-finite days values", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const negative = await notepadPrune({ workingDirectory: root, days: -1 });
  assert.equal(negative.ok, false);

  const nan = await notepadPrune({ workingDirectory: root, days: Number.NaN });
  assert.equal(nan.ok, false);
});

test("project_memory_read returns empty defaults when no file exists", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = await projectMemoryRead({ workingDirectory: root });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data, { directives: [], notes: [] });
  }
});

test("project_memory_add_directive + add_note append entries with timestamps", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  await projectMemoryAddDirective({
    workingDirectory: root,
    directive: "always run tests before commit",
  });
  await projectMemoryAddNote({
    workingDirectory: root,
    note: "build is now green",
  });

  const read = await projectMemoryRead({ workingDirectory: root });
  assert.equal(read.ok, true);
  if (read.ok) {
    assert.equal(read.data?.directives.length, 1);
    assert.equal(read.data?.directives[0]?.text, "always run tests before commit");
    assert.match(read.data?.directives[0]?.timestamp ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(read.data?.notes.length, 1);
    assert.equal(read.data?.notes[0]?.text, "build is now green");
  }
});

test("project_memory_write rejects non-object payloads with ok=false", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = await projectMemoryWrite({
    workingDirectory: root,
    data: "not an object",
  });
  assert.equal(result.ok, false);
});

test("project_memory_write replaces directives + notes wholesale", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  await projectMemoryAddDirective({ workingDirectory: root, directive: "old" });
  await projectMemoryWrite({
    workingDirectory: root,
    data: {
      directives: [{ text: "new", timestamp: "2026-01-01T00:00:00.000Z" }],
      notes: [],
    },
  });

  const read = await projectMemoryRead({ workingDirectory: root });
  if (read.ok) {
    assert.equal(read.data?.directives.length, 1);
    assert.equal(read.data?.directives[0]?.text, "new");
  }
});

test("handleMemoryToolCall dispatches notepad_write_priority and project_memory_read", async (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const writeResp = await handleMemoryToolCall({
    params: {
      name: "notepad_write_priority",
      arguments: { workingDirectory: root, content: "via dispatch" },
    },
  });
  assert.equal(writeResp.isError, undefined);
  const writeBody = JSON.parse(writeResp.content[0]?.text ?? "{}");
  assert.equal(writeBody.ok, true);

  const readResp = await handleMemoryToolCall({
    params: {
      name: "project_memory_read",
      arguments: { workingDirectory: root },
    },
  });
  const readBody = JSON.parse(readResp.content[0]?.text ?? "{}");
  assert.equal(readBody.ok, true);
  assert.deepEqual(readBody.data, { directives: [], notes: [] });
});

test("handleMemoryToolCall returns isError=true for unknown tools", async () => {
  const resp = await handleMemoryToolCall({
    params: { name: "definitely_not_a_tool", arguments: {} },
  });
  assert.equal(resp.isError, true);
  const body = JSON.parse(resp.content[0]?.text ?? "{}");
  assert.equal(body.ok, false);
  assert.match(body.error, /Unknown tool/);
});
