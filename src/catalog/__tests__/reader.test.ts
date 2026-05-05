import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCatalog, readSkill, readPrompt } from "../reader.js";

function setupTmp(): string {
  return mkdtempSync(join(tmpdir(), "omghc-catalog-test-"));
}

test("readCatalog throws on a directory without skills/prompts/agents subdirs", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => readCatalog(root), /none of skills/);
});

test("readCatalog with empty skills/ returns empty arrays", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "skills"), { recursive: true });
  const catalog = readCatalog(root);
  assert.deepEqual(catalog.skills, []);
  assert.deepEqual(catalog.prompts, []);
  assert.deepEqual(catalog.agents, []);
});

test("readCatalog reads 2 skills, 2 prompts, 2 agents and sorts by name", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(join(root, "skills", "beta"), { recursive: true });
  writeFileSync(
    join(root, "skills", "beta", "SKILL.md"),
    "---\ndescription: beta skill\n---\nbeta body",
  );
  mkdirSync(join(root, "skills", "alpha"), { recursive: true });
  writeFileSync(
    join(root, "skills", "alpha", "SKILL.md"),
    "---\ndescription: alpha skill\n---\nalpha body",
  );

  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(join(root, "prompts", "zulu.md"), "zulu prompt");
  writeFileSync(join(root, "prompts", "yankee.md"), "yankee prompt");

  mkdirSync(join(root, "agents"), { recursive: true });
  writeFileSync(
    join(root, "agents", "delta.agent.md"),
    "---\ndescription: d\n---\ndelta body",
  );
  writeFileSync(
    join(root, "agents", "charlie.agent.md"),
    "---\ndescription: c\n---\ncharlie body",
  );

  const catalog = readCatalog(root);

  assert.equal(catalog.skills.length, 2);
  assert.equal(catalog.skills[0]?.name, "alpha");
  assert.equal(catalog.skills[1]?.name, "beta");

  assert.equal(catalog.prompts.length, 2);
  assert.equal(catalog.prompts[0]?.name, "yankee");
  assert.equal(catalog.prompts[1]?.name, "zulu");

  assert.equal(catalog.agents.length, 2);
  assert.equal(catalog.agents[0]?.name, "charlie");
  assert.equal(catalog.agents[1]?.name, "delta");
});

test("readSkill returns null for missing skill", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "skills"), { recursive: true });
  assert.equal(readSkill(join(root, "skills"), "nonexistent"), null);
});

test("readPrompt returns the entry with full content", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(join(root, "prompts", "demo.md"), "hello world\nline 2");
  const result = readPrompt(join(root, "prompts"), "demo");
  assert.ok(result);
  assert.equal(result.name, "demo");
  assert.equal(result.content, "hello world\nline 2");
  assert.match(result.path, /demo\.md$/);
});

test("frontmatter with description: hello parses to {description: 'hello'}", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "skills", "x"), { recursive: true });
  writeFileSync(
    join(root, "skills", "x", "SKILL.md"),
    "---\ndescription: hello\n---\nbody",
  );
  const skill = readSkill(join(root, "skills"), "x");
  assert.ok(skill);
  assert.equal(skill.frontmatter.description, "hello");
  assert.equal(skill.body, "body");
});

test("frontmatter parses YAML block list", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "agents"), { recursive: true });
  writeFileSync(
    join(root, "agents", "tools-agent.agent.md"),
    "---\ndescription: t\ntools:\n  - Read\n  - Write\n---\nbody",
  );
  const catalog = readCatalog(root);
  assert.equal(catalog.agents.length, 1);
  const fm = catalog.agents[0]?.frontmatter;
  assert.deepEqual(fm?.tools, ["Read", "Write"]);
});

test("readPrompt returns null for missing prompt", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "prompts"), { recursive: true });
  assert.equal(readPrompt(join(root, "prompts"), "nope"), null);
});

test("agents/.md (no .agent. suffix) are still discovered", (t) => {
  const root = setupTmp();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "agents"), { recursive: true });
  writeFileSync(
    join(root, "agents", "plain.md"),
    "---\ndescription: p\n---\nplain body",
  );
  const catalog = readCatalog(root);
  assert.equal(catalog.agents.length, 1);
  assert.equal(catalog.agents[0]?.name, "plain");
});
