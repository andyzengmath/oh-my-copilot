/**
 * `omghc continue` — Stop-event replacement for Copilot CLI.
 *
 * Per M2a hooks spike (docs/copilot-native-hooks.md), Copilot has NO Stop
 * event. This wrapper replaces OMX's Stop-event-driven Ralph continuation:
 *
 *   1. The `sessionEnd` hook persists "resume hints" for any active modes
 *      to <wd>/.omghc/state/<mode>-resume-hint.json (see #8).
 *   2. The user (or scripted retry) runs `omghc continue` to resume the
 *      most recent mode.
 *
 * Usage:
 *   omghc continue              # resume most recent mode
 *   omghc continue --mode <m>   # resume a specific mode
 *   omghc continue --list       # list available hints
 *   omghc continue --clear      # clear all hints
 *   omghc continue --clear --mode <m>  # clear one mode's hint
 *   omghc continue --dry-run    # print what would run; don't execute
 *   omghc continue --help / -h
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { SUPPORTED_MODES, type ModeName } from "../state/operations.js";

export type ResumeMode =
  | "ralph"
  | "ultrawork"
  | "team"
  | "autopilot"
  | "ralplan"
  | "deep-interview";

const RESUMABLE_MODES: readonly ResumeMode[] = [
  "ralph",
  "ultrawork",
  "team",
  "autopilot",
  "ralplan",
  "deep-interview",
];

export interface ResumeHint {
  mode: ResumeMode;
  session_id: string;
  captured_at: string;
  next_action: string;
  resume_command: string;
  state_snapshot?: Record<string, unknown>;
}

const STATE_DIR_NAME = ".omghc";
const STATE_SUBDIR = "state";
const HINT_SUFFIX = "-resume-hint.json";

// --- Path helpers ------------------------------------------------------------

function workingDir(): string {
  return process.cwd();
}

function stateDir(wd: string = workingDir()): string {
  return join(wd, STATE_DIR_NAME, STATE_SUBDIR);
}

export function hintPath(mode: ResumeMode, wd: string = workingDir()): string {
  return join(stateDir(wd), `${mode}${HINT_SUFFIX}`);
}

function ensureStateDir(wd: string = workingDir()): string {
  const dir = stateDir(wd);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function isResumeMode(value: string): value is ResumeMode {
  return (RESUMABLE_MODES as readonly string[]).includes(value);
}

// --- Hint I/O ----------------------------------------------------------------

function readHintFile(path: string): ResumeHint | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as ResumeHint;
    if (!parsed || typeof parsed !== "object") return null;
    if (!isResumeMode(parsed.mode as string)) return null;
    if (typeof parsed.resume_command !== "string") return null;
    return parsed;
  } catch (err) {
    process.stderr.write(
      `[continue] Failed to parse ${path}: ${(err as Error).message}\n`,
    );
    return null;
  }
}

export function writeHint(hint: ResumeHint, wd: string = workingDir()): void {
  ensureStateDir(wd);
  const path = hintPath(hint.mode, wd);
  writeFileSync(path, `${JSON.stringify(hint, null, 2)}\n`, "utf-8");
}

export function listHints(wd: string = workingDir()): ResumeHint[] {
  const dir = stateDir(wd);
  if (!existsSync(dir)) return [];

  const out: ResumeHint[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(HINT_SUFFIX)) continue;
    const modeSegment = file.slice(0, -HINT_SUFFIX.length);
    if (!isResumeMode(modeSegment)) continue;
    const hint = readHintFile(join(dir, file));
    if (hint) out.push(hint);
  }
  // Most-recent first.
  out.sort((a, b) => (a.captured_at < b.captured_at ? 1 : -1));
  return out;
}

function clearHint(mode: ResumeMode, wd: string = workingDir()): boolean {
  const path = hintPath(mode, wd);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

function clearAllHints(wd: string = workingDir()): number {
  let count = 0;
  for (const mode of RESUMABLE_MODES) {
    if (clearHint(mode, wd)) count++;
  }
  return count;
}

// --- Argument parsing --------------------------------------------------------

interface ParsedArgs {
  mode?: ResumeMode;
  list: boolean;
  clear: boolean;
  dryRun: boolean;
  help: boolean;
  invalidMode?: string;
  unknownFlag?: string;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = {
    list: false,
    clear: false,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      out.help = true;
    } else if (a === "--list") {
      out.list = true;
    } else if (a === "--clear") {
      out.clear = true;
    } else if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "--mode") {
      const next = args[i + 1];
      if (!next) {
        out.invalidMode = "<missing>";
      } else if (!isResumeMode(next)) {
        out.invalidMode = next;
      } else {
        out.mode = next;
      }
      i++;
    } else if (a !== undefined && a.startsWith("--mode=")) {
      const v = a.slice("--mode=".length);
      if (!isResumeMode(v)) {
        out.invalidMode = v;
      } else {
        out.mode = v;
      }
    } else {
      out.unknownFlag = a;
    }
  }

  return out;
}

// --- Help text ---------------------------------------------------------------

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: omghc continue [options]",
      "",
      "Resume the most recent OMGHC mode using a persisted resume hint.",
      "",
      "Options:",
      "  --mode <m>   Resume a specific mode (ralph, ultrawork, team,",
      "               autopilot, ralplan, deep-interview)",
      "  --list       List all available resume hints; do not execute",
      "  --clear      Remove all resume hints (combine with --mode for one)",
      "  --dry-run    Print the command that would run; do not spawn",
      "  --help, -h   Show this help",
      "",
      "Resume hints are written by the sessionEnd hook to:",
      "  <cwd>/.omghc/state/<mode>-resume-hint.json",
      "",
    ].join("\n"),
  );
}

// --- Subcommand handlers -----------------------------------------------------

function doList(): number {
  const hints = listHints();
  if (hints.length === 0) {
    process.stdout.write("No active OMGHC mode to continue.\n");
    return 0;
  }
  process.stdout.write(`Found ${hints.length} resume hint(s):\n`);
  for (const h of hints) {
    process.stdout.write(
      `  ${h.mode.padEnd(15)} ${h.captured_at}  ${h.next_action}\n`,
    );
  }
  return 0;
}

function doClear(mode?: ResumeMode): number {
  if (mode) {
    const ok = clearHint(mode);
    process.stdout.write(
      ok
        ? `Cleared ${mode} resume hint.\n`
        : `No ${mode} resume hint to clear.\n`,
    );
    return 0;
  }
  const n = clearAllHints();
  process.stdout.write(`Cleared ${n} resume hint(s).\n`);
  return 0;
}

function pickHint(mode?: ResumeMode): ResumeHint | null {
  const hints = listHints();
  if (hints.length === 0) return null;
  if (mode) {
    return hints.find((h) => h.mode === mode) ?? null;
  }
  return hints[0] ?? null;
}

function splitCommand(cmdline: string): { cmd: string; args: string[] } | null {
  // Simple split: respects single-quoted segments. Avoids exec() injection
  // surface by handing argv straight to spawn.
  const tokens: string[] = [];
  let buf = "";
  let inQuote = false;
  for (const ch of cmdline) {
    if (ch === "'") {
      inQuote = !inQuote;
      continue;
    }
    if (ch === " " && !inQuote) {
      if (buf.length > 0) {
        tokens.push(buf);
        buf = "";
      }
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) tokens.push(buf);
  if (tokens.length === 0) return null;
  const [cmd, ...args] = tokens;
  if (!cmd) return null;
  return { cmd, args };
}

function doExecute(hint: ResumeHint, dryRun: boolean): Promise<number> {
  process.stdout.write(
    `Resuming ${hint.mode} (last activity: ${hint.captured_at})\n`,
  );
  process.stdout.write(`  Next: ${hint.next_action}\n`);
  process.stdout.write(`  Command: ${hint.resume_command}\n`);

  if (dryRun) {
    process.stdout.write("(dry-run; not spawning)\n");
    return Promise.resolve(0);
  }

  const split = splitCommand(hint.resume_command);
  if (!split) {
    process.stderr.write("[continue] resume_command is empty\n");
    return Promise.resolve(1);
  }

  return new Promise((resolve) => {
    const child = spawn(split.cmd, split.args, {
      stdio: "inherit",
      shell: false,
    });
    child.on("error", (err) => {
      process.stderr.write(
        `[continue] failed to spawn '${split.cmd}': ${err.message}\n`,
      );
      resolve(1);
    });
    child.on("exit", (code) => {
      resolve(code ?? 0);
    });
  });
}

// --- Entry point -------------------------------------------------------------

export async function runContinue(args: string[]): Promise<number> {
  const parsed = parseArgs(args);

  if (parsed.help) {
    printHelp();
    return 0;
  }

  if (parsed.unknownFlag) {
    process.stderr.write(
      `omghc continue: unknown flag '${parsed.unknownFlag}'. Run 'omghc continue --help'.\n`,
    );
    return 2;
  }

  if (parsed.invalidMode) {
    process.stderr.write(
      `omghc continue: invalid --mode '${parsed.invalidMode}'. Valid: ${RESUMABLE_MODES.join(", ")}\n`,
    );
    return 2;
  }

  if (parsed.list) {
    return doList();
  }

  if (parsed.clear) {
    return doClear(parsed.mode);
  }

  const hint = pickHint(parsed.mode);
  if (!hint) {
    if (parsed.mode) {
      process.stdout.write(
        `No ${parsed.mode} resume hint found. Run a workflow first (e.g., \`omghc ${parsed.mode}\`).\n`,
      );
    } else {
      process.stdout.write(
        "No active OMGHC mode to continue. Run a workflow first (e.g., `omghc team`).\n",
      );
    }
    return 0;
  }

  return doExecute(hint, parsed.dryRun);
}

// --- Helpers exported for sessionEnd hook & tests ----------------------------

export function isResumableMode(value: string): value is ResumeMode {
  return isResumeMode(value);
}

export function modeNameToResumeMode(mode: ModeName): ResumeMode | null {
  return isResumeMode(mode as string) ? (mode as ResumeMode) : null;
}

export const _internals = {
  RESUMABLE_MODES,
  SUPPORTED_MODES,
  HINT_SUFFIX,
  hintPath,
  parseArgs,
  splitCommand,
  pickHint,
  listHints,
  writeHint,
  clearAllHints,
  clearHint,
};
