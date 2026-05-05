/**
 * `omghc list` — print the bundled OMGHC catalog (skills, prompts, agents).
 *
 * Reads the catalog via `readCatalog(repoRoot)` from src/catalog/reader.ts.
 * Resolves repoRoot from `import.meta.url` walking up two levels from
 * `dist/cli/list.js`.
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readCatalog,
  type AgentEntry,
  type Catalog,
  type PromptEntry,
  type SkillEntry,
} from "../catalog/reader.js";

interface ListOptions {
  json: boolean;
  skillsOnly: boolean;
  promptsOnly: boolean;
  agentsOnly: boolean;
  help: boolean;
}

interface ListItem {
  name: string;
  description: string;
  path: string;
}

const HELP_TEXT = `omghc list — list bundled skills, prompts, and agents

USAGE:
  omghc list [options]

OPTIONS:
  --json            Output JSON instead of human-readable text.
  --skills-only     Show only skills.
  --prompts-only    Show only prompts.
  --agents-only     Show only agents.
  --help, -h        Show this help.

NOTE:
  This shows the catalog bundled with OMGHC, not what is installed in
  ~/.copilot/. Run \`omghc setup\` to install bundled assets.
`;

function parseArgs(args: string[]): ListOptions {
  const opts: ListOptions = {
    json: false,
    skillsOnly: false,
    promptsOnly: false,
    agentsOnly: false,
    help: false,
  };
  for (const arg of args) {
    switch (arg) {
      case "--json":
        opts.json = true;
        break;
      case "--skills-only":
        opts.skillsOnly = true;
        break;
      case "--prompts-only":
        opts.promptsOnly = true;
        break;
      case "--agents-only":
        opts.agentsOnly = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        // Unknown flags are ignored silently for now (M1 leniency).
        break;
    }
  }
  return opts;
}

function findRepoRoot(): string {
  // dist/cli/list.js → ../../ = repo root
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(join(here, "..", ".."));
}

function describeFromFrontmatter(fm: Record<string, unknown>): string | null {
  const desc = fm["description"];
  if (typeof desc === "string" && desc.trim().length > 0) {
    return desc.trim();
  }
  return null;
}

function describeFromBody(body: string): string | null {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("<")) continue;
    return line;
  }
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function describeSkill(s: SkillEntry): string {
  const fm = describeFromFrontmatter(s.frontmatter);
  if (fm) return fm;
  const body = describeFromBody(s.body);
  if (body) return body;
  return "(no description)";
}

function describePrompt(p: PromptEntry): string {
  // Prompt files may have frontmatter too (e.g. analyst.md). Re-parse cheaply.
  const match = p.content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    const block = match[1] ?? "";
    const descLine = block
      .split(/\r?\n/)
      .find((l) => /^description\s*:/i.test(l));
    if (descLine) {
      const value = descLine.replace(/^description\s*:\s*/i, "").trim();
      const unquoted = value.replace(/^["']|["']$/g, "");
      if (unquoted.length > 0) return unquoted;
    }
    const body = p.content.slice(match[0].length);
    const fromBody = describeFromBody(body);
    if (fromBody) return fromBody;
  } else {
    const fromBody = describeFromBody(p.content);
    if (fromBody) return fromBody;
  }
  return "(no description)";
}

function describeAgent(a: AgentEntry): string {
  const fm = describeFromFrontmatter(a.frontmatter);
  if (fm) return fm;
  const body = describeFromBody(a.body);
  if (body) return body;
  return "(no description)";
}

function toItem(name: string, description: string, path: string): ListItem {
  return { name, description, path };
}

function buildItems(catalog: Catalog): {
  skills: ListItem[];
  prompts: ListItem[];
  agents: ListItem[];
} {
  const skills = catalog.skills
    .map((s) => toItem(s.name, describeSkill(s), s.skillMdPath))
    .sort((a, b) => a.name.localeCompare(b.name));
  const prompts = catalog.prompts
    .map((p) => toItem(p.name, describePrompt(p), p.path))
    .sort((a, b) => a.name.localeCompare(b.name));
  const agents = catalog.agents
    .map((a) => toItem(a.name, describeAgent(a), a.path))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { skills, prompts, agents };
}

function formatSection(
  title: string,
  items: ListItem[],
  emptyHint: string,
): string {
  const header = `${title} (${items.length}):`;
  if (items.length === 0) {
    return `${header}\n  ${emptyHint}\n`;
  }
  const nameWidth = Math.min(
    24,
    Math.max(...items.map((i) => i.name.length), 8),
  );
  const lines = items.map((i) => {
    const padded = i.name.padEnd(nameWidth, " ");
    const desc = truncate(i.description, 60);
    return `  ${padded}  ${desc}`;
  });
  return `${header}\n${lines.join("\n")}\n`;
}

function renderHuman(
  items: { skills: ListItem[]; prompts: ListItem[]; agents: ListItem[] },
  opts: ListOptions,
): string {
  const showAll =
    !opts.skillsOnly && !opts.promptsOnly && !opts.agentsOnly;
  const parts: string[] = [];
  parts.push("oh-my-ghcopilot — installed skills, prompts, agents");
  parts.push("===================================================");
  parts.push("");
  if (showAll || opts.skillsOnly) {
    parts.push(formatSection("SKILLS", items.skills, "(no skills bundled)"));
  }
  if (showAll || opts.promptsOnly) {
    parts.push(formatSection("PROMPTS", items.prompts, "(no prompts bundled)"));
  }
  if (showAll || opts.agentsOnly) {
    parts.push(
      formatSection(
        "AGENTS",
        items.agents,
        "(no agents installed; run `omghc setup`)",
      ),
    );
  }
  return `${parts.join("\n")}`;
}

function renderJson(
  items: { skills: ListItem[]; prompts: ListItem[]; agents: ListItem[] },
  opts: ListOptions,
): string {
  const showAll =
    !opts.skillsOnly && !opts.promptsOnly && !opts.agentsOnly;
  const out: {
    skills?: ListItem[];
    prompts?: ListItem[];
    agents?: ListItem[];
    summary: { skills: number; prompts: number; agents: number };
  } = {
    summary: {
      skills: items.skills.length,
      prompts: items.prompts.length,
      agents: items.agents.length,
    },
  };
  if (showAll || opts.skillsOnly) out.skills = items.skills;
  if (showAll || opts.promptsOnly) out.prompts = items.prompts;
  if (showAll || opts.agentsOnly) out.agents = items.agents;
  // Reorder so summary appears last in JSON output for readability.
  const ordered: Record<string, unknown> = {};
  if (out.skills) ordered.skills = out.skills;
  if (out.prompts) ordered.prompts = out.prompts;
  if (out.agents) ordered.agents = out.agents;
  ordered.summary = out.summary;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export async function runList(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (opts.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const repoRoot = findRepoRoot();
  let catalog: Catalog;
  try {
    catalog = readCatalog(repoRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`omghc list: ${message}\n`);
    return 1;
  }

  const items = buildItems(catalog);
  const output = opts.json ? renderJson(items, opts) : renderHuman(items, opts);
  process.stdout.write(output);
  return 0;
}
