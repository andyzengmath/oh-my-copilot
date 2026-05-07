import { test } from "node:test";
import assert from "node:assert/strict";
import { runList } from "../list.js";

interface ListItem {
  name: string;
  description: string;
  path: string;
}

interface ListJson {
  skills?: ListItem[];
  prompts?: ListItem[];
  agents?: ListItem[];
  summary: { skills: number; prompts: number; agents: number };
}

async function captureStdoutAsync<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = await fn();
    return { result, stdout: chunks.join("") };
  } finally {
    process.stdout.write = original;
  }
}

test("runList(['--json']) returns valid JSON with summary keys and M1a counts", async () => {
  const { result, stdout } = await captureStdoutAsync(() => runList(["--json"]));
  assert.equal(result, 0);
  const parsed = JSON.parse(stdout) as ListJson;
  assert.ok("skills" in parsed, "expected `skills` key in JSON output");
  assert.ok("prompts" in parsed, "expected `prompts` key in JSON output");
  assert.ok("agents" in parsed, "expected `agents` key in JSON output");
  assert.ok("summary" in parsed, "expected `summary` key in JSON output");
  assert.equal(parsed.summary.skills, 35);
  assert.equal(parsed.summary.prompts, 33);
});

test("runList(['--json', '--skills-only']) returns only skills", async () => {
  const { result, stdout } = await captureStdoutAsync(() =>
    runList(["--json", "--skills-only"]),
  );
  assert.equal(result, 0);
  const parsed = JSON.parse(stdout) as ListJson;
  assert.ok(Array.isArray(parsed.skills), "expected skills to be an array");
  assert.equal(parsed.skills?.length, 35);
  assert.equal(parsed.prompts, undefined, "prompts should be omitted");
  assert.equal(parsed.agents, undefined, "agents should be omitted");
});

test("runList([]) human output contains SKILLS (35): and PROMPTS (33): headers", async () => {
  const { result, stdout } = await captureStdoutAsync(() => runList([]));
  assert.equal(result, 0);
  assert.ok(
    stdout.includes("SKILLS (35):"),
    `expected 'SKILLS (35):' in output, got:\n${stdout.slice(0, 400)}`,
  );
  assert.ok(
    stdout.includes("PROMPTS (33):"),
    `expected 'PROMPTS (33):' in output, got:\n${stdout.slice(0, 400)}`,
  );
});

test("runList(['--json']) skills are sorted alphabetically", async () => {
  const { result, stdout } = await captureStdoutAsync(() => runList(["--json"]));
  assert.equal(result, 0);
  const parsed = JSON.parse(stdout) as ListJson;
  const names = (parsed.skills ?? []).map((s) => s.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(names, sorted, "skills should be sorted alphabetically by name");
});
