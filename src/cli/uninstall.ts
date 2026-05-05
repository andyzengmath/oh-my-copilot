/**
 * `omghc uninstall` — remove OMGHC-managed assets while preserving
 * user-authored content.
 *
 * Identifies OMGHC-managed agents and skills by **name match against the
 * bundled catalog** (single source of truth). Any `*.agent.md` or `skills/<x>/`
 * directory whose name does not appear in the catalog is treated as
 * user-authored and left untouched.
 *
 * Out of scope:
 *   - MCP server registration (M2 will own register/remove via mcp-config.json).
 *   - Project state at `<cwd>/.omghc/` (that's runtime state, not OMGHC config).
 */

import {
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { readCatalog, type Catalog } from "../catalog/reader.js";

const HELP_TEXT = `omghc uninstall — remove OMGHC-managed assets

USAGE:
  omghc uninstall [options]

OPTIONS:
  --scope=user            Uninstall from ~/.copilot/ (default).
  --scope=project         Uninstall from ./.copilot/ in the current working directory.
  --force                 Skip the confirmation prompt.
  --dry-run               Print what would be removed without modifying anything.
  --help, -h              Show this help.

ENVIRONMENT:
  COPILOT_HOME            Override the user-scope Copilot home (default: ~/.copilot).

WHAT IT REMOVES:
  - Agent files in <target>/agents/ whose name matches a bundled OMGHC prompt.
  - Skill directories in <target>/skills/ whose name matches a bundled OMGHC skill.
  - The OMGHC marker block inside <target>/instructions.md (preserves user content).
  - The _omghc namespace inside <target>/settings.json (preserves user keys).
  - The setup stamp file <target>/.omghc-setup-stamp.

WHAT IT PRESERVES:
  - User-authored agents/skills (any file/dir whose name is not in the catalog).
  - User content outside the OMGHC marker block in instructions.md.
  - User-authored top-level keys in settings.json.
  - <target>/mcp-config.json (managed by M2).
  - The project state directory ./.omghc/.
`;

const INSTRUCTIONS_MARKER_START = "<!-- OMGHC:INSTRUCTIONS:START -->";
const INSTRUCTIONS_MARKER_END = "<!-- OMGHC:INSTRUCTIONS:END -->";

interface ParsedFlags {
  scope: "user" | "project";
  force: boolean;
  dryRun: boolean;
  help: boolean;
  unknown: string[];
}

interface ResolvedPaths {
  repoRoot: string;
  target: string;
  agentsDir: string;
  skillsDir: string;
  instructionsPath: string;
  settingsPath: string;
  stampPath: string;
}

interface UninstallSummary {
  agentsRemoved: number;
  skillsRemoved: number;
  skillsSkipped: boolean;
  instructionsAction: "cleaned" | "deleted" | "skipped";
  settingsAction: "cleaned" | "deleted" | "skipped";
  stampRemoved: boolean;
}

function parseFlags(args: string[]): ParsedFlags {
  const out: ParsedFlags = {
    scope: "user",
    force: false,
    dryRun: false,
    help: false,
    unknown: [],
  };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--force") {
      out.force = true;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--scope=user" || arg === "--scope") {
      out.scope = "user";
    } else if (arg === "--scope=project") {
      out.scope = "project";
    } else {
      out.unknown.push(arg);
    }
  }
  return out;
}

function findRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..");
}

function userCopilotHome(): string {
  const override = process.env.COPILOT_HOME;
  if (override && override.trim().length > 0) return resolve(override);
  return resolve(homedir(), ".copilot");
}

function projectCopilotHome(): string {
  return resolve(process.cwd(), ".copilot");
}

