import { runTeamApi } from "../team/api.js";
import { resumeTeamRuntime, runTeamRuntime } from "../team/runtime.js";
import { readHudSnapshot, renderHudJson, renderHudTable } from "../hud/index.js";
import {
  isWorkerCli,
  type TeamWorkerCli,
} from "../team/tmux-session.js";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const HELP = `Usage: omghc team <subcommand> [options]

Subcommands:
  N:role "task"          Start a new team. N=worker count (1-20), role=lowercase token.
  status <name>          Print team status (phase, workers, tasks).
  resume <name>          Resume an existing team.
  shutdown <name>        Graceful shutdown of a team. Pass --force to skip waits.
  api <op> [--input ...] [--json]
                         Dispatcher to the team JSON-envelope API.
  --help, -h             Show this usage.

Common options for start/resume/shutdown:
  --team <name>          Team name (default derived from role when starting).
  --cwd <path>           Working directory (default: cwd).
  --cli <copilot|codex|claude|gemini>
                         Worker CLI to spawn (default: copilot).
  --max-fix-loops <N>    Max fix loops in verify gate (default: 3).
  --worktree-per-worker  Allocate a git worktree per worker.
  --json                 Emit JSONL events (start/resume) or JSON snapshots (status).

Examples:
  omghc team 3:engineer "ship the auth refactor"
  omghc team status alpha
  omghc team resume alpha --cwd /repo
  omghc team shutdown alpha --force
  omghc team api list-tasks --json --input '{"team_name":"alpha"}'
`;

const ROLE_SPEC = /^(\d+):([a-z][a-z0-9-]*)$/;

interface ParsedFlags {
  team: string | null;
  cwd: string | null;
  cli: TeamWorkerCli | null;
  maxFixLoops: number | null;
  worktreePerWorker: boolean;
  force: boolean;
  json: boolean;
}

function emptyFlags(): ParsedFlags {
  return {
    team: null,
    cwd: null,
    cli: null,
    maxFixLoops: null,
    worktreePerWorker: false,
    force: false,
    json: false,
  };
}

function parseFlags(args: string[]): { flags: ParsedFlags; positional: string[] } {
  const flags = emptyFlags();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]!;
    if (token === "--json") {
      flags.json = true;
      continue;
    }
    if (token === "--worktree-per-worker") {
      flags.worktreePerWorker = true;
      continue;
    }
    if (token === "--force") {
      flags.force = true;
      continue;
    }
    if (token === "--team") {
      flags.team = expectValue(args, i, "--team");
      i += 1;
      continue;
    }
    if (token.startsWith("--team=")) {
      flags.team = token.slice("--team=".length);
      continue;
    }
    if (token === "--cwd") {
      flags.cwd = expectValue(args, i, "--cwd");
      i += 1;
      continue;
    }
    if (token.startsWith("--cwd=")) {
      flags.cwd = token.slice("--cwd=".length);
      continue;
    }
    if (token === "--cli") {
      flags.cli = parseCli(expectValue(args, i, "--cli"));
      i += 1;
      continue;
    }
    if (token.startsWith("--cli=")) {
      flags.cli = parseCli(token.slice("--cli=".length));
      continue;
    }
    if (token === "--max-fix-loops") {
      flags.maxFixLoops = parseNonNegInt(
        expectValue(args, i, "--max-fix-loops"),
        "--max-fix-loops",
      );
      i += 1;
      continue;
    }
    if (token.startsWith("--max-fix-loops=")) {
      flags.maxFixLoops = parseNonNegInt(
        token.slice("--max-fix-loops=".length),
        "--max-fix-loops",
      );
      continue;
    }
    if (token.startsWith("--")) {
      throw new Error(`unknown flag: ${token}`);
    }
    positional.push(token);
  }
  return { flags, positional };
}

function expectValue(args: string[], i: number, flag: string): string {
  const next = args[i + 1];
  if (typeof next !== "string") {
    throw new Error(`${flag} requires a value`);
  }
  return next;
}

