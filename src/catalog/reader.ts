/**
 * Catalog reader: walks `<rootDir>/skills/`, `<rootDir>/prompts/`, and
 * `<rootDir>/agents/` and returns a structured registry. Single source of
 * truth for what skills/prompts/agents are bundled in this OMGHC release.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

export interface SkillEntry {
  name: string;
  skillMdPath: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface PromptEntry {
  name: string;
  path: string;
  content: string;
}

export interface AgentEntry {
  name: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface Catalog {
  skills: SkillEntry[];
  prompts: PromptEntry[];
  agents: AgentEntry[];
}

interface ParsedDoc {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontmatter(content: string): ParsedDoc {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  try {
    const frontmatter = parseMinimalYaml(match[1] ?? "");
    const body = content.slice(match[0].length);
    return { frontmatter, body };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

/**
 * Minimal YAML subset: scalar key:value pairs and simple list values.
 * Supports inline `key: value` and a list form:
 *
 *   tools:
 *     - Read
 *     - Write
 *
 * Anything more complex (nested maps, multi-line scalars, etc.) is rejected
 * by returning what was parsed so far; callers fall back to empty frontmatter.
 */
function parseMinimalYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.replace(/\s+$/, "");
    if (line.length === 0 || /^\s*#/.test(line)) {
      i += 1;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = kv[1] as string;
    const rest = (kv[2] ?? "").trim();
    if (rest.length === 0) {
      const items: Array<string | number | boolean | null> = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? "";
        const itemMatch = next.match(/^\s*-\s+(.*)$/);
        if (!itemMatch) break;
        items.push(unquoteScalar((itemMatch[1] ?? "").trim()));
        j += 1;
      }
      if (items.length > 0) {
        result[key] = items;
        i = j;
        continue;
      }
      result[key] = "";
      i += 1;
      continue;
    }
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      result[key] = inner.length === 0
        ? []
        : inner.split(",").map((s) => unquoteScalar(s.trim()));
      i += 1;
      continue;
    }
    result[key] = unquoteScalar(rest);
    i += 1;
  }
  return result;
}

function unquoteScalar(value: string): string | number | boolean | null {
  if (value === "") return "";
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function readSkill(skillsDir: string, name: string): SkillEntry | null {
  const skillMdPath = resolve(join(skillsDir, name, "SKILL.md"));
  if (!isFile(skillMdPath)) return null;
  const raw = readFileSync(skillMdPath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);
  return { name, skillMdPath, frontmatter, body };
}

export function readPrompt(promptsDir: string, name: string): PromptEntry | null {
  const path = resolve(join(promptsDir, `${name}.md`));
  if (!isFile(path)) return null;
  const content = readFileSync(path, "utf-8");
  return { name, path, content };
}

function readAgent(agentsDir: string, fileName: string): AgentEntry | null {
  const path = resolve(join(agentsDir, fileName));
  if (!isFile(path)) return null;
  const raw = readFileSync(path, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const name = fileName.replace(/\.agent\.md$/, "").replace(/\.md$/, "");
  return { name, path, frontmatter, body };
}

export function readCatalog(rootDir: string): Catalog {
  if (!existsSync(rootDir) || !isDirectory(rootDir)) {
    throw new Error(`readCatalog: rootDir does not exist or is not a directory: ${rootDir}`);
  }

  const skillsDir = join(rootDir, "skills");
  const promptsDir = join(rootDir, "prompts");
  const agentsDir = join(rootDir, "agents");

  const haveSkills = isDirectory(skillsDir);
  const havePrompts = isDirectory(promptsDir);
  const haveAgents = isDirectory(agentsDir);

  if (!haveSkills && !havePrompts && !haveAgents) {
    throw new Error(
      `readCatalog: rootDir has none of skills/, prompts/, agents/: ${rootDir}`,
    );
  }

  const skills: SkillEntry[] = [];
  if (haveSkills) {
    for (const entry of readdirSync(skillsDir)) {
      const skillDir = join(skillsDir, entry);
      if (!isDirectory(skillDir)) continue;
      const skill = readSkill(skillsDir, entry);
      if (skill) skills.push(skill);
    }
  }

  const prompts: PromptEntry[] = [];
  if (havePrompts) {
    for (const entry of readdirSync(promptsDir)) {
      if (!entry.endsWith(".md")) continue;
      const name = entry.slice(0, -3);
      const prompt = readPrompt(promptsDir, name);
      if (prompt) prompts.push(prompt);
    }
  }

  const agents: AgentEntry[] = [];
  if (haveAgents) {
    for (const entry of readdirSync(agentsDir)) {
      if (!entry.endsWith(".md")) continue;
      const agent = readAgent(agentsDir, entry);
      if (agent) agents.push(agent);
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  prompts.sort((a, b) => a.name.localeCompare(b.name));
  agents.sort((a, b) => a.name.localeCompare(b.name));

  return { skills, prompts, agents };
}
