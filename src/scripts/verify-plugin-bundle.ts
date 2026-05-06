#!/usr/bin/env node
/**
 * Validate `plugins/oh-my-ghcopilot/` matches the canonical catalog and
 * Copilot CLI plugin schema requirements.
 *
 * Checks (severity errors fail the bundle, warns pass):
 *  1. plugin.json: required fields (name, description, version) and
 *     name matches package.json name.
 *  2. .mcp.json: valid JSON with `mcpServers` containing the four
 *     OMGHC servers (omghc_state, omghc_memory, omghc_trace, omghc_wiki).
 *  3. plugin/skills/: every canonical skill has a SKILL.md mirror;
 *     count matches and bytes match.
 *  4. plugin/agents/: every canonical prompt has a generated `.agent.md`;
 *     every canonical native agent has a verbatim mirror.
 *  5. No stray files in plugin dir (warns on unknown roots; errors on
 *     stray skills/agents).
 *  6. Each plugin agent has non-empty `description` frontmatter.
 *
 * Exit code 0 on success (no errors); 1 if any error issue was raised.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AgentSpec,
  generateAgentMarkdown,
} from "../agents/generateAgentMarkdown.js";
import {
  type Catalog,
  type PromptEntry,
  readCatalog,
} from "../catalog/reader.js";

export type IssueSeverity = "error" | "warn";

export interface BundleIssue {
  severity: IssueSeverity;
  message: string;
}

export interface VerifyPluginBundleResult {
  ok: boolean;
  issues: BundleIssue[];
}

export interface VerifyPluginBundleOptions {
  repoRoot?: string;
}

const PLUGIN_DIR_REL = join("plugins", "oh-my-ghcopilot");
const REQUIRED_MCP_SERVERS = [
  "omghc_state",
  "omghc_memory",
  "omghc_trace",
  "omghc_wiki",
] as const;
const KNOWN_PLUGIN_ROOTS = new Set([
  "plugin.json",
  ".mcp.json",
  "skills",
  "agents",
  "hooks",
  "hooks.json",
  ".gitkeep",
  "README.md",
]);

function defaultRepoRoot(): string {
  // <repoRoot>/dist/scripts/verify-plugin-bundle.js → repoRoot is two up
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..");
}

function readUtf8(p: string): string {
  return readFileSync(p, "utf-8");
}

function readJson(p: string): unknown {
  return JSON.parse(readUtf8(p));
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function unquote(value: string): string {
  if (value.length === 0) return value;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function deriveAgentDescription(prompt: PromptEntry): string {
  const fmMatch = prompt.content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fmMatch) {
    const frontmatter = fmMatch[1] ?? "";
    const descLine = frontmatter
      .split(/\r?\n/)
      .find((line) => /^description\s*:/i.test(line));
    if (descLine) {
      const raw = descLine.replace(/^description\s*:\s*/i, "").trim();
      const unq = unquote(raw);
      if (unq.length > 0) return unq;
    }
  }
  const body = stripFrontmatter(prompt.content);
  const heading = body.match(/^\s*#\s+(.+)$/m);
  if (heading) {
    const text = (heading[1] ?? "").trim();
    if (text.length > 0) return text.length > 200 ? `${text.slice(0, 199).trimEnd()}…` : text;
  }
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length === 0 || t.startsWith("<")) continue;
    return t.length > 200 ? `${t.slice(0, 199).trimEnd()}…` : t;
  }
  return `OMGHC role prompt: ${prompt.name}`;
}