function parseCli(raw: string): TeamWorkerCli {
  if (!isWorkerCli(raw)) {
    throw new Error(`--cli must be one of copilot|codex|claude|gemini (got '${raw}')`);
  }
  return raw;
}

function parseNonNegInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${flag} must be a non-negative integer (got '${raw}')`);
  }
  return n;
}

function defaultTeamName(role: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${role}-${stamp}`;
}

function exitCodeForPhase(phase: string): number {
  if (phase === "team-done") return 0;
  if (phase === "team-failed") return 1;
  return 1;
}

function emitJsonl(write: (s: string) => void, event: Record<string, unknown>): void {
  write(`${JSON.stringify(event)}\n`);
}

function emitHumanProgress(write: (s: string) => void, event: Record<string, unknown>): void {
  const phase = typeof event.phase === "string" ? event.phase : "team";
  write(`[${phase}] ${describeEvent(event)}\n`);
}

function describeEvent(event: Record<string, unknown>): string {
  const type = String(event.type ?? "event");
  switch (type) {
    case "team_start":
      return `starting team=${event.team_name} role=${event.role} workers=${event.worker_count}`;
    case "team_resume":
      return `resuming team=${event.team_name}`;
    case "team_done":
      return `done — completed=${event.tasksCompleted} failed=${event.tasksFailed} duration=${event.durationMs}ms`;
    case "team_failed":
      return `failed — completed=${event.tasksCompleted} failed=${event.tasksFailed} reason=${event.reason ?? "unknown"}`;
    case "team_error":
      return `error — ${event.message}`;
    default:
      return type;
  }
}

interface RunStartOpts {
  worker_count: number;
  role: string;
  task_description: string;
  flags: ParsedFlags;
}

async function runStart(opts: RunStartOpts): Promise<number> {
  const team_name = opts.flags.team ?? defaultTeamName(opts.role);
  const write = (s: string) => process.stdout.write(s);
  const emit = opts.flags.json ? emitJsonl : emitHumanProgress;

  emit(write, {
    type: "team_start",
    phase: "team-plan",
    team_name,
    role: opts.role,
    worker_count: opts.worker_count,
    cli: opts.flags.cli ?? "copilot",
    cwd: opts.flags.cwd ?? process.cwd(),
  });

  try {
    const result = await runTeamRuntime({
      team_name,
      worker_count: opts.worker_count,
      role: opts.role,
      task_description: opts.task_description,
      workingDirectory: opts.flags.cwd ?? undefined,
      cli: opts.flags.cli ?? undefined,
      maxFixLoops: opts.flags.maxFixLoops ?? undefined,
      worktreePerWorker: opts.flags.worktreePerWorker,
    });

    const eventType = result.finalPhase === "team-done" ? "team_done" : "team_failed";
    emit(write, {
      type: eventType,
      phase: result.finalPhase,
      team_name: result.team_name,
      iterations: result.iterations,
      tasksCompleted: result.tasksCompleted,
      tasksFailed: result.tasksFailed,
      durationMs: result.durationMs,
    });
    return exitCodeForPhase(result.finalPhase);
  } catch (error) {
    emit(write, {
      type: "team_error",
      phase: "team-failed",
      team_name,
      message: (error as Error).message,
    });
    return 1;
  }
}

async function runResume(team_name: string, flags: ParsedFlags): Promise<number> {
  const write = (s: string) => process.stdout.write(s);
  const emit = flags.json ? emitJsonl : emitHumanProgress;
  emit(write, { type: "team_resume", phase: "team-plan", team_name });
  try {
    const result = await resumeTeamRuntime(team_name, {
      workingDirectory: flags.cwd ?? undefined,
    });
    const eventType = result.finalPhase === "team-done" ? "team_done" : "team_failed";
    emit(write, {
      type: eventType,
      phase: result.finalPhase,
      team_name: result.team_name,
      iterations: result.iterations,
      tasksCompleted: result.tasksCompleted,
      tasksFailed: result.tasksFailed,
      durationMs: result.durationMs,
    });
    return exitCodeForPhase(result.finalPhase);
  } catch (error) {
    emit(write, {
      type: "team_error",
      phase: "team-failed",
      team_name,
      message: (error as Error).message,
    });
    return 1;
  }
}

