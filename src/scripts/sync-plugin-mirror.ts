#!/usr/bin/env node
/**
 * Mirror canonical `skills/`, `prompts/` (as `agents/*.agent.md`), and
 * `agents/` into `plugins/oh-my-ghcopilot/{skills,agents}/`.
 *
 * Modes:
 *   default     write any out-of-date files
 *   --check     exit non-zero if any file would change (CI parity gate)
 *   --dry-run   print actions, don't write
 *
 * Verbatim copy for skills (`SKILL.md` per skill dir). Prompts are converted
 * into Copilot agent markdown via `generateAgentMarkdown`. Existing canonical
 * `agents/*.md` (if any) are also mirrored verbatim into the plugin agents dir.
 *
 * Stale plugin files (skills not in catalog, agents whose source is gone) are
 * pruned so the mirror stays in lockstep with the catalog.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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

export interface SyncPluginMirrorOptions {
  repoRoot?: string;
  check?: boolean;
  dryRun?: boolean;
}

export interface SyncPluginMirrorResult {
  synced: number;
  skipped: number;
  changed: string[];
  errors: string[];
  ok: boolean;
}

const PLUGIN_DIR_REL = join("plugins", "oh-my-ghcopilot");

function defaultRepoRoot(): string {
  // <repoRoot>/dist/scripts/sync-plugin-mirror.js → repoRoot is two up
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..");
}

function ensureDir(path: string, dryRun: boolean): void {
  if (dryRun) return;
  mkdirSync(path, { recursive: true });
}

function fileExists(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function readUtf8(p: string): string {
  return readFileSync(p, "utf-8");
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
    if (text.length > 0) return truncate(text, 200);
  }
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length === 0 || t.startsWith("<")) continue;
    return truncate(t, 200);
  }
  return `OMGHC role prompt: ${prompt.name}`;
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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

interface MirrorPlan {
  writes: Array<{ path: string; content: string }>;
  copies: Array<{ src: string; dst: string }>;
  deletes: string[];
}

function planSkills(catalog: Catalog, repoRoot: string, pluginDir: string): MirrorPlan {
  const writes: MirrorPlan["writes"] = [];
  const copies: MirrorPlan["copies"] = [];
  const deletes: string[] = [];

  const pluginSkillsDir = join(pluginDir, "skills");
  const expected = new Set(catalog.skills.map((s) => s.name));

  // Source → destination per skill
  for (const skill of catalog.skills) {
    const srcRoot = join(repoRoot, "skills", skill.name);
    const dstRoot = join(pluginSkillsDir, skill.name);
    walkAndCollect(srcRoot, dstRoot, copies);
  }

  // Prune stale skill dirs in plugin
  if (existsSync(pluginSkillsDir)) {
    for (const entry of readdirSync(pluginSkillsDir)) {
      const p = join(pluginSkillsDir, entry);
      try {
        if (!statSync(p).isDirectory()) continue;
      } catch {
        continue;
      }
      if (!expected.has(entry)) deletes.push(p);
    }
  }

  return { writes, copies, deletes };
}

function walkAndCollect(
  srcRoot: string,
  dstRoot: string,
  copies: Array<{ src: string; dst: string }>,
): void {
  if (!existsSync(srcRoot)) return;
  const stack: Array<{ s: string; d: string }> = [{ s: srcRoot, d: dstRoot }];
  while (stack.length > 0) {
    const { s, d } = stack.pop() as { s: string; d: string };
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(s);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(s)) {
        stack.push({ s: join(s, entry), d: join(d, entry) });
      }
    } else if (st.isFile()) {
      copies.push({ src: s, dst: d });
    }
  }
}

function planAgents(catalog: Catalog, pluginDir: string): MirrorPlan {
  const writes: MirrorPlan["writes"] = [];
  const copies: MirrorPlan["copies"] = [];
  const deletes: string[] = [];

  const pluginAgentsDir = join(pluginDir, "agents");
  const expectedFiles = new Set<string>();

  // Prompts → generated agent markdown
  for (const prompt of catalog.prompts) {
    const spec: AgentSpec = {
      name: prompt.name,
      description: deriveAgentDescription(prompt),
      body: stripFrontmatter(prompt.content).trimStart(),
    };
    const result = generateAgentMarkdown(spec);
    const fileName = `${result.fileName}.agent.md`;
    expectedFiles.add(fileName);
    writes.push({
      path: join(pluginAgentsDir, fileName),
      content: result.content,
    });
  }

  // Native canonical agents (verbatim mirror)
  for (const agent of catalog.agents) {
    const baseName = agent.path.split(/[\\/]/).pop() ?? `${agent.name}.md`;
    expectedFiles.add(baseName);
    writes.push({
      path: join(pluginAgentsDir, baseName),
      content: readUtf8(agent.path),
    });
  }

  // Prune stale agent files
  if (existsSync(pluginAgentsDir)) {
    for (const entry of readdirSync(pluginAgentsDir)) {
      if (!entry.endsWith(".md")) continue;
      if (!expectedFiles.has(entry)) {
        deletes.push(join(pluginAgentsDir, entry));
      }
    }
  }

  return { writes, copies, deletes };
}

function applyPlan(
  plan: MirrorPlan,
  opts: { check: boolean; dryRun: boolean },
  result: SyncPluginMirrorResult,
  repoRoot: string,
): void {
  for (const { src, dst } of plan.copies) {
    const incoming = readUtf8(src);
    if (fileExists(dst) && readUtf8(dst) === incoming) {
      result.skipped += 1;
      continue;
    }
    result.changed.push(relative(repoRoot, dst));
    if (opts.check) continue;
    if (opts.dryRun) continue;
    ensureDir(dirname(dst), false);
    writeFileSync(dst, incoming, "utf-8");
    result.synced += 1;
  }

  for (const { path, content } of plan.writes) {
    if (fileExists(path) && readUtf8(path) === content) {
      result.skipped += 1;
      continue;
    }
    result.changed.push(relative(repoRoot, path));
    if (opts.check) continue;
    if (opts.dryRun) continue;
    ensureDir(dirname(path), false);
    writeFileSync(path, content, "utf-8");
    result.synced += 1;
  }

  for (const path of plan.deletes) {
    result.changed.push(`${relative(repoRoot, path)} (delete)`);
    if (opts.check) continue;
    if (opts.dryRun) continue;
    rmSync(path, { recursive: true, force: true });
    result.synced += 1;
  }
}

export async function syncPluginMirror(
  opts: SyncPluginMirrorOptions = {},
): Promise<SyncPluginMirrorResult> {
  const repoRoot = resolve(opts.repoRoot ?? defaultRepoRoot());
  const pluginDir = join(repoRoot, PLUGIN_DIR_REL);
  const check = opts.check === true;
  const dryRun = opts.dryRun === true;

  const result: SyncPluginMirrorResult = {
    synced: 0,
    skipped: 0,
    changed: [],
    errors: [],
    ok: true,
  };

  try {
    if (!existsSync(pluginDir)) {
      if (check) {
        result.errors.push(`plugin dir missing: ${pluginDir}`);
        result.ok = false;
        return result;
      }
      if (!dryRun) mkdirSync(pluginDir, { recursive: true });
    }

    const catalog = readCatalog(repoRoot);
    const skillPlan = planSkills(catalog, repoRoot, pluginDir);
    const agentPlan = planAgents(catalog, pluginDir);

    applyPlan(skillPlan, { check, dryRun }, result, repoRoot);
    applyPlan(agentPlan, { check, dryRun }, result, repoRoot);

    if (check && result.changed.length > 0) {
      result.ok = false;
    }
  } catch (err) {
    result.ok = false;
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

const isMain =
  typeof import.meta.url === "string" &&
  import.meta.url.endsWith("sync-plugin-mirror.js");

if (isMain) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const dryRun = args.includes("--dry-run");

  syncPluginMirror({ check, dryRun })
    .then((r) => {
      const mode = check ? "[check]" : dryRun ? "[dry-run]" : "[sync]";
      process.stdout.write(
        `${mode} synced=${r.synced} skipped=${r.skipped} changed=${r.changed.length} errors=${r.errors.length}\n`,
      );
      for (const path of r.changed) {
        process.stdout.write(`  changed: ${path}\n`);
      }
      for (const err of r.errors) {
        process.stderr.write(`  error: ${err}\n`);
      }
      if (check && r.changed.length > 0) {
        process.stderr.write(
          "sync-plugin-mirror: plugin out of sync with catalog (run `npm run sync:plugin`)\n",
        );
      }
      process.exit(r.ok ? 0 : 1);
    })
    .catch((err: unknown) => {
      process.stderr.write(
        `sync-plugin-mirror: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
}
