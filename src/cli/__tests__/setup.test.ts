import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetup } from "../setup.js";

const ORIGINAL_COPILOT_HOME = process.env.COPILOT_HOME;

function setupTmp(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "omghc-setup-test-"));
  process.env.COPILOT_HOME = dir;
  t.after(() => {
    if (ORIGINAL_COPILOT_HOME === undefined) {
      delete process.env.COPILOT_HOME;
    } else {
      process.env.COPILOT_HOME = ORIGINAL_COPILOT_HOME;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function silenceStdio(t: TestContext): void {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  t.after(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  });
}

test(
  "fresh install (--plugin) creates agents, instructions, settings, stamp",
  { concurrency: false },
  async (t) => {
    const dir = setupTmp(t);
    silenceStdio(t);
    const code = await runSetup(["--scope=user", "--plugin"]);
    assert.equal(code, 0, "exit code should be 0");

    const agentsDir = join(dir, "agents");
    assert.ok(existsSync(agentsDir), "agents/ should exist");
    const agentFiles = readdirSync(agentsDir).filter((f) =>
      f.endsWith(".agent.md"),
    );
    assert.ok(
      agentFiles.length >= 1,
      `expected >=1 .agent.md files, got ${agentFiles.length}`,
    );

    const instructionsPath = join(dir, "instructions.md");
    assert.ok(existsSync(instructionsPath), "instructions.md should exist");
    const instructions = readFileSync(instructionsPath, "utf8");
    assert.ok(
      instructions.includes("<!-- OMGHC:INSTRUCTIONS:START -->"),
      "instructions.md should contain start marker",
    );

    const settingsPath = join(dir, "settings.json");
    assert.ok(existsSync(settingsPath), "settings.json should exist");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<
      string,
      unknown
    >;
    const ns = settings._omghc as Record<string, unknown> | undefined;
    assert.equal(ns?.managed, true, "settings._omghc.managed must be true");

    const stampPath = join(dir, ".omghc-setup-stamp");
    assert.ok(existsSync(stampPath), ".omghc-setup-stamp should exist");
    const stamp = JSON.parse(readFileSync(stampPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(typeof stamp.timestamp, "string");
    assert.equal(stamp.scope, "user");
  },
);

test(
  "setup --dry-run does not write any files",
  { concurrency: false },
  async (t) => {
    const dir = setupTmp(t);
    silenceStdio(t);
    const code = await runSetup(["--scope=user", "--dry-run"]);
    assert.equal(code, 0);

    assert.ok(!existsSync(join(dir, "agents")), "agents/ should NOT exist");
    assert.ok(
      !existsSync(join(dir, "instructions.md")),
      "instructions.md should NOT exist",
    );
    assert.ok(
      !existsSync(join(dir, "settings.json")),
      "settings.json should NOT exist",
    );
    assert.ok(
      !existsSync(join(dir, ".omghc-setup-stamp")),
      "stamp should NOT exist",
    );
  },
);

test(
  "setup --legacy copies bundled skills under skills/",
  { concurrency: false },
  async (t) => {
    const dir = setupTmp(t);
    silenceStdio(t);
    const code = await runSetup(["--scope=user", "--legacy"]);
    assert.equal(code, 0);

    const skillsDir = join(dir, "skills");
    assert.ok(existsSync(skillsDir), "skills/ should exist");
    const skillEntries = readdirSync(skillsDir);
    assert.ok(
      skillEntries.length >= 1,
      `expected >=1 skill subdirs, got ${skillEntries.length}`,
    );
    // At least one skill must have its SKILL.md copied.
    const hasSkillMd = skillEntries.some((name) =>
      existsSync(join(skillsDir, name, "SKILL.md")),
    );
    assert.ok(hasSkillMd, "expected at least one <skill>/SKILL.md");
  },
);

test(
  "setup merges existing settings.json without clobbering user fields",
  { concurrency: false },
  async (t) => {
    const dir = setupTmp(t);
    silenceStdio(t);
    const settingsPath = join(dir, "settings.json");
    const existing = {
      preferences: { theme: "light" },
      userField: "preserved",
    };
    writeFileSync(settingsPath, JSON.stringify(existing, null, 2), "utf8");

    const code = await runSetup(["--scope=user"]);
    assert.equal(code, 0);

    const merged = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(merged.userField, "preserved", "userField must survive");
    const prefs = merged.preferences as Record<string, unknown> | undefined;
    assert.equal(prefs?.theme, "light", "user theme must survive");
    const ns = merged._omghc as Record<string, unknown> | undefined;
    assert.equal(ns?.managed, true, "_omghc.managed must be set");
  },
);

test(
  "setup preserves existing instructions.md without --force or --merge-agents",
  { concurrency: false },
  async (t) => {
    const dir = setupTmp(t);
    silenceStdio(t);
    const instrPath = join(dir, "instructions.md");
    const original = "# My instructions\nUser content\n";
    writeFileSync(instrPath, original, "utf8");

    const code = await runSetup(["--scope=user"]);
    assert.equal(code, 0, "setup should succeed even when skipping the file");

    const after = readFileSync(instrPath, "utf8");
    assert.equal(after, original, "instructions.md must be unchanged");
  },
);

test(
  "setup --merge-agents replaces only the OMGHC marker section in instructions.md",
  { concurrency: false },
  async (t) => {
    const dir = setupTmp(t);
    silenceStdio(t);
    const instrPath = join(dir, "instructions.md");
    const original = [
      "# User header",
      "<!-- OMGHC:INSTRUCTIONS:START -->",
      "OLD MANAGED CONTENT",
      "<!-- OMGHC:INSTRUCTIONS:END -->",
      "# User footer",
      "",
    ].join("\n");
    writeFileSync(instrPath, original, "utf8");

    const code = await runSetup(["--scope=user", "--merge-agents"]);
    assert.equal(code, 0);

    const after = readFileSync(instrPath, "utf8");
    assert.ok(after.includes("# User header"), "user header must survive");
    assert.ok(after.includes("# User footer"), "user footer must survive");
    assert.ok(
      !after.includes("OLD MANAGED CONTENT"),
      "old marker block should be replaced",
    );
    assert.ok(
      after.includes("<!-- OMGHC:INSTRUCTIONS:START -->"),
      "start marker must remain",
    );
    assert.ok(
      after.includes("<!-- OMGHC:INSTRUCTIONS:END -->"),
      "end marker must remain",
    );
  },
);

test(
  "setup writes valid JSON in settings.json",
  { concurrency: false },
  async (t) => {
    const dir = setupTmp(t);
    silenceStdio(t);
    const code = await runSetup(["--scope=user"]);
    assert.equal(code, 0);

    const raw = readFileSync(join(dir, "settings.json"), "utf8");
    assert.doesNotThrow(() => JSON.parse(raw), "settings.json must be parseable");
  },
);