function runStatus(team_name: string, flags: ParsedFlags): number {
  const snapshot = readHudSnapshot(team_name, {
    workingDirectory: flags.cwd ?? undefined,
  });
  if (flags.json) {
    process.stdout.write(renderHudJson(snapshot));
    return snapshot.found ? 0 : 1;
  }
  process.stdout.write(renderHudTable(snapshot));
  return snapshot.found ? 0 : 1;
}

async function runShutdown(team_name: string, flags: ParsedFlags): Promise<number> {
  const cwd = flags.cwd ?? process.cwd();
  const write = (s: string) => process.stdout.write(s);
  const emit = flags.json ? emitJsonl : emitHumanProgress;

  const teamDir = join(cwd, ".omghc", "state", `team-${team_name}`);
  if (!existsSync(teamDir)) {
    emit(write, {
      type: "team_error",
      phase: "team-shutdown",
      team_name,
      message: "team not found",
    });
    return 1;
  }

  if (flags.force) {
    try {
      rmSync(teamDir, { recursive: true, force: true });
      emit(write, {
        type: "team_done",
        phase: "team-shutdown",
        team_name,
        tasksCompleted: 0,
        tasksFailed: 0,
        durationMs: 0,
        forced: true,
      });
      return 0;
    } catch (error) {
      emit(write, {
        type: "team_error",
        phase: "team-shutdown",
        team_name,
        message: (error as Error).message,
      });
      return 1;
    }
  }

  emit(write, {
    type: "team_done",
    phase: "team-shutdown",
    team_name,
    tasksCompleted: 0,
    tasksFailed: 0,
    durationMs: 0,
    note: "graceful shutdown is best-effort; state preserved on disk. Use --force to remove team state directory.",
  });
  return 0;
}

export async function runTeam(args: string[]): Promise<number> {
  const [first, ...rest] = args;
  if (!first || first === "--help" || first === "-h" || first === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  if (first === "api") {
    return runTeamApi(rest);
  }

  let parsed: { flags: ParsedFlags; positional: string[] };
  try {
    parsed = parseFlags(rest);
  } catch (error) {
    process.stderr.write(`omghc team: ${(error as Error).message}\n${HELP}`);
    return 2;
  }

  if (first === "status") {
    const team_name = parsed.positional[0] ?? parsed.flags.team;
    if (!team_name) {
      process.stderr.write(`omghc team status: <name> required\n`);
      return 2;
    }
    return runStatus(team_name, parsed.flags);
  }

  if (first === "resume") {
    const team_name = parsed.positional[0] ?? parsed.flags.team;
    if (!team_name) {
      process.stderr.write(`omghc team resume: <name> required\n`);
      return 2;
    }
    return runResume(team_name, parsed.flags);
  }

  if (first === "shutdown") {
    const team_name = parsed.positional[0] ?? parsed.flags.team;
    if (!team_name) {
      process.stderr.write(`omghc team shutdown: <name> required\n`);
      return 2;
    }
    return runShutdown(team_name, parsed.flags);
  }

  // Otherwise, expect `N:role "task"` form
  const match = first.match(ROLE_SPEC);
  if (!match) {
    process.stderr.write(
      `omghc team: unknown subcommand or invalid spec '${first}'. Expected N:role or one of: status|resume|shutdown|api|help.\n${HELP}`,
    );
    return 2;
  }

  const worker_count = Number(match[1]);
  const role = match[2]!;
  if (!Number.isInteger(worker_count) || worker_count < 1 || worker_count > 20) {
    process.stderr.write(
      `omghc team: worker count must be 1-20 (got ${match[1]})\n`,
    );
    return 2;
  }

  const task_description = parsed.positional.join(" ").trim();
  if (!task_description) {
    process.stderr.write(`omghc team: task description required after N:role\n${HELP}`);
    return 2;
  }

  const exitCode = await runStart({
    worker_count,
    role,
    task_description,
    flags: parsed.flags,
  });
  return exitCode;
}
