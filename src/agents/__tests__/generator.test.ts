import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAgentMarkdown } from "../generateAgentMarkdown.js";

test("minimal spec produces description-only frontmatter", () => {
  const result = generateAgentMarkdown({
    name: "Test",
    description: "A test agent.",
    body: "# Body",
  });
  assert.equal(result.fileName, "test");
  assert.match(
    result.content,
    /^---\ndescription: "A test agent\."\n---\n\n# Body\n$/,
  );
  assert.ok(!result.content.includes("model:"));
  assert.ok(!result.content.includes("tools:"));
  assert.ok(!result.content.includes("skills:"));
  assert.ok(!result.content.includes("x-omghc:"));
});

test("model field is emitted as quoted scalar", () => {
  const result = generateAgentMarkdown({
    name: "Worker",
    description: "Worker agent.",
    model: "claude-sonnet-4.5",
    body: "body",
  });
  assert.match(result.content, /\nmodel: "claude-sonnet-4\.5"\n/);
});

test("tools array renders as YAML block list", () => {
  const result = generateAgentMarkdown({
    name: "Worker",
    description: "x",
    tools: ["Read", "Write"],
    body: "body",
  });
  assert.match(result.content, /\ntools:\n {2}- Read\n {2}- Write\n/);
});

test("skills array renders as YAML block list", () => {
  const result = generateAgentMarkdown({
    name: "Worker",
    description: "x",
    skills: ["alpha", "beta"],
    body: "body",
  });
  assert.match(result.content, /\nskills:\n {2}- alpha\n {2}- beta\n/);
});

test("system field with newlines uses literal block scalar", () => {
  const result = generateAgentMarkdown({
    name: "Worker",
    description: "x",
    system: "line one\nline two\nline three",
    body: "body",
  });
  assert.match(result.content, /\nsystem: \|\n {2}line one\n {2}line two\n {2}line three\n/);
});

test("fileName sanitizes special characters", () => {
  const result = generateAgentMarkdown({
    name: "Ralph Loop!",
    description: "x",
    body: "b",
  });
  assert.equal(result.fileName, "ralph-loop");
});

test("fileName collapses runs of dashes and trims edges", () => {
  const result = generateAgentMarkdown({
    name: "--foo--bar--",
    description: "x",
    body: "b",
  });
  assert.equal(result.fileName, "foo-bar");
});

test("xOmghc non-empty produces x-omghc namespace; empty omits it", () => {
  const withMeta = generateAgentMarkdown({
    name: "a",
    description: "x",
    xOmghc: { posture: "deep-worker", routing: "executor" },
    body: "b",
  });
  assert.match(withMeta.content, /\nx-omghc:\n {2}posture: "deep-worker"\n {2}routing: "executor"\n/);

  const empty = generateAgentMarkdown({
    name: "b",
    description: "x",
    xOmghc: {},
    body: "b",
  });
  assert.ok(!empty.content.includes("x-omghc:"));
});

test("description containing a double quote uses single-quoted form", () => {
  const result = generateAgentMarkdown({
    name: "q",
    description: 'has "quote" inside',
    body: "b",
  });
  assert.match(result.content, /\ndescription: 'has "quote" inside'\n/);
});

test("frontmatter ordering: description, model, system, tools, skills, x-omghc", () => {
  const result = generateAgentMarkdown({
    name: "ordered",
    description: "d",
    model: "m",
    system: "s",
    tools: ["t1"],
    skills: ["sk1"],
    xOmghc: { k: "v" },
    body: "b",
  });
  const idxDesc = result.content.indexOf("description:");
  const idxModel = result.content.indexOf("model:");
  const idxSystem = result.content.indexOf("system:");
  const idxTools = result.content.indexOf("tools:");
  const idxSkills = result.content.indexOf("skills:");
  const idxXOmghc = result.content.indexOf("x-omghc:");
  assert.ok(idxDesc < idxModel);
  assert.ok(idxModel < idxSystem);
  assert.ok(idxSystem < idxTools);
  assert.ok(idxTools < idxSkills);
  assert.ok(idxSkills < idxXOmghc);
});
