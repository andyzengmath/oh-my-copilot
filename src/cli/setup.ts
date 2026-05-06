/**
 * `omghc setup` — install OMGHC into ~/.copilot/ (user scope) or ./.copilot/
 * (project scope). Generates Copilot agent markdown from bundled prompts,
 * writes `instructions.md` and `settings.json` from templates, and (for
 * `--legacy`) copies SKILL.md trees.
 *
 * Defer-heavy MVP. Out-of-scope features (kept for v0.0.2+):
 *   - OS keychain integration
 *   - Backup/restore of existing files
 *   - Plugin auto-install (no spawning `copilot plugin install`)
 *   - Network requests
 *   - MCP server registration (deferred to `omghc setup --finalize-mcp` in M2)
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateAgentMarkdown,
  type AgentSpec,
} from "../agents/generateAgentMarkdown.js";
import {
  readCatalog,
  type Catalog,
  type PromptEntry,
} from "../catalog/reader.js";

import { runSetupFinalizeMcp } from "./setup-finalize-mcp.js";

const HELP_TEXT = `omghc setup — install OMGHC into a Copilot scope

USAGE:
  omghc setup [options]
  omghc setup --finalize-mcp     (M2 placeholder)
  omghc setup --finalize-hooks   (re-run only the project hook write)

OPTIONS:
  --plugin                Plugin mode (default). Agents/instructions install to scope; plugin packaging lands in M4.
  --legacy                Legacy mode. Also copies bundled skills/<name>/SKILL.md trees to <scope>/skills/.
  --scope=user            Install to ~/.copilot/ (default).
  --scope=project         Install to ./.copilot/ in the current working directory.
  --merge-agents          When instructions.md exists, replace only the OMGHC-managed marker block.
  --force                 Overwrite existing instructions.md / settings.json.
  --dry-run               Print planned operations without writing anything.
  --no-hooks              Skip writing the project hook file (.github/hooks/oh-my-ghcopilot.json).
  --finalize-hooks        Run only the project hook write step.
  --help, -h              Show this help.

ENVIRONMENT:
  COPILOT_HOME            Override the user-scope Copilot home (default: ~/.copilot).

EXIT CODES:
  0 on success, 1 on error, 2 on usage error.
`;

const INSTRUCTIONS_MARKER_START = "<!-- OMGHC:INSTRUCTIONS:START -->";
const INSTRUCTIONS_MARKER_END = "<!-- OMGHC:INSTRUCTIONS:END -->";

interface ParsedFlags {
  mode: "plugin" | "legacy";
  scope: "user" | "project";
  force: boolean;
  mergeAgents: boolean;
  dryRun: boolean;
  help: boolean;
  finalizeMcp: boolean;
  finalizeHooks: boolean;
  noHooks: boolean;
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

interface PackageJson {
  name?: string;
  version?: string;
}

interface SetupSummary {
  agentsWritten: number;
  skillsCopied: number;
  instructionsAction: "wrote" | "merged" | "skipped";
  settingsAction: "wrote" | "merged";
}

function parseFlags(args: string[]): ParsedFlags {
  const out: ParsedFlags = {
    mode: "plugin",
    scope: "user",
    force: false,
    mergeAgents: false,
    dryRun: false,
    help: false,
    finalizeMcp: false,
    finalizeHooks: false,
    noHooks: false,
    unknown: [],
  };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--plugin") {
      out.mode = "plugin";
    } else if (arg === "--legacy") {
      out.mode = "legacy";
    } else if (arg === "--force") {
      out.force = true;
    } else if (arg === "--merge-agents") {
      out.mergeAgents = true;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--finalize-mcp") {
      out.finalizeMcp = true;
    } else if (arg === "--finalize-hooks") {
      out.finalizeHooks = true;
    } else if (arg === "--no-hooks") {
      out.noHooks = true;
    } else if (arg === "--scope=user" || arg === "--scope") {
      out.scope = "user";
    } else if (arg === "--scope=project") {
      out.scope = "project";
    } else if (arg.startsWith("--scope=")) {
      out.unknown.push(arg);
    } else {
      out.unknown.push(arg);
    }
  }
  return out;
}

function findRepoRoot(): string {
  // dist/cli/setup.js -> ../../  → repo root
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

function readPackageVersion(repoRoot: string): string {
  try {
    const raw = readFileSync(join(repoRoot, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as PackageJson;
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function ensureDir(path: string, dryRun: boolean): void {
  if (dryRun) return;
  mkdirSync(path, { recursive: true });
}

function deriveAgentDescription(prompt: PromptEntry): string {
  // Parse minimal frontmatter to pull `description` if present.
  const fmMatch = prompt.content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fmMatch) {
    const frontmatter = fmMatch[1] ?? "";
    const descLine = frontmatter
      .split(/\r?\n/)
      .find((line) => /^description\s*:/i.test(line));
    if (descLine) {
      const descRaw = descLine.replace(/^description\s*:\s*/i, "").trim();
      const unquoted = unquote(descRaw);
      if (unquoted.length > 0) return unquoted;
    }
  }

  // Body fallback: first H1 or first non-blank paragraph (truncated).
  const body = stripFrontmatter(prompt.content);
  const heading = body.match(/^\s*#\s+(.+)$/m);
  if (heading) {
    const text = (heading[1] ?? "").trim();
    if (text.length > 0) return truncate(text, 200);
  }
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("<")) continue; // skip XML-ish tags
    return truncate(trimmed, 200);
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

