import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  createSession,
  killSession,
  listSession,
  sendKeys,
  splitPane,
  type TeamWorkerCli,
  type TmuxPaneRef,
} from "./tmux-session.js";
import {
  assertAuthAvailable,
  buildBootstrapPlan,
  type BootstrapPlan,
} from "./worker-bootstrap.js";
import {
  cleanupTeamWorktrees,
  createWorkerWorktree,
  type WorktreeInfo,
} from "./worktree.js";
import {
  createTask,
  listTasks,
  type TaskStatus,
} from "./state/tasks.js";
import {
  listAliveWorkers,
  listWorkerIdentities,
  readWorkerHeartbeat,
  writeWorkerIdentity,
  type WorkerHeartbeat,
} from "./state/workers.js";
import { broadcast } from "./state/mailbox.js";
import { createDispatch } from "./state/dispatch.js";

const DEFAULT_STALE_THRESHOLD_MS = 90_000;
const SHUTDOWN_GRACE_MS = 30_000;
const SHUTDOWN_POLL_MS = 1_000;

const TEAM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface OrchestratorOptions {
  team_name: string;
  worker_count: number;
  role: string;
  task_description: string;
  workingDirectory?: string;
  cli?: TeamWorkerCli;
  worktreePerWorker?: boolean;
}

export interface OrchestratorWorker {
  name: string;
  pane_id: string;
  pid?: number;
  worktree?: string;
}

export interface OrchestratorStatus {
  alive: number;
  busy: number;
  idle: number;
  tasks: {
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
  };
}

export interface OrchestratorHandle {
  team_name: string;
  workers: OrchestratorWorker[];
  status(): Promise<OrchestratorStatus>;
  shutdown(opts?: { force?: boolean }): Promise<void>;
}

interface PersistedTeamMeta {
  team_name: string;
  session_name: string;
  cli: TeamWorkerCli;
  role: string;
  workingDirectory: string;
  worktreePerWorker: boolean;
  workers: OrchestratorWorker[];
  created_at: string;
}

function assertTeamName(value: string): void {
  if (!TEAM_NAME_PATTERN.test(value)) {
    throw new Error(`invalid_team_name:${value}`);
  }
}

function resolveCwd(opts: { workingDirectory?: string }): string {
  const wd = opts.workingDirectory;
  return wd && wd.trim().length > 0 ? resolve(wd) : process.cwd();
}

function teamStateDir(team_name: string, cwd: string): string {
  return join(cwd, ".omghc", "state", `team-${team_name}`);
}

function bootstrapDir(team_name: string, cwd: string): string {
  return join(teamStateDir(team_name, cwd), "bootstrap");
}

function metaFilePath(team_name: string, cwd: string): string {
  return join(teamStateDir(team_name, cwd), "team.json");
}

function logDirFor(
  team_name: string,
  worker_name: string,
  cwd: string,
): string {
  return join(teamStateDir(team_name, cwd), "logs", worker_name);
}

function workerName(index: number): string {
  return `worker-${index + 1}`;
}

function writeBootstrapScript(
  team_name: string,
  worker_name: string,
  plan: BootstrapPlan,
  cwd: string,
): string {
  const dir = bootstrapDir(team_name, cwd);
  mkdirSync(dir, { recursive: true });
  const isWindows = process.platform === "win32";
  const ext = isWindows ? "ps1" : "sh";
  const script = isWindows ? plan.scripts.powershell : plan.scripts.bash;
  const path = join(dir, `${worker_name}.${ext}`);
  writeFileSync(path, script, { encoding: "utf-8", mode: 0o755 });
  return path;
}