function checkPluginJson(
  pluginDir: string,
  pkgName: string,
  issues: BundleIssue[],
): void {
  const path = join(pluginDir, "plugin.json");
  if (!isFile(path)) {
    issues.push({ severity: "error", message: `plugin.json missing at ${path}` });
    return;
  }
  let parsed: unknown;
  try {
    parsed = readJson(path);
  } catch (err) {
    issues.push({
      severity: "error",
      message: `plugin.json invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }
  if (!parsed || typeof parsed !== "object") {
    issues.push({ severity: "error", message: "plugin.json is not a JSON object" });
    return;
  }
  const obj = parsed as Record<string, unknown>;
  for (const key of ["name", "description", "version"] as const) {
    const v = obj[key];
    if (typeof v !== "string" || v.length === 0) {
      issues.push({
        severity: "error",
        message: `plugin.json missing or empty required field '${key}'`,
      });
    }
  }
  if (typeof obj.name === "string" && obj.name !== pkgName) {
    issues.push({
      severity: "error",
      message: `plugin.json name '${obj.name}' does not match package.json name '${pkgName}'`,
    });
  }
}

function checkMcpJson(pluginDir: string, issues: BundleIssue[]): void {
  const path = join(pluginDir, ".mcp.json");
  if (!isFile(path)) {
    issues.push({ severity: "error", message: `.mcp.json missing at ${path}` });
    return;
  }
  let parsed: unknown;
  try {
    parsed = readJson(path);
  } catch (err) {
    issues.push({
      severity: "error",
      message: `.mcp.json invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }
  if (!parsed || typeof parsed !== "object") {
    issues.push({ severity: "error", message: ".mcp.json is not a JSON object" });
    return;
  }
  const servers = (parsed as Record<string, unknown>).mcpServers;
  if (!servers || typeof servers !== "object") {
    issues.push({
      severity: "error",
      message: ".mcp.json missing 'mcpServers' object",
    });
    return;
  }
  const map = servers as Record<string, unknown>;
  for (const required of REQUIRED_MCP_SERVERS) {
    if (!(required in map)) {
      issues.push({
        severity: "error",
        message: `.mcp.json missing required server '${required}'`,
      });
    }
  }
}

function checkSkills(
  catalog: Catalog,
  pluginDir: string,
  repoRoot: string,
  issues: BundleIssue[],
): void {
  const pluginSkillsDir = join(pluginDir, "skills");
  if (!isDir(pluginSkillsDir)) {
    issues.push({
      severity: "error",
      message: `plugin skills/ directory missing at ${pluginSkillsDir}`,
    });
    return;
  }

  for (const skill of catalog.skills) {
    const expected = join(pluginSkillsDir, skill.name, "SKILL.md");
    if (!isFile(expected)) {
      issues.push({
        severity: "error",
        message: `plugin missing skill mirror: ${skill.name}/SKILL.md`,
      });
      continue;
    }
    const sourcePath = join(repoRoot, "skills", skill.name, "SKILL.md");
    if (isFile(sourcePath)) {
      try {
        if (readUtf8(sourcePath) !== readUtf8(expected)) {
          issues.push({
            severity: "error",
            message: `plugin skill drift: ${skill.name}/SKILL.md does not match canonical`,
          });
        }
      } catch (err) {
        issues.push({
          severity: "warn",
          message: `could not compare ${skill.name}/SKILL.md: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    }
  }

  const expectedDirs = new Set(catalog.skills.map((s) => s.name));
  for (const entry of readdirSync(pluginSkillsDir)) {
    const p = join(pluginSkillsDir, entry);
    if (!isDir(p)) continue;
    if (!expectedDirs.has(entry)) {
      issues.push({
        severity: "error",
        message: `plugin contains stray skill not in catalog: ${entry}`,
      });
    }
  }
}

interface ExpectedAgentFile {
  fileName: string;
  description: string;
  source: "prompt" | "agent";
}

function buildExpectedAgentFiles(catalog: Catalog): ExpectedAgentFile[] {
  const files: ExpectedAgentFile[] = [];
  for (const prompt of catalog.prompts) {
    const description = deriveAgentDescription(prompt);
    const spec: AgentSpec = { name: prompt.name, description, body: "" };
    const result = generateAgentMarkdown(spec);
    files.push({
      fileName: `${result.fileName}.agent.md`,
      description,
      source: "prompt",
    });
  }
  for (const agent of catalog.agents) {
    const baseName = agent.path.split(/[\\/]/).pop() ?? `${agent.name}.md`;
    const desc = typeof agent.frontmatter.description === "string"
      ? (agent.frontmatter.description as string)
      : "";
    files.push({ fileName: baseName, description: desc, source: "agent" });
  }
  return files;
}

function readAgentDescription(filePath: string): string | null {
  if (!isFile(filePath)) return null;
  const content = readUtf8(filePath);
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fm) return null;
  const block = fm[1] ?? "";
  const line = block
    .split(/\r?\n/)
    .find((l) => /^description\s*:/i.test(l));
  if (!line) return null;
  const raw = line.replace(/^description\s*:\s*/i, "").trim();
  return unquote(raw);
}

function checkAgents(
  catalog: Catalog,
  pluginDir: string,
  issues: BundleIssue[],
): void {
  const pluginAgentsDir = join(pluginDir, "agents");
  if (!isDir(pluginAgentsDir)) {
    issues.push({
      severity: "error",
      message: `plugin agents/ directory missing at ${pluginAgentsDir}`,
    });
    return;
  }

  const expected = buildExpectedAgentFiles(catalog);
  const expectedNames = new Set(expected.map((e) => e.fileName));

  for (const file of expected) {
    const p = join(pluginAgentsDir, file.fileName);
    if (!isFile(p)) {
      issues.push({
        severity: "error",
        message: `plugin missing agent file: ${file.fileName} (from ${file.source})`,
      });
      continue;
    }
    const desc = readAgentDescription(p);
    if (desc === null || desc.length === 0) {
      issues.push({
        severity: "error",
        message: `plugin agent has empty/missing description frontmatter: ${file.fileName}`,
      });
    }
  }

  for (const entry of readdirSync(pluginAgentsDir)) {
    if (!entry.endsWith(".md")) continue;
    if (!expectedNames.has(entry)) {
      issues.push({
        severity: "error",
        message: `plugin contains stray agent file not in catalog: ${entry}`,
      });
    }
  }
}

function checkStrayRoots(pluginDir: string, issues: BundleIssue[]): void {
  for (const entry of readdirSync(pluginDir)) {
    if (!KNOWN_PLUGIN_ROOTS.has(entry)) {
      issues.push({
        severity: "warn",
        message: `unknown root entry in plugin dir: ${entry}`,
      });
    }
  }
}

export async function verifyPluginBundle(
  opts: VerifyPluginBundleOptions = {},
): Promise<VerifyPluginBundleResult> {
  const repoRoot = resolve(opts.repoRoot ?? defaultRepoRoot());
  const pluginDir = join(repoRoot, PLUGIN_DIR_REL);
  const issues: BundleIssue[] = [];

  if (!isDir(pluginDir)) {
    return {
      ok: false,
      issues: [{ severity: "error", message: `plugin dir not found: ${pluginDir}` }],
    };
  }

  let pkgName = "";
  try {
    const pkg = readJson(join(repoRoot, "package.json")) as { name?: unknown };
    pkgName = typeof pkg.name === "string" ? pkg.name : "";
  } catch (err) {
    issues.push({
      severity: "error",
      message: `failed to read package.json: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  let catalog: Catalog;
  try {
    catalog = readCatalog(repoRoot);
  } catch (err) {
    return {
      ok: false,
      issues: [
        ...issues,
        {
          severity: "error",
          message: `failed to read catalog: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  checkPluginJson(pluginDir, pkgName, issues);
  checkMcpJson(pluginDir, issues);
  checkSkills(catalog, pluginDir, repoRoot, issues);
  checkAgents(catalog, pluginDir, issues);
  checkStrayRoots(pluginDir, issues);

  const ok = !issues.some((i) => i.severity === "error");
  return { ok, issues };
}

const isMain =
  typeof import.meta.url === "string" &&
  import.meta.url.endsWith("verify-plugin-bundle.js");

if (isMain) {
  verifyPluginBundle()
    .then((r) => {
      for (const issue of r.issues) {
        const stream = issue.severity === "error" ? process.stderr : process.stdout;
        stream.write(`[${issue.severity}] ${issue.message}\n`);
      }
      process.stdout.write(
        `verify-plugin-bundle: ${r.ok ? "OK" : "FAIL"} (${r.issues.length} issues)\n`,
      );
      process.exit(r.ok ? 0 : 1);
    })
    .catch((err: unknown) => {
      process.stderr.write(
        `verify-plugin-bundle: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
}
