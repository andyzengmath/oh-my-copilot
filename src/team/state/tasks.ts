import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type TaskStatus =
  | "pending"
  | "claimed"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface TeamTask {
  id: string;
  team_name: string;
  subject: string;
  description: string;
  owner: string;
  status: TaskStatus;
  version: number;
  claim_token?: string;
  blocks?: string[];
  blockedBy?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateTaskInput {
  team_name: string;
  subject: string;
  description: string;
  owner?: string;
}

export interface TaskOpts {
  workingDirectory?: string;
}

const STATE_DIR_NAME = ".omghc";
const STATE_SUBDIR = "state";
const TASKS_SUBDIR = "tasks";
const LOCK_SUFFIX = ".lock";
const LOCK_STALE_MS = 30_000;

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

function resolveCwd(opts: TaskOpts | undefined): string {
  const wd = opts?.workingDirectory;
  return wd && wd.trim().length > 0 ? wd : process.cwd();
}

function teamDir(team_name: string, opts: TaskOpts | undefined): string {
  return join(
    resolveCwd(opts),
    STATE_DIR_NAME,
    STATE_SUBDIR,
    `team-${team_name}`,
  );
}

function tasksDir(team_name: string, opts: TaskOpts | undefined): string {
  return join(teamDir(team_name, opts), TASKS_SUBDIR);
}

function ensureTasksDir(team_name: string, opts: TaskOpts | undefined): string {
  const dir = tasksDir(team_name, opts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function taskFilePath(
  team_name: string,
  task_id: string,
  opts: TaskOpts | undefined,
): string {
  return join(tasksDir(team_name, opts), `${task_id}.json`);
}

function lockFilePath(team_name: string, opts: TaskOpts | undefined): string {
  return join(teamDir(team_name, opts), `tasks${LOCK_SUFFIX}`);
}

function acquireLock(team_name: string, opts: TaskOpts | undefined): string {
  ensureTasksDir(team_name, opts);
  const lockPath = lockFilePath(team_name, opts);
  const tokenContent = `${process.pid}:${Date.now()}:${randomUUID()}`;
  if (existsSync(lockPath)) {
    try {
      const raw = readFileSync(lockPath, "utf-8");
      const parts = raw.split(":");
      const ts = Number(parts[1] ?? "0");
      if (Number.isFinite(ts) && Date.now() - ts > LOCK_STALE_MS) {
        rmSync(lockPath, { force: true });
      }
    } catch {
      rmSync(lockPath, { force: true });
    }
  }
  try {
    writeFileSync(lockPath, tokenContent, { encoding: "utf-8", flag: "wx" });
  } catch {
    // Best-effort advisory lock; if another writer holds it, fall through.
  }
  return tokenContent;
}

function releaseLock(team_name: string, opts: TaskOpts | undefined): void {
  const lockPath = lockFilePath(team_name, opts);
  try {
    if (existsSync(lockPath)) rmSync(lockPath, { force: true });
  } catch {
    // ignore
  }
}

function withLock<T>(
  team_name: string,
  opts: TaskOpts | undefined,
  fn: () => T,
): T {
  acquireLock(team_name, opts);
  try {
    return fn();
  } finally {
    releaseLock(team_name, opts);
  }
}

function readTaskFile(path: string): TeamTask | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as TeamTask;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.team_name !== "string" ||
      typeof parsed.subject !== "string" ||
      typeof parsed.description !== "string" ||
      typeof parsed.owner !== "string" ||
      typeof parsed.status !== "string" ||
      typeof parsed.version !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeTaskFileAtomic(path: string, task: TeamTask): void {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, `${JSON.stringify(task, null, 2)}\n`, "utf-8");
  renameSync(tmp, path);
}

function nextNumericId(team_name: string, opts: TaskOpts | undefined): string {
  const dir = ensureTasksDir(team_name, opts);
  let max = 0;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const stem = entry.slice(0, -".json".length);
    const n = Number(stem);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

export function createTask(input: CreateTaskInput, opts?: TaskOpts): TeamTask {
  if (!input.team_name || input.team_name.trim() === "") {
    throw new Error("createTask: team_name required");
  }
  if (!input.subject || input.subject.trim() === "") {
    throw new Error("createTask: subject required");
  }
  ensureTasksDir(input.team_name, opts);
  return withLock(input.team_name, opts, () => {
    const id = nextNumericId(input.team_name, opts);
    const task: TeamTask = {
      id,
      team_name: input.team_name,
      subject: input.subject,
      description: input.description ?? "",
      owner: typeof input.owner === "string" ? input.owner : "",
      status: "pending",
      version: 1,
    };
    writeTaskFileAtomic(taskFilePath(input.team_name, id, opts), task);
    return task;
  });
}

export function readTask(
  team_name: string,
  task_id: string,
  opts?: TaskOpts,
): TeamTask | null {
  return readTaskFile(taskFilePath(team_name, task_id, opts));
}

export function listTasks(team_name: string, opts?: TaskOpts): TeamTask[] {
  const dir = tasksDir(team_name, opts);
  if (!existsSync(dir)) return [];
  const tasks: TeamTask[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const stem = entry.slice(0, -".json".length);
    const task = readTaskFile(join(dir, entry));
    if (!task) continue;
    if (task.id !== stem) continue;
    tasks.push(task);
  }
  tasks.sort((a, b) => {
    const an = Number(a.id);
    const bn = Number(b.id);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.id.localeCompare(b.id);
  });
  return tasks;
}

export function claimTask(
  team_name: string,
  task_id: string,
  worker: string,
  expected_version: number,
  opts?: TaskOpts,
): { task: TeamTask; claim_token: string } {
  if (!worker || worker.trim() === "") {
    throw new Error("claimTask: worker required");
  }
  return withLock(team_name, opts, () => {
    const path = taskFilePath(team_name, task_id, opts);
    const current = readTaskFile(path);
    if (!current) {
      throw new Error(`TASK_NOT_FOUND: ${team_name}/${task_id}`);
    }
    if (current.version !== expected_version) {
      throw new Error(
        `STALE_VERSION: expected ${expected_version}, found ${current.version}`,
      );
    }
    if (TERMINAL_STATUSES.has(current.status)) {
      throw new Error(`ALREADY_TERMINAL: ${current.status}`);
    }
    if (current.status === "in_progress" || current.status === "claimed") {
      if (current.owner && current.owner !== worker) {
        throw new Error(`CLAIM_CONFLICT: owned by ${current.owner}`);
      }
    }
    const claim_token = randomUUID();
    const updated: TeamTask = {
      ...current,
      owner: worker,
      status: "claimed",
      claim_token,
      version: current.version + 1,
    };
    writeTaskFileAtomic(path, updated);
    return { task: updated, claim_token };
  });
}

export function transitionTaskStatus(
  team_name: string,
  task_id: string,
  from: TaskStatus,
  to: TaskStatus,
  claim_token: string,
  opts?: TaskOpts,
): TeamTask {
  if (!claim_token || claim_token.trim() === "") {
    throw new Error("transitionTaskStatus: claim_token required");
  }
  return withLock(team_name, opts, () => {
    const path = taskFilePath(team_name, task_id, opts);
    const current = readTaskFile(path);
    if (!current) {
      throw new Error(`TASK_NOT_FOUND: ${team_name}/${task_id}`);
    }
    if (current.status !== from) {
      throw new Error(
        `INVALID_TRANSITION: current status is ${current.status}, expected ${from}`,
      );
    }
    if (current.claim_token !== claim_token) {
      throw new Error("CLAIM_TOKEN_MISMATCH");
    }
    const updated: TeamTask = {
      ...current,
      status: to,
      version: current.version + 1,
    };
    if (TERMINAL_STATUSES.has(to)) {
      delete updated.claim_token;
    }
    writeTaskFileAtomic(path, updated);
    return updated;
  });
}

export function releaseClaim(
  team_name: string,
  task_id: string,
  claim_token: string,
  worker: string,
  opts?: TaskOpts,
): TeamTask {
  if (!claim_token || claim_token.trim() === "") {
    throw new Error("releaseClaim: claim_token required");
  }
  return withLock(team_name, opts, () => {
    const path = taskFilePath(team_name, task_id, opts);
    const current = readTaskFile(path);
    if (!current) {
      throw new Error(`TASK_NOT_FOUND: ${team_name}/${task_id}`);
    }
    if (current.claim_token !== claim_token) {
      throw new Error("CLAIM_TOKEN_MISMATCH");
    }
    if (current.owner && worker && current.owner !== worker) {
      throw new Error(`CLAIM_CONFLICT: owned by ${current.owner}`);
    }
    if (TERMINAL_STATUSES.has(current.status)) {
      throw new Error(`ALREADY_TERMINAL: ${current.status}`);
    }
    const updated: TeamTask = {
      ...current,
      owner: "",
      status: "pending",
      version: current.version + 1,
    };
    delete updated.claim_token;
    writeTaskFileAtomic(path, updated);
    return updated;
  });
}

export function updateTask(
  team_name: string,
  task_id: string,
  updates: Partial<TeamTask>,
  opts?: TaskOpts,
): TeamTask {
  return withLock(team_name, opts, () => {
    const path = taskFilePath(team_name, task_id, opts);
    const current = readTaskFile(path);
    if (!current) {
      throw new Error(`TASK_NOT_FOUND: ${team_name}/${task_id}`);
    }
    const merged: TeamTask = {
      ...current,
      ...updates,
      id: current.id,
      team_name: current.team_name,
      version: current.version + 1,
    };
    writeTaskFileAtomic(path, merged);
    return merged;
  });
}
