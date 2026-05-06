import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listTasks, type TeamTask, type TaskStatus } from "../team/state/tasks.js";
import {
  isWorkerAlive,
  listWorkerIdentities,
  readWorkerHeartbeat,
  type WorkerHeartbeat,
  type WorkerIdentity,
  type WorkerState,
} from "../team/state/workers.js";
import { HUD_STALE_THRESHOLD_MS } from "./constants.js";

export interface HudWorkerRow {
  name: string;
  index: number;
  role: string;
  state: WorkerState | "unknown";
  alive: boolean;
  turn_count: number;
  current_task_id: string | null;
  current_task_status: TaskStatus | null;
  last_beat_at: string | null;
  last_beat_age_ms: number | null;
}

export interface HudTaskCounts {
  pending: number;
  claimed: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
}

export interface HudSnapshot {
  team_name: string;
  found: boolean;
  phase: string | null;
  started_at: string | null;
  uptime_ms: number | null;
  workers: HudWorkerRow[];
  tasks: HudTaskCounts;
  generated_at: string;
}

interface ReadOpts {
  workingDirectory?: string;
  staleThresholdMs?: number;
  now?: number;
}

const STATE_DIR_NAME = ".omghc";
const STATE_SUBDIR = "state";
const PHASE_FILE = "phase-state.json";

function resolveCwd(workingDirectory?: string): string {
  return workingDirectory && workingDirectory.trim().length > 0
    ? workingDirectory
    : process.cwd();
}

function teamDir(team_name: string, workingDirectory?: string): string {
  return join(
    resolveCwd(workingDirectory),
    STATE_DIR_NAME,
    STATE_SUBDIR,
    `team-${team_name}`,
  );
}

function readPhase(team_name: string, workingDirectory?: string): {
  phase: string | null;
  started_at: string | null;
} {
  const path = join(teamDir(team_name, workingDirectory), PHASE_FILE);
  if (!existsSync(path)) return { phase: null, started_at: null };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
      current_phase?: unknown;
      history?: Array<{ timestamp?: unknown }>;
    };
    const phase = typeof parsed.current_phase === "string" ? parsed.current_phase : null;
    const first = Array.isArray(parsed.history) ? parsed.history[0] : undefined;
    const started_at =
      first && typeof first.timestamp === "string" ? first.timestamp : null;
    return { phase, started_at };
  } catch {
    return { phase: null, started_at: null };
  }
}

function emptyTaskCounts(): HudTaskCounts {
  return {
    pending: 0,
    claimed: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    total: 0,
  };
}

function tallyTasks(tasks: TeamTask[]): HudTaskCounts {
  const counts = emptyTaskCounts();
  for (const t of tasks) {
    counts.total += 1;
    counts[t.status] += 1;
  }
  return counts;
}

function buildWorkerRow(
  identity: WorkerIdentity,
  beat: WorkerHeartbeat | null,
  tasksById: Map<string, TeamTask>,
  staleThresholdMs: number,
  now: number,
): HudWorkerRow {
  const alive = isWorkerAlive(beat, { staleThresholdMs });
  const last_beat_at = beat?.last_beat_at ?? null;
  const parsed = last_beat_at ? Date.parse(last_beat_at) : NaN;
  const last_beat_age_ms = Number.isFinite(parsed) ? now - parsed : null;
  const taskId = beat?.current_task_id ?? null;
  const task = taskId ? tasksById.get(taskId) ?? null : null;

  let state: HudWorkerRow["state"];
  if (beat?.state) {
    state = beat.state;
  } else if (alive) {
    state = "idle";
  } else if (beat) {
    state = "stalled";
  } else {
    state = "unknown";
  }

  return {
    name: identity.name,
    index: identity.index,
    role: identity.role,
    state,
    alive,
    turn_count: typeof beat?.turn_count === "number" ? beat.turn_count : 0,
    current_task_id: taskId,
    current_task_status: task?.status ?? null,
    last_beat_at,
    last_beat_age_ms,
  };
}

export function readHudSnapshot(team_name: string, opts: ReadOpts = {}): HudSnapshot {
  const wd = opts.workingDirectory;
  const stale = opts.staleThresholdMs ?? HUD_STALE_THRESHOLD_MS;
  const now = opts.now ?? Date.now();
  const generated_at = new Date(now).toISOString();
  const dir = teamDir(team_name, wd);
  const found = existsSync(dir);

  if (!found) {
    return {
      team_name,
      found: false,
      phase: null,
      started_at: null,
      uptime_ms: null,
      workers: [],
      tasks: emptyTaskCounts(),
      generated_at,
    };
  }

  const { phase, started_at } = readPhase(team_name, wd);
  const tasks = listTasks(team_name, { workingDirectory: wd });
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const identities = listWorkerIdentities(team_name, { workingDirectory: wd });

  const workers: HudWorkerRow[] = identities.map((id) => {
    const beat = readWorkerHeartbeat(team_name, id.name, { workingDirectory: wd });
    return buildWorkerRow(id, beat, tasksById, stale, now);
  });

  const startedMs = started_at ? Date.parse(started_at) : NaN;
  const uptime_ms = Number.isFinite(startedMs) ? now - startedMs : null;

  return {
    team_name,
    found: true,
    phase,
    started_at,
    uptime_ms,
    workers,
    tasks: tallyTasks(tasks),
    generated_at,
  };
}