function resolvePaths(scope: "user" | "project"): ResolvedPaths {
  const repoRoot = findRepoRoot();
  const target = scope === "user" ? userCopilotHome() : projectCopilotHome();
  return {
    repoRoot,
    target,
    agentsDir: join(target, "agents"),
    skillsDir: join(target, "skills"),
    instructionsPath: join(target, "instructions.md"),
    settingsPath: join(target, "settings.json"),
    stampPath: join(target, ".omghc-setup-stamp"),
  };
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

async function confirm(target: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolveAns) => {
    rl.question(
      `This will remove OMGHC-managed assets from ${target}. User-authored content between markers will be preserved. Continue? [y/N]: `,
      (response) => {
        rl.close();
        resolveAns(response);
      },
    );
  });
  const trimmed = answer.trim();
  return trimmed.startsWith("y") || trimmed.startsWith("Y");
}

function removeManagedAgents(
  paths: ResolvedPaths,
  catalog: Catalog,
  dryRun: boolean,
): number {
  if (!isDirectory(paths.agentsDir)) return 0;
  const managedNames = new Set(catalog.prompts.map((p) => p.name));
  let count = 0;
  for (const entry of readdirSync(paths.agentsDir)) {
    if (!entry.endsWith(".agent.md")) continue;
    const name = entry.slice(0, -".agent.md".length);
    if (!managedNames.has(name)) continue;
    const fullPath = join(paths.agentsDir, entry);
    if (!isFile(fullPath)) continue;
    if (dryRun) {
      process.stdout.write(`  would remove ${fullPath}\n`);
    } else {
      unlinkSync(fullPath);
    }
    count += 1;
  }
  return count;
}

