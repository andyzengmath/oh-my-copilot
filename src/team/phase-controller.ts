import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type TeamPhase =
  | "team-plan"
  | "team-prd"
  | "team-exec"
  | "team-verify"
  | "team-fix"
  | "team-shutdown"
  | "team-done"
  | "team-failed";

export interface PhaseEvent {
  from: TeamPhase;
  to: TeamPhase;
  timestamp: string;
  reason?: string;
}

export interface PhaseControllerOptions {
  team_name: string;
  workingDirectory?: string;
  initialPhase?: TeamPhase;
  maxFixLoops?: number;
}

export interface PhaseController {
  getCurrentPhase(): TeamPhase;
  transitionPhase(to: TeamPhase, reason?: string): PhaseEvent;
  onPhaseChange(listener: (e: PhaseEvent) => void): () => void;
  getHistory(): PhaseEvent[];
  getFixLoopCount(): number;
}

interface PersistedState {
  team_name: string;
  current_phase: TeamPhase;
  history: PhaseEvent[];
  fix_loop_count: number;
}

const STATE_DIR_NAME = ".omghc";
const STATE_SUBDIR = "state";
const PHASE_FILE = "phase-state.json";
const DEFAULT_MAX_FIX_LOOPS = 3;

const VALID_TRANSITIONS: Record<TeamPhase, readonly TeamPhase[]> = {
  "team-plan": ["team-prd", "team-exec", "team-shutdown"],
  "team-prd": ["team-exec", "team-shutdown"],
  "team-exec": ["team-verify", "team-shutdown"],
  "team-verify": ["team-done", "team-fix", "team-failed", "team-shutdown"],
  "team-fix": ["team-exec", "team-shutdown"],
  "team-done": ["team-shutdown"],
  "team-shutdown": ["team-done"],
  "team-failed": [],
};

function resolveCwd(workingDirectory?: string): string {
  return workingDirectory && workingDirectory.trim().length > 0
    ? workingDirectory
    : process.cwd();
}

function phaseStatePath(team_name: string, workingDirectory?: string): string {
  return join(
    resolveCwd(workingDirectory),
    STATE_DIR_NAME,
    STATE_SUBDIR,
    `team-${team_name}`,
    PHASE_FILE,
  );
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function readState(path: string): PersistedState | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PersistedState;
  } catch {
    return null;
  }
}

function writeStateAtomic(path: string, state: PersistedState): void {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") break;
      const until = Date.now() + 20 * (attempt + 1);
      while (Date.now() < until) {
        // brief spin to let Windows release the file handle
      }
    }
  }
  throw lastErr;
}

export function createPhaseController(
  opts: PhaseControllerOptions,
): PhaseController {
  if (!opts.team_name || opts.team_name.trim() === "") {
    throw new Error("createPhaseController: team_name required");
  }
  const maxFixLoops =
    typeof opts.maxFixLoops === "number" && opts.maxFixLoops >= 0
      ? opts.maxFixLoops
      : DEFAULT_MAX_FIX_LOOPS;
  const path = phaseStatePath(opts.team_name, opts.workingDirectory);
  const teamDir = join(
    resolveCwd(opts.workingDirectory),
    STATE_DIR_NAME,
    STATE_SUBDIR,
    `team-${opts.team_name}`,
  );
  ensureDir(teamDir);

  const persisted = readState(path);
  const initialPhase: TeamPhase =
    persisted?.current_phase ?? opts.initialPhase ?? "team-plan";

  const state: PersistedState = persisted ?? {
    team_name: opts.team_name,
    current_phase: initialPhase,
    history: [],
    fix_loop_count: 0,
  };

  if (!persisted) {
    writeStateAtomic(path, state);
  }

  const listeners = new Set<(e: PhaseEvent) => void>();

  function transitionPhase(to: TeamPhase, reason?: string): PhaseEvent {
    const from = state.current_phase;
    const allowed = VALID_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      const err = new Error(
        `INVALID_TRANSITION: ${from} -> ${to} (allowed: ${allowed.join(", ") || "none"})`,
      );
      (err as Error & { code?: string }).code = "INVALID_TRANSITION";
      throw err;
    }
    if (to === "team-fix") {
      if (state.fix_loop_count >= maxFixLoops) {
        const err = new Error(
          `INVALID_TRANSITION: max fix loops (${maxFixLoops}) exceeded`,
        );
        (err as Error & { code?: string }).code = "INVALID_TRANSITION";
        throw err;
      }
      state.fix_loop_count += 1;
    }
    const event: PhaseEvent = {
      from,
      to,
      timestamp: new Date().toISOString(),
      ...(reason ? { reason } : {}),
    };
    state.current_phase = to;
    state.history.push(event);
    writeStateAtomic(path, state);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // listener errors are isolated; do not break fan-out
      }
    }
    return event;
  }

  function onPhaseChange(listener: (e: PhaseEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    getCurrentPhase: () => state.current_phase,
    transitionPhase,
    onPhaseChange,
    getHistory: () => [...state.history],
    getFixLoopCount: () => state.fix_loop_count,
  };
}
