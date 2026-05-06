import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MARKERS,
  generateOverlay,
  writeOverlayToFile,
} from "../agents-overlay.js";

function makeTmp(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "omghc-overlay-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeTemplate(t: TestContext, body: string): string {
  const dir = makeTmp(t);
  const path = join(dir, "AGENTS.md");
  writeFileSync(path, body, "utf8");
  return path;
}

test("generateOverlay returns object with full and managedOnly fields", (t) => {
  const tplPath = makeTemplate(t, "# Header\n\nbody\n");
  const out = generateOverlay({
    projectRoot: "/some/path",
    agentsTemplate: tplPath,
  });
  assert.equal(typeof out.full, "string");
  assert.equal(typeof out.managedOnly, "string");
  assert.ok(out.full.length > 0, "full should be non-empty");
  assert.ok(out.managedOnly.length > 0, "managedOnly should be non-empty");
  assert.ok(
    out.managedOnly.includes("/some/path"),
    "managed section should mention projectRoot",
  );
});

test("generateOverlay uses default template path when none provided", () => {
  const out = generateOverlay({ projectRoot: "/another/path" });
  assert.equal(typeof out.full, "string");
  assert.ok(
    out.full.includes("oh-my-ghcopilot"),
    "default template should produce OMGHC AGENTS.md content",
  );
  assert.ok(
    out.full.includes(DEFAULT_MARKERS.start),
    "default overlay must include start marker",
  );
  assert.ok(
    out.full.includes(DEFAULT_MARKERS.end),
    "default overlay must include end marker",
  );
});

test("writeOverlayToFile creates target file when it does not exist", (t) => {
  const tplPath = makeTemplate(t, "# Header\n\nbody\n");
  const dir = makeTmp(t);
  const target = join(dir, "nested", "AGENTS.md");
  const result = writeOverlayToFile(
    { projectRoot: dir, agentsTemplate: tplPath },
    target,
  );
  assert.equal(result.written, true);
  assert.ok(existsSync(target), "target should be created");
  const content = readFileSync(target, "utf8");
  assert.ok(content.includes(DEFAULT_MARKERS.start));
  assert.ok(content.includes(DEFAULT_MARKERS.end));
});

test("writeOverlayToFile preserves user content outside markers", (t) => {
  const tplPath = makeTemplate(t, "# Header\n\nbody\n");
  const dir = makeTmp(t);
  const target = join(dir, "AGENTS.md");
  const userContent = [
    "# User Notes",
    "",
    "Important user content above markers.",
    "",
    `${DEFAULT_MARKERS.start}`,
    "OLD MANAGED CONTENT",
    `${DEFAULT_MARKERS.end}`,
    "",
    "User trailer should remain untouched.",
    "",
  ].join("\n");
  writeFileSync(target, userContent, "utf8");

  const result = writeOverlayToFile(
    { projectRoot: dir, agentsTemplate: tplPath },
    target,
  );
  assert.equal(result.written, true);
  const after = readFileSync(target, "utf8");
  assert.ok(
    after.includes("# User Notes"),
    "user header outside markers must survive",
  );
  assert.ok(
    after.includes("Important user content above markers."),
    "user pre-marker body must survive",
  );
  assert.ok(
    !after.includes("OLD MANAGED CONTENT"),
    "old marker block contents must be replaced",
  );
  assert.ok(
    after.includes(DEFAULT_MARKERS.start),
    "start marker must remain",
  );
  assert.ok(after.includes(DEFAULT_MARKERS.end), "end marker must remain");
});

test("writeOverlayToFile is idempotent when managed section already matches", (t) => {
  const tplPath = makeTemplate(t, "# Header\n\nbody\n");
  const dir = makeTmp(t);
  const target = join(dir, "AGENTS.md");
  const first = writeOverlayToFile(
    { projectRoot: dir, agentsTemplate: tplPath },
    target,
  );
  assert.equal(first.written, true);
  const original = readFileSync(target, "utf8");

  const second = writeOverlayToFile(
    { projectRoot: dir, agentsTemplate: tplPath },
    target,
  );
  assert.equal(
    second.written,
    false,
    "second write should be a no-op when managed content matches",
  );
  const after = readFileSync(target, "utf8");
  assert.equal(after, original, "file content must be unchanged");
});

test("overlay content includes both <!-- OMGHC:AGENTS:START --> and END markers", (t) => {
  const tplPath = makeTemplate(t, "# Header\n\nbody\n");
  const out = generateOverlay({
    projectRoot: "/x",
    agentsTemplate: tplPath,
  });
  assert.ok(
    out.full.includes("<!-- OMGHC:AGENTS:START -->"),
    "must contain explicit start marker",
  );
  assert.ok(
    out.full.includes("<!-- OMGHC:AGENTS:END -->"),
    "must contain explicit end marker",
  );
  const startIdx = out.full.indexOf("<!-- OMGHC:AGENTS:START -->");
  const endIdx = out.full.indexOf("<!-- OMGHC:AGENTS:END -->");
  assert.ok(startIdx < endIdx, "start marker must precede end marker");
});