function generateAgentsForPrompts(
  catalog: Catalog,
  paths: ResolvedPaths,
  dryRun: boolean,
): number {
  ensureDir(paths.agentsDir, dryRun);
  let count = 0;
  for (const prompt of catalog.prompts) {
    const spec: AgentSpec = {
      name: prompt.name,
      description: deriveAgentDescription(prompt),
      body: stripFrontmatter(prompt.content).trimStart(),
    };
    const result = generateAgentMarkdown(spec);
    const outPath = join(paths.agentsDir, `${result.fileName}.agent.md`);
    if (!dryRun) {
      writeFileSync(outPath, result.content, "utf-8");
    }
    count += 1;
  }
  return count;
}

function copyDirRecursive(src: string, dst: string, dryRun: boolean): void {
  if (!existsSync(src)) return;
  if (!dryRun) mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) {
      copyDirRecursive(s, d, dryRun);
    } else if (st.isFile()) {
      if (!dryRun) copyFileSync(s, d);
    }
  }
}

function copyLegacySkills(
  catalog: Catalog,
  paths: ResolvedPaths,
  dryRun: boolean,
): number {
  ensureDir(paths.skillsDir, dryRun);
  for (const skill of catalog.skills) {
    const src = join(paths.repoRoot, "skills", skill.name);
    const dst = join(paths.skillsDir, skill.name);
    copyDirRecursive(src, dst, dryRun);
  }
  return catalog.skills.length;
}

function readTemplate(repoRoot: string, name: string): string {
  return readFileSync(join(repoRoot, "templates", name), "utf-8");
}

function writeInstructions(
  paths: ResolvedPaths,
  flags: ParsedFlags,
): "wrote" | "merged" | "skipped" {
  const template = readTemplate(paths.repoRoot, "instructions.md.tmpl");
  const exists = existsSync(paths.instructionsPath);

  if (!exists) {
    if (!flags.dryRun) writeFileSync(paths.instructionsPath, template, "utf-8");
    return "wrote";
  }

  if (flags.mergeAgents) {
    const current = readFileSync(paths.instructionsPath, "utf-8");
    const merged = mergeMarkerBlock(current, template);
    if (!flags.dryRun) writeFileSync(paths.instructionsPath, merged, "utf-8");
    return "merged";
  }

  if (flags.force) {
    if (!flags.dryRun) writeFileSync(paths.instructionsPath, template, "utf-8");
    return "wrote";
  }

  process.stderr.write(
    `omghc setup: skipping ${paths.instructionsPath} (already exists; pass --merge-agents or --force to replace).\n`,
  );
  return "skipped";
}

