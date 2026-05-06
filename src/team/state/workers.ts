import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type WorkerCli = "copilot" | "codex" | "claude" | "gemini";

export type WorkerState = "idle" | "busy" | "stalled" | "dead";

export interface WorkerIdentity {
  name: string;
  index: number;
  role: string;
  team_name: string;
  pid?: number;
  cli?: WorkerCli;
}

export interface WorkerHeartbeat {
  worker_name: string;
  team_name: string;
  pid?: number;
  last_beat_at: string;
  turn_count?: number;
  alive: boolean;
  state?: WorkerState;
  current_task_id?: string;
}

export interface WorkerOpts {
  workingDirectory?: string;
}

export interface AliveOpts {
  staleThresholdMs?: number;
}

const STATE_DIR_NAME = ".omghc";
const STATE_SUBDIR = "state";
const WORKERS_SUBDIR = "workers";
const IDENTITY_FILE = "identity.json";
const HEARTBEAT_FILE = "heartbeat.json";
const DEFAULT_STALE_THRESHOLD_MS = 90_000;

function resolveCwd(opts: WorkerOpts | undefined): string {
  const wd = opts?.workingDirectory;
  return wd && wd.trim().length > 0 ? wd : process.cwd();
}

function teamDir(team_name: string, opts: WorkerOpts | undefined): string {
  return join(
    resolveCwd(opts),
    STATE_DIR_NAME,
    STATE_SUBDIR,
    `team-${team_name}`,
  );
}

function workersDir(team_name: string, opts: WorkerOpts | undefined): string {
  return join(teamDir(team_name, opts), WORKERS_SUBDIR);
}

function workerDir(
  team_name: string,
  worker_name: string,
  opts: WorkerOpts | undefined,
): string {
  return join(workersDir(team_name, opts), worker_name);
}

function ensureWorkerDir(
  team_name: string,
  worker_name: string,
  opts: WorkerOpts | undefined,
): string {
  const dir = workerDir(team_name, worker_name, opts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  renameSync(tmp, path);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isWorkerIdentity(v: unknown): v is WorkerIdentity {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    typeof o.index === "number" &&
    typeof o.role === "string" &&
    typeof o.team_name === "string"
  );
}

function isWorkerHeartbeat(v: unknown): v is WorkerHeartbeat {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.worker_name === "string" &&
    typeof o.team_name === "string" &&
    typeof o.last_beat_at === "string" &&
    typeof o.alive === "boolean"
  );
}

export function writeWorkerIdentity(
  identity: WorkerIdentity,
  opts?: WorkerOpts,
): void {
  if (!identity.team_name || identity.team_name.trim() === "") {
    throw new Error("writeWorkerIdentity: team_name required");
  }
  if (!identity.name || identity.name.trim() === "") {
    throw new Error("writeWorkerIdentity: name required");
  }
  ensureWorkerDir(identity.team_name, identity.name, opts);
  const path = join(
    workerDir(identity.team_name, identity.name, opts),
    IDENTITY_FILE,
  );
  writeJsonAtomic(path, identity);
}

export function readWorkerIdentity(
  team_name: string,
  worker_name: string,
  opts?: WorkerOpts,
): WorkerIdentity | null {
  const path = join(workerDir(team_name, worker_name, opts), IDENTITY_FILE);
  const parsed = readJson<unknown>(path);
  return isWorkerIdentity(parsed) ? parsed : null;
}

export function listWorkerIdentities(
  team_name: string,
  opts?: WorkerOpts,
): WorkerIdentity[] {
  const dir = workersDir(team_name, opts);
  if (!existsSync(dir)) return [];
  const identities: WorkerIdentity[] = [];
  for (const entry of readdirSync(dir)) {
    const child = join(dir, entry);
    try {
      const st = statSync(child);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    const identity = readWorkerIdentity(team_name, entry, opts);
    if (identity) identities.push(identity);
  }
  identities.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return a.name.localeCompare(b.name);
  });
  return identities;
}

export function writeWorkerHeartbeat(
  beat: Partial<WorkerHeartbeat> & { worker_name: string; team_name: string },
  opts?: WorkerOpts,
): WorkerHeartbeat {
  if (!beat.team_name || beat.team_name.trim() === "") {
    throw new Error("writeWorkerHeartbeat: team_name required");
  }
  if (!beat.worker_name || beat.worker_name.trim() === "") {
    throw new Error("writeWorkerHeartbeat: worker_name required");
  }
  ensureWorkerDir(beat.team_name, beat.worker_name, opts);
  const full: WorkerHeartbeat = {
    worker_name: beat.worker_name,
    team_name: beat.team_name,
    pid: beat.pid,
    last_beat_at: beat.last_beat_at ?? new Date().toISOString(),
    turn_count: beat.turn_count,
    alive: beat.alive ?? true,
    state: beat.state,
    current_task_id: beat.current_task_id,
  };
  const path = join(
    workerDir(beat.team_name, beat.worker_name, opts),
    HEARTBEAT_FILE,
  );
  writeJsonAtomic(path, full);
  return full;
}

export function readWorkerHeartbeat(
  team_name: string,
  worker_name: string,
  opts?: WorkerOpts,
): WorkerHeartbeat | null {
  const path = join(workerDir(team_name, worker_name, opts), HEARTBEAT_FILE);
  const parsed = readJson<unknown>(path);
  return isWorkerHeartbeat(parsed) ? parsed : null;
}

export function isWorkerAlive(
  beat: WorkerHeartbeat | null,
  opts?: AliveOpts,
): boolean {
  if (!beat) return false;
  if (beat.alive === false) return false;
  const threshold = opts?.staleThresholdMs ?? DEFAULT_STALE_THRESHOLD_MS;
  const last = Date.parse(beat.last_beat_at);
  if (!Number.isFinite(last)) return false;
  return Date.now() - last <= threshold;
}

export function listAliveWorkers(
  team_name: string,
  opts?: WorkerOpts & AliveOpts,
): WorkerIdentity[] {
  const identities = listWorkerIdentities(team_name, opts);
  const alive: WorkerIdentity[] = [];
  for (const identity of identities) {
    const beat = readWorkerHeartbeat(team_name, identity.name, opts);
    if (isWorkerAlive(beat, opts)) alive.push(identity);
  }
  return alive;
}