function removeManagedSkills(
  paths: ResolvedPaths,
  catalog: Catalog,
  dryRun: boolean,
): { count: number; skipped: boolean } {
  if (!isDirectory(paths.skillsDir)) {
    return { count: 0, skipped: true };
  }
  const managedNames = new Set(catalog.skills.map((s) => s.name));
  let count = 0;
  for (const entry of readdirSync(paths.skillsDir)) {
    const fullPath = join(paths.skillsDir, entry);
    if (!isDirectory(fullPath)) continue;
    if (!managedNames.has(entry)) continue;
    if (dryRun) {
      process.stdout.write(`  would remove ${fullPath}/\n`);
    } else {
      rmSync(fullPath, { recursive: true, force: true });
    }
    count += 1;
  }
  return { count, skipped: false };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanInstructions(
  paths: ResolvedPaths,
  dryRun: boolean,
): "cleaned" | "deleted" | "skipped" {
  if (!isFile(paths.instructionsPath)) return "skipped";
  const current = readFileSync(paths.instructionsPath, "utf-8");
  const blockRe = new RegExp(
    `${escapeRe(INSTRUCTIONS_MARKER_START)}[\\s\\S]*?${escapeRe(INSTRUCTIONS_MARKER_END)}\\r?\\n?`,
  );
  if (!blockRe.test(current)) {
    // No managed block — leave the file alone.
    return "skipped";
  }
  const next = current.replace(blockRe, "").replace(/\n{3,}/g, "\n\n");
  const trimmed = next.trim();
  if (trimmed.length === 0) {
    if (!dryRun) unlinkSync(paths.instructionsPath);
    return "deleted";
  }
  if (!dryRun) writeFileSync(paths.instructionsPath, next, "utf-8");
  return "cleaned";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function cleanSettings(
  paths: ResolvedPaths,
  dryRun: boolean,
): "cleaned" | "deleted" | "skipped" {
  if (!isFile(paths.settingsPath)) return "skipped";
  const raw = readFileSync(paths.settingsPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    process.stderr.write(
      `omghc uninstall: ${paths.settingsPath} is not valid JSON; leaving it untouched.\n`,
    );
    return "skipped";
  }
  if (!isPlainObject(parsed)) return "skipped";
  if (!("_omghc" in parsed)) return "skipped";

  const next: Record<string, unknown> = { ...parsed };
  delete next._omghc;

  if (Object.keys(next).length === 0) {
    if (!dryRun) unlinkSync(paths.settingsPath);
    return "deleted";
  }
  if (!dryRun) {
    writeFileSync(
      paths.settingsPath,
      `${JSON.stringify(next, null, 2)}\n`,
      "utf-8",
    );
  }
  return "cleaned";
}

function removeStamp(paths: ResolvedPaths, dryRun: boolean): boolean {
  if (!isFile(paths.stampPath)) return false;
  if (!dryRun) unlinkSync(paths.stampPath);
  return true;
}

function printSummary(
  paths: ResolvedPaths,
  flags: ParsedFlags,
  summary: UninstallSummary,
): void {
  process.stdout.write(
    `\nomghc uninstall ${flags.dryRun ? "(dry-run) " : ""}complete (scope=${flags.scope}):\n`,
  );
  process.stdout.write(`  ${summary.agentsRemoved} agents removed\n`);
  process.stdout.write(
    summary.skillsSkipped
      ? `  skills skipped — plugin mode (no <target>/skills/ directory)\n`
      : `  ${summary.skillsRemoved} skills removed\n`,
  );
  process.stdout.write(
    `  instructions.md ${labelFileAction(summary.instructionsAction, paths.instructionsPath)}\n`,
  );
  process.stdout.write(
    `  settings.json ${labelSettingsAction(summary.settingsAction)}\n`,
  );
  process.stdout.write(
    `  .omghc-setup-stamp ${summary.stampRemoved ? "removed" : "not found (skipped)"}\n`,
  );
}

function labelFileAction(
  action: "cleaned" | "deleted" | "skipped",
  path: string,
): string {
  if (action === "cleaned") return "cleaned (OMGHC marker block removed)";
  if (action === "deleted") return `deleted (became empty after cleanup) at ${path}`;
  return "skipped (no managed marker block or file absent)";
}

function labelSettingsAction(
  action: "cleaned" | "deleted" | "skipped",
): string {
  if (action === "cleaned") return "_omghc namespace removed";
  if (action === "deleted") return "deleted (was OMGHC-only)";
  return "skipped (no _omghc namespace or file absent)";
}

export async function runUninstall(args: string[]): Promise<number> {
  const flags = parseFlags(args);

  if (flags.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (flags.unknown.length > 0) {
    process.stderr.write(
      `omghc uninstall: unknown argument(s): ${flags.unknown.join(", ")}\n`,
    );
    process.stderr.write("Run 'omghc uninstall --help' for usage.\n");
    return 2;
  }

  try {
    const paths = resolvePaths(flags.scope);

    if (!isFile(paths.stampPath)) {
      process.stdout.write(`OMGHC was not installed at ${paths.target}.\n`);
      return 0;
    }

    if (!flags.force && !flags.dryRun) {
      const proceed = await confirm(paths.target);
      if (!proceed) {
        process.stdout.write("Aborted.\n");
        return 0;
      }
    }

    const catalog = readCatalog(paths.repoRoot);

    if (flags.dryRun) {
      process.stdout.write(
        `omghc uninstall --dry-run (scope=${flags.scope}, target=${paths.target})\n`,
      );
    }

    const agentsRemoved = removeManagedAgents(paths, catalog, flags.dryRun);
    const skillsResult = removeManagedSkills(paths, catalog, flags.dryRun);
    const instructionsAction = cleanInstructions(paths, flags.dryRun);
    const settingsAction = cleanSettings(paths, flags.dryRun);
    const stampRemoved = removeStamp(paths, flags.dryRun);

    printSummary(paths, flags, {
      agentsRemoved,
      skillsRemoved: skillsResult.count,
      skillsSkipped: skillsResult.skipped,
      instructionsAction,
      settingsAction,
      stampRemoved,
    });

    if (flags.dryRun) {
      process.stdout.write("\n(dry-run: no files were modified)\n");
    }

    return 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`omghc uninstall: ${message}\n`);
    return 1;
  }
}