function mergeMarkerBlock(current: string, template: string): string {
  const newBlockMatch = template.match(
    new RegExp(
      `${escapeRe(INSTRUCTIONS_MARKER_START)}[\\s\\S]*?${escapeRe(INSTRUCTIONS_MARKER_END)}`,
    ),
  );
  const newBlock = newBlockMatch ? newBlockMatch[0] : template;

  const currentRe = new RegExp(
    `${escapeRe(INSTRUCTIONS_MARKER_START)}[\\s\\S]*?${escapeRe(INSTRUCTIONS_MARKER_END)}`,
  );
  if (currentRe.test(current)) {
    return current.replace(currentRe, newBlock);
  }
  // No existing markers — append.
  const joiner = current.endsWith("\n") ? "" : "\n";
  return `${current}${joiner}\n${newBlock}\n`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeSettings(paths: ResolvedPaths, flags: ParsedFlags): "wrote" | "merged" {
  const templateRaw = readTemplate(paths.repoRoot, "settings.seed.json");
  const templateJson = JSON.parse(templateRaw) as Record<string, unknown>;

  if (!existsSync(paths.settingsPath)) {
    if (!flags.dryRun) {
      writeFileSync(
        paths.settingsPath,
        `${JSON.stringify(templateJson, null, 2)}\n`,
        "utf-8",
      );
    }
    return "wrote";
  }

  const currentRaw = readFileSync(paths.settingsPath, "utf-8");
  let currentJson: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(currentRaw);
    currentJson = isPlainObject(parsed) ? parsed : {};
  } catch {
    process.stderr.write(
      `omghc setup: ${paths.settingsPath} is not valid JSON; refusing to overwrite without --force.\n`,
    );
    if (!flags.force) {
      throw new Error("settings.json is malformed");
    }
    currentJson = {};
  }

  const merged: Record<string, unknown> = { ...currentJson };
  if (isPlainObject(templateJson._omghc)) {
    merged._omghc = templateJson._omghc;
  }
  // Preserve other top-level keys from current. Do not overwrite user keys.

  if (!flags.dryRun) {
    writeFileSync(
      paths.settingsPath,
      `${JSON.stringify(merged, null, 2)}\n`,
      "utf-8",
    );
  }
  return "merged";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function writeStamp(
  paths: ResolvedPaths,
  flags: ParsedFlags,
  version: string,
): void {
  const stamp = {
    timestamp: new Date().toISOString(),
    scope: flags.scope,
    mode: flags.mode,
    version,
  };
  if (!flags.dryRun) {
    writeFileSync(
      paths.stampPath,
      `${JSON.stringify(stamp, null, 2)}\n`,
      "utf-8",
    );
  }
}

function printPluginNotice(target: string): void {
  process.stdout.write(
    `Plugin mode: register OMGHC plugin via 'copilot plugin install <repo-root>/plugins/oh-my-ghcopilot'.\n`,
  );
  process.stdout.write(
    `Plugin directory pending — will be available in M4. For now, agents and instructions are installed directly to ${target}/.\n`,
  );
}

function printLegacyNotice(target: string): void {
  process.stdout.write(
    `Legacy mode: skills copied to ${target}/skills/. (Plugin mode is recommended once plugin packaging ships in M4.)\n`,
  );
}

function printMcpNotice(): void {
  process.stdout.write(
    "MCP server registration pending — run 'omghc setup --finalize-mcp' after M2 build.\n",
  );
}

const HOOK_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "userPromptSubmitted",
  "preToolUse",
  "postToolUse",
  "errorOccurred",
] as const;

interface HookWriteResult {
  status: "wrote" | "skipped" | "unchanged";
  path?: string;
  reason?: string;
}

function findGitProjectRoot(): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return null;
  const out = (result.stdout || "").trim();
  return out.length > 0 ? out : null;
}

function buildHookFileContent(distRoot: string): string {
  const hookScript = join(distRoot, "scripts", "copilot-native-hook.js");
  const hookScriptForJson = hookScript.replace(/\\/g, "/");
  const hooks: Record<string, Array<Record<string, string>>> = {};
  for (const event of HOOK_EVENTS) {
    hooks[event] = [
      {
        type: "command",
        bash: `node "${hookScriptForJson}" ${event}`,
        powershell: `node "${hookScriptForJson}" ${event}`,
      },
    ];
  }
  return `${JSON.stringify({ version: 1, hooks }, null, 2)}\n`;
}

function distRootFromRepoRoot(repoRoot: string): string {
  return join(repoRoot, "dist");
}

function writeProjectHookFile(
  paths: ResolvedPaths,
  flags: ParsedFlags,
): HookWriteResult {
  const projectRoot = findGitProjectRoot();
  if (!projectRoot) {
    return {
      status: "skipped",
      reason:
        "Project hook write skipped — not a git repo. Initialize git first with `git init` then run `omghc setup --finalize-hooks`.",
    };
  }

  const hookDir = join(projectRoot, ".github", "hooks");
  const hookPath = join(hookDir, "oh-my-ghcopilot.json");
  const content = buildHookFileContent(distRootFromRepoRoot(paths.repoRoot));

  if (existsSync(hookPath)) {
    try {
      const current = readFileSync(hookPath, "utf-8");
      if (current === content) {
        return { status: "unchanged", path: hookPath };
      }
    } catch {
      // fall through to write
    }
  }

  if (!flags.dryRun) {
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(hookPath, content, "utf-8");
  }
  return { status: "wrote", path: hookPath };
}