function bootstrapInvocation(scriptPath: string): string {
  if (process.platform === "win32") {
    return `pwsh -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
  }
  return `bash "${scriptPath}"`;
}

function readMeta(team_name: string, cwd: string): PersistedTeamMeta | null {
  const path = metaFilePath(team_name, cwd);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as PersistedTeamMeta;
    if (
      typeof parsed.team_name !== "string" ||
      typeof parsed.session_name !== "string" ||
      !Array.isArray(parsed.workers)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeMeta(meta: PersistedTeamMeta, cwd: string): void {
  const path = metaFilePath(meta.team_name, cwd);
  mkdirSync(teamStateDir(meta.team_name, cwd), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
  renameSync(tmp, path);
}

function aggregateTaskStatus(
  team_name: string,
  cwd: string,
): OrchestratorStatus["tasks"] {
  const out = { pending: 0, in_progress: 0, completed: 0, failed: 0 };
  const tasks = listTasks(team_name, { workingDirectory: cwd });
  for (const t of tasks) {
    const s: TaskStatus = t.status;
    if (s === "pending" || s === "claimed") out.pending += 1;
    else if (s === "in_progress") out.in_progress += 1;
    else if (s === "completed") out.completed += 1;
    else if (s === "failed" || s === "cancelled") out.failed += 1;
  }
  return out;
}

function classifyWorkerState(beat: WorkerHeartbeat | null): "busy" | "idle" {
  if (!beat) return "idle";
  if (beat.state === "busy") return "busy";
  if (beat.current_task_id && beat.current_task_id.length > 0) return "busy";
  return "idle";
}

async function statusFor(
  team_name: string,
  cwd: string,
): Promise<OrchestratorStatus> {
  const identities = listWorkerIdentities(team_name, {
    workingDirectory: cwd,
  });
  const alive = listAliveWorkers(team_name, {
    workingDirectory: cwd,
    staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
  });
  const aliveSet = new Set(alive.map((w) => w.name));

  let busy = 0;
  let idle = 0;
  for (const id of identities) {
    if (!aliveSet.has(id.name)) continue;
    const beat = readWorkerHeartbeat(team_name, id.name, {
      workingDirectory: cwd,
    });
    if (classifyWorkerState(beat) === "busy") busy += 1;
    else idle += 1;
  }

  return {
    alive: alive.length,
    busy,
    idle,
    tasks: aggregateTaskStatus(team_name, cwd),
  };
}

async function waitForShutdown(
  team_name: string,
  cwd: string,
  graceMs: number,
): Promise<void> {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    const alive = listAliveWorkers(team_name, {
      workingDirectory: cwd,
      staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
    });
    if (alive.length === 0) return;
    await delay(SHUTDOWN_POLL_MS);
  }
}

function buildHandle(
  meta: PersistedTeamMeta,
  cwd: string,
): OrchestratorHandle {
  const team_name = meta.team_name;
  return {
    team_name,
    workers: meta.workers,
    status: () => statusFor(team_name, cwd),
    async shutdown(opts) {
      const force = opts?.force === true;
      try {
        broadcast(
          {
            team_name,
            from_worker: "orchestrator",
            body: JSON.stringify({
              type: "shutdown_request",
              reason: force ? "force_shutdown" : "team_shutdown",
            }),
          },
          { workingDirectory: cwd },
        );
      } catch {
        // ignore broadcast errors during shutdown
      }
      if (!force) {
        await waitForShutdown(team_name, cwd, SHUTDOWN_GRACE_MS);
      }
      try {
        killSession(meta.session_name);
      } catch {
        // ignore — session may already be gone
      }
      if (meta.worktreePerWorker) {
        try {
          cleanupTeamWorktrees(team_name, cwd);
        } catch {
          // ignore — leave worktrees on best-effort failure
        }
      }
    },
  };
}

export async function startOrchestrator(
  opts: OrchestratorOptions,
): Promise<OrchestratorHandle> {
  assertTeamName(opts.team_name);
  if (!Number.isInteger(opts.worker_count) || opts.worker_count <= 0) {
    throw new Error(`invalid_worker_count:${opts.worker_count}`);
  }
  if (!opts.role || opts.role.trim() === "") {
    throw new Error("startOrchestrator: role required");
  }
  if (!opts.task_description || opts.task_description.trim() === "") {
    throw new Error("startOrchestrator: task_description required");
  }

  const cwd = resolveCwd(opts);
  const cli: TeamWorkerCli = opts.cli ?? "copilot";
  const worktreePerWorker = opts.worktreePerWorker === true;
  const sessionName = `omghc-${opts.team_name}`;

  const existingMeta = readMeta(opts.team_name, cwd);
  if (existingMeta) {
    throw new Error(`team_already_exists:${opts.team_name}`);
  }

  // Pre-flight: build first plan to validate auth before tmux side effects.
  const probePlan = buildBootstrapPlan({
    cli,
    team_name: opts.team_name,
    worker_name: workerName(0),
    worker_role: opts.role,
    cwd,
    prompt: opts.task_description,
  });
  assertAuthAvailable(probePlan);

  const session = createSession(sessionName, { detach: true, cwd });
  const initialPane: TmuxPaneRef | undefined = session.panes[0];
  if (!initialPane) {
    killSession(sessionName);
    throw new Error(`session_no_initial_pane:${sessionName}`);
  }

  const workers: OrchestratorWorker[] = [];

  try {
    for (let i = 0; i < opts.worker_count; i += 1) {
      const name = workerName(i);

      let workerCwd = cwd;
      let worktree: WorktreeInfo | undefined;
      if (worktreePerWorker) {
        worktree = createWorkerWorktree(opts.team_name, name, cwd);
        workerCwd = worktree.path;
      }

      const plan = buildBootstrapPlan({
        cli,
        team_name: opts.team_name,
        worker_name: name,
        worker_role: opts.role,
        cwd: workerCwd,
        prompt: opts.task_description,
        log_dir: logDirFor(opts.team_name, name, cwd),
      });
      assertAuthAvailable(plan);

      const scriptPath = writeBootstrapScript(
        opts.team_name,
        name,
        plan,
        cwd,
      );

      const pane_id =
        i === 0
          ? initialPane.pane_id
          : splitPane(sessionName, { vertical: false, cwd: workerCwd }).pane_id;

      writeWorkerIdentity(
        {
          name,
          index: i,
          role: opts.role,
          team_name: opts.team_name,
          cli,
        },
        { workingDirectory: cwd },
      );

      const task = createTask(
        {
          team_name: opts.team_name,
          subject: `${opts.role} initial task for ${name}`,
          description: opts.task_description,
        },
        { workingDirectory: cwd },
      );
      createDispatch(
        {
          team_name: opts.team_name,
          task_id: task.id,
          worker: name,
        },
        { workingDirectory: cwd },
      );

      sendKeys(pane_id, bootstrapInvocation(scriptPath), { submit: true });

      workers.push({
        name,
        pane_id,
        worktree: worktree?.path,
      });
    }
  } catch (err) {
    try {
      killSession(sessionName);
    } catch {
      // ignore
    }
    if (worktreePerWorker) {
      try {
        cleanupTeamWorktrees(opts.team_name, cwd);
      } catch {
        // ignore
      }
    }
    throw err;
  }

  const meta: PersistedTeamMeta = {
    team_name: opts.team_name,
    session_name: sessionName,
    cli,
    role: opts.role,
    workingDirectory: cwd,
    worktreePerWorker,
    workers,
    created_at: new Date().toISOString(),
  };
  writeMeta(meta, cwd);

  return buildHandle(meta, cwd);
}

export async function resumeOrchestrator(
  team_name: string,
  opts: { workingDirectory?: string } = {},
): Promise<OrchestratorHandle> {
  assertTeamName(team_name);
  const cwd = resolveCwd(opts);
  const meta = readMeta(team_name, cwd);
  if (!meta) {
    throw new Error(`team_not_found:${team_name}`);
  }
  const session = listSession(meta.session_name);
  if (!session) {
    throw new Error(`session_missing:${meta.session_name}`);
  }
  return buildHandle(meta, cwd);
}
