import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export type ModeName =
  | "autopilot"
  | "autoresearch"
  | "team"
  | "ralph"
  | "ultrawork"
  | "ultraqa"
  | "ralplan"
  | "deep-interview"
  | "skill-active";

export const SUPPORTED_MODES: readonly ModeName[] = [
  "autopilot",
  "autoresearch",
  "team",
  "ralph",
  "ultrawork",
  "ultraqa",
  "ralplan",
  "deep-interview",
  "skill-active",
];

export interface ModeStateMeta {
  mode: ModeName;
  updatedAt: string;
  updatedBy?: string;
  sessionId?: string | null;
}

export interface ModeState {
  mode: ModeName;
  active: boolean;
  current_phase?: string;
  iteration?: number;
  max_iterations?: number;
  started_at?: string;
  completed_at?: string;
  error?: string;
  task_description?: string;
  plan_path?: string;
  state?: Record<string, string>;
  _meta?: ModeStateMeta;
}

export interface StateOpts {
  workingDirectory?: string;
  sessionId?: string | null;
}

export interface ListOpts {
  workingDirectory?: string;
}

const STATE_DIR_NAME = ".omghc";
const STATE_SUBDIR = "state";
const FILE_SUFFIX = "-state.json";
const UPDATED_BY = "state_operations";

function resolveWorkingDirectory(workingDirectory?: string): string {
  return workingDirectory && workingDirectory.trim().length > 0
    ? workingDirectory
    : process.cwd();
}

function getStateDir(workingDirectory?: string): string {
  return join(resolveWorkingDirectory(workingDirectory), STATE_DIR_NAME, STATE_SUBDIR);
}

function getStatePath(mode: ModeName, workingDirectory?: string): string {
  return join(getStateDir(workingDirectory), `${mode}${FILE_SUFFIX}`);
}

function ensureStateDir(workingDirectory?: string): string {
  const dir = getStateDir(workingDirectory);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readStateFile(path: string): ModeState | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as ModeState;
  } catch (error) {
    process.stderr.write(`[state] Failed to parse ${path}: ${(error as Error).message}\n`);
    return null;
  }
}

function writeStateFile(path: string, state: ModeState): void {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

export function stateWrite(
  mode: ModeName,
  partial: Partial<ModeState>,
  opts: StateOpts = {},
): ModeState {
  const dir = ensureStateDir(opts.workingDirectory);
  const path = join(dir, `${mode}${FILE_SUFFIX}`);
  const existing = readStateFile(path);

  const merged: ModeState = {
    ...(existing ?? { mode, active: false }),
    ...partial,
    mode,
  };

  merged._meta = {
    mode,
    updatedAt: new Date().toISOString(),
    updatedBy: UPDATED_BY,
    sessionId: opts.sessionId ?? null,
  };

  writeStateFile(path, merged);
  return merged;
}

export function stateRead(mode: ModeName, opts: StateOpts = {}): ModeState | null {
  return readStateFile(getStatePath(mode, opts.workingDirectory));
}

export function stateClear(mode: ModeName, opts: StateOpts = {}): void {
  const path = getStatePath(mode, opts.workingDirectory);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export interface ActiveModeEntry {
  mode: ModeName;
  active: boolean;
  current_phase?: string;
}

export function stateListActive(opts: ListOpts = {}): ActiveModeEntry[] {
  const dir = getStateDir(opts.workingDirectory);
  if (!existsSync(dir)) return [];

  const entries: ActiveModeEntry[] = [];
  const files = readdirSync(dir);
  for (const file of files) {
    if (!file.endsWith(FILE_SUFFIX)) continue;
    const modeSegment = file.slice(0, -FILE_SUFFIX.length);
    if (!SUPPORTED_MODES.includes(modeSegment as ModeName)) continue;

    const state = readStateFile(join(dir, file));
    if (!state || state.active !== true) continue;

    entries.push({
      mode: modeSegment as ModeName,
      active: true,
      ...(typeof state.current_phase === "string"
        ? { current_phase: state.current_phase }
        : {}),
    });
  }
  return entries;
}

export interface StatusSnapshot {
  active: boolean;
  current_phase?: string;
  iteration?: number;
}

export function stateGetStatus(mode: ModeName, opts: StateOpts = {}): StatusSnapshot {
  const state = stateRead(mode, opts);
  if (!state) return { active: false };

  const snapshot: StatusSnapshot = { active: state.active === true };
  if (typeof state.current_phase === "string") {
    snapshot.current_phase = state.current_phase;
  }
  if (typeof state.iteration === "number") {
    snapshot.iteration = state.iteration;
  }
  return snapshot;
}