function printHookWriteResult(result: HookWriteResult): void {
  if (result.status === "skipped") {
    process.stderr.write(`omghc setup: ${result.reason ?? "hook write skipped"}\n`);
    return;
  }
  if (result.status === "unchanged") {
    process.stdout.write(
      `Project hook file unchanged: ${result.path}\n`,
    );
    return;
  }
  process.stdout.write(`Project hook file written: ${result.path}\n`);
  process.stdout.write(
    "NOTE: file-based hooks are wired up at the schema layer in Copilot CLI v1.0.40 but DO NOT FIRE in production. This file is forward-compat. See docs/copilot-native-hooks.md.\n",
  );
}

async function runFinalizeHooks(args: string[]): Promise<number> {
  const flags = parseFlags(args);
  if (flags.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  try {
    const paths = resolvePaths(flags.scope);
    const result = writeProjectHookFile(paths, flags);
    printHookWriteResult(result);
    return 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`omghc setup --finalize-hooks: ${message}\n`);
    return 1;
  }
}

function printSummary(
  paths: ResolvedPaths,
  flags: ParsedFlags,
  summary: SetupSummary,
): void {
  process.stdout.write(
    `\nomghc setup complete (scope=${flags.scope}, mode=${flags.mode}):\n`,
  );
  process.stdout.write(
    `  ${summary.agentsWritten} agents installed at ${paths.agentsDir}/\n`,
  );
  if (flags.mode === "legacy") {
    process.stdout.write(
      `  ${summary.skillsCopied} skills installed at ${paths.skillsDir}/\n`,
    );
  }
  const instrLabel =
    summary.instructionsAction === "skipped"
      ? "skipped (existing)"
      : summary.instructionsAction;
  process.stdout.write(
    `  instructions.md ${instrLabel} at ${paths.instructionsPath}\n`,
  );
  process.stdout.write(
    `  settings.json ${summary.settingsAction} at ${paths.settingsPath}\n`,
  );
  process.stdout.write("Run 'omghc doctor' to verify.\n");
}

export async function runSetup(args: string[]): Promise<number> {
  const flags = parseFlags(args);

  if (flags.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  // `omghc setup --finalize-mcp` is a sibling subcommand routed through here.
  if (flags.finalizeMcp) {
    return runSetupFinalizeMcp(args.filter((a) => a !== "--finalize-mcp"));
  }

  // `omghc setup --finalize-hooks` re-runs only the project hook write.
  if (flags.finalizeHooks) {
    return runFinalizeHooks(args.filter((a) => a !== "--finalize-hooks"));
  }

  if (flags.unknown.length > 0) {
    process.stderr.write(
      `omghc setup: unknown argument(s): ${flags.unknown.join(", ")}\n`,
    );
    process.stderr.write("Run 'omghc setup --help' for usage.\n");
    return 2;
  }

  try {
    const paths = resolvePaths(flags.scope);
    const version = readPackageVersion(paths.repoRoot);

    if (flags.dryRun) {
      process.stdout.write(
        `omghc setup --dry-run (scope=${flags.scope}, mode=${flags.mode})\n`,
      );
      process.stdout.write(`  target:           ${paths.target}\n`);
      process.stdout.write(`  agents dir:       ${paths.agentsDir}\n`);
      process.stdout.write(`  instructions:     ${paths.instructionsPath}\n`);
      process.stdout.write(`  settings.json:    ${paths.settingsPath}\n`);
      if (flags.mode === "legacy") {
        process.stdout.write(`  skills dir:       ${paths.skillsDir}\n`);
      }
      process.stdout.write(`  stamp:            ${paths.stampPath}\n`);
    }

    const catalog = readCatalog(paths.repoRoot);

    ensureDir(paths.target, flags.dryRun);

    const agentsWritten = generateAgentsForPrompts(catalog, paths, flags.dryRun);
    const skillsCopied =
      flags.mode === "legacy" ? copyLegacySkills(catalog, paths, flags.dryRun) : 0;

    const instructionsAction = writeInstructions(paths, flags);
    const settingsAction = writeSettings(paths, flags);

    writeStamp(paths, flags, version);

    if (flags.mode === "plugin") {
      printPluginNotice(paths.target);
    } else {
      printLegacyNotice(paths.target);
    }
    printMcpNotice();

    if (!flags.noHooks) {
      const hookResult = writeProjectHookFile(paths, flags);
      printHookWriteResult(hookResult);
    }

    printSummary(paths, flags, {
      agentsWritten,
      skillsCopied,
      instructionsAction,
      settingsAction,
    });

    if (flags.dryRun) {
      process.stdout.write("\n(dry-run: no files were written)\n");
    }
    return 0;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`omghc setup: ${message}\n`);
    return 1;
  }
}
