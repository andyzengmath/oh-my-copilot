import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface DispatchRequest {
  id: string;
  team_name: string;
  task_id: string;
  worker: string;
  status: "pending" | "delivered" | "acked" | "failed";
  created_at: string;
  delivered_at?: string;
  acked_at?: string;
  reason?: string;
}

export interface DispatchOpts {
  workingDirectory?: string;
}

export interface ListDispatchOpts extends DispatchOpts {
  worker?: string;
  status?: DispatchRequest["status"];
}

export interface CreateDispatchInput {
  team_name: string;
  task_id: string;
  worker: string;
}

const STATE_DIR_NAME = ".omghc";
const STATE_SUBDIR = "state";
const DISPATCH_SUBDIR = "dispatch";

function resolveCwd(opts: DispatchOpts | undefined): string {
  const wd = opts?.workingDirectory;
  return wd && wd.trim().length > 0 ? wd : process.cwd();
}

function dispatchDir(
  team_name: string,
  opts: DispatchOpts | undefined,
): string {
  return join(
    resolveCwd(opts),
    STATE_DIR_NAME,
    STATE_SUBDIR,
    `team-${team_name}`,
    DISPATCH_SUBDIR,
  );
}

function ensureDispatchDir(
  team_name: string,
  opts: DispatchOpts | undefined,
): string {
  const dir = dispatchDir(team_name, opts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function dispatchFilePath(
  team_name: string,
  dispatch_id: string,
  opts: DispatchOpts | undefined,
): string {
  return join(dispatchDir(team_name, opts), `${dispatch_id}.json`);
}

function readDispatchFile(path: string): DispatchRequest | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as DispatchRequest;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.team_name !== "string" ||
      typeof parsed.task_id !== "string" ||
      typeof parsed.worker !== "string" ||
      typeof parsed.status !== "string" ||
      typeof parsed.created_at !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeDispatchAtomic(path: string, record: DispatchRequest): void {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  renameSync(tmp, path);
}

export function createDispatch(
  input: CreateDispatchInput,
  opts?: DispatchOpts,
): DispatchRequest {
  if (!input.team_name || input.team_name.trim() === "") {
    throw new Error("createDispatch: team_name required");
  }
  if (!input.task_id || input.task_id.trim() === "") {
    throw new Error("createDispatch: task_id required");
  }
  if (!input.worker || input.worker.trim() === "") {
    throw new Error("createDispatch: worker required");
  }
  ensureDispatchDir(input.team_name, opts);
  const id = randomUUID();
  const record: DispatchRequest = {
    id,
    team_name: input.team_name,
    task_id: input.task_id,
    worker: input.worker,
    status: "pending",
    created_at: new Date().toISOString(),
  };
  writeDispatchAtomic(dispatchFilePath(input.team_name, id, opts), record);
  return record;
}

export function readDispatch(
  team_name: string,
  dispatch_id: string,
  opts?: DispatchOpts,
): DispatchRequest | null {
  return readDispatchFile(dispatchFilePath(team_name, dispatch_id, opts));
}

export function listDispatches(
  team_name: string,
  opts?: ListDispatchOpts,
): DispatchRequest[] {
  const dir = dispatchDir(team_name, opts);
  if (!existsSync(dir)) return [];
  const records: DispatchRequest[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const stem = entry.slice(0, -".json".length);
    const record = readDispatchFile(join(dir, entry));
    if (!record) continue;
    if (record.id !== stem) continue;
    if (opts?.worker && record.worker !== opts.worker) continue;
    if (opts?.status && record.status !== opts.status) continue;
    records.push(record);
  }
  records.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return records;
}

function transitionStatus(
  team_name: string,
  dispatch_id: string,
  to: DispatchRequest["status"],
  opts: DispatchOpts | undefined,
  patch: Partial<DispatchRequest> = {},
): DispatchRequest {
  const path = dispatchFilePath(team_name, dispatch_id, opts);
  const current = readDispatchFile(path);
  if (!current) {
    throw new Error(`DISPATCH_NOT_FOUND: ${team_name}/${dispatch_id}`);
  }
  if (current.status === to) {
    return current;
  }
  const updated: DispatchRequest = {
    ...current,
    ...patch,
    status: to,
  };
  writeDispatchAtomic(path, updated);
  return updated;
}

export function markDelivered(
  team_name: string,
  dispatch_id: string,
  opts?: DispatchOpts,
): DispatchRequest {
  return transitionStatus(team_name, dispatch_id, "delivered", opts, {
    delivered_at: new Date().toISOString(),
  });
}

export function markAcked(
  team_name: string,
  dispatch_id: string,
  opts?: DispatchOpts,
): DispatchRequest {
  return transitionStatus(team_name, dispatch_id, "acked", opts, {
    acked_at: new Date().toISOString(),
  });
}

export function markFailed(
  team_name: string,
  dispatch_id: string,
  reason: string,
  opts?: DispatchOpts,
): DispatchRequest {
  return transitionStatus(team_name, dispatch_id, "failed", opts, {
    reason,
  });
}
