import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";

import {
  resumeOrchestrator,
  startOrchestrator,
  type OrchestratorHandle,
  type OrchestratorOptions,
  type OrchestratorStatus,
} from "./orchestrator.js";
import {
  createPhaseController,
  type PhaseController,
  type PhaseEvent,
  type TeamPhase,
} from "./phase-controller.js";
import {
  createRoleRouter,
  type RoleRouter,
  type WorkerSlot,
} from "./role-router.js";
import {
  listWorkerIdentities,
  type WorkerIdentity,
} from "./state/workers.js";
import { listTasks } from "./state/tasks.js";
import { executeTeamApiOperation } from "./api.js";
import type { TeamWorkerCli } from "./tmux-session.js";

const DEFAULT_MAX_FIX_LOOPS = 3;
const DEFAULT_ITERATION_CADENCE_MS = 5_000;
const DEFAULT_TERMINAL_TIMEOUT_MS = 30 * 60 * 1_000;
const TEAM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface RuntimeOptions {
  team_name: string;
  worker_count: number;
  role: string;
  task_description: string;
  workingDirectory?: string;
  cli?: TeamWorkerCli;
  maxFixLoops?: number;
  iterationCadenceMs?: number;
  worktreePerWorker?: boolean;
}

export interface RuntimeResult {
  team_name: string;
  finalPhase: TeamPhase;
  iterations: number;
  tasksCompleted: number;
  tasksFailed: number;
  durationMs: number;
}

interface VerifySnapshot {
  completed: number;
  failed: number;
  total: number;
}

interface ResolvedRuntimeOptions {
  team_name: string;
  worker_count: number;
  role: string;
  task_description: string;
  cwd: string;
  cli: TeamWorkerCli;
  maxFixLoops: number;
  iterationCadenceMs: number;
  worktreePerWorker: boolean;
}

function assertTeamName(value: string): void {
  if (!TEAM_NAME_PATTERN.test(value)) {
    throw new Error(`invalid_team_name:${value}`);
  }
}

function resolveCwd(workingDirectory?: string): string {
  return workingDirectory && workingDirectory.trim().length > 0
    ? resolve(workingDirectory)
    : process.cwd();
}

function resolveOptions(opts: RuntimeOptions): ResolvedRuntimeOptions {
  assertTeamName(opts.team_name);
  if (!Number.isInteger(opts.worker_count) || opts.worker_count <= 0) {
    throw new Error(`invalid_worker_count:${opts.worker_count}`);
  }
  if (!opts.role || opts.role.trim() === "") {
    throw new Error("runTeamRuntime: role required");
  }
  if (!opts.task_description || opts.task_description.trim() === "") {
    throw new Error("runTeamRuntime: task_description required");
  }
  return {
    team_name: opts.team_name,
    worker_count: opts.worker_count,
    role: opts.role,
    task_description: opts.task_description,
    cwd: resolveCwd(opts.workingDirectory),
    cli: opts.cli ?? "copilot",
    maxFixLoops:
      typeof opts.maxFixLoops === "number" && opts.maxFixLoops >= 0
        ? opts.maxFixLoops
        : DEFAULT_MAX_FIX_LOOPS,
    iterationCadenceMs:
      typeof opts.iterationCadenceMs === "number" &&
      opts.iterationCadenceMs > 0
        ? opts.iterationCadenceMs
        : DEFAULT_ITERATION_CADENCE_MS,
    worktreePerWorker: opts.worktreePerWorker === true,
  };
}

function identitiesToSlots(identities: WorkerIdentity[]): WorkerSlot[] {
  return identities.map((id) => ({
    name: id.name,
    role: id.role,
    busy: false,
    taskCount: 0,
  }));
}

async function getSummary(
  team_name: string,
  cwd: string,
): Promise<Record<string, unknown> | null> {
  const envelope = await executeTeamApiOperation("list-tasks", {
    team_name,
    workingDirectory: cwd,
  });
  if (!envelope.ok) return null;
  return envelope.data;
}

function snapshotTasks(team_name: string, cwd: string): VerifySnapshot {
  const tasks = listTasks(team_name, { workingDirectory: cwd });
  let completed = 0;
  let failed = 0;
  for (const t of tasks) {
    if (t.status === "completed") completed += 1;
    else if (t.status === "failed" || t.status === "cancelled") failed += 1;
  }
  return { completed, failed, total: tasks.length };
}

function allTerminal(status: OrchestratorStatus): boolean {
  return status.tasks.pending === 0 && status.tasks.in_progress === 0;
}

interface VerifyOutcome {
  pass: boolean;
  reason: string;
  snapshot: VerifySnapshot;
}

function runVerifyGate(
  prev: VerifySnapshot | null,
  current: VerifySnapshot,
): VerifyOutcome {
  if (current.total === 0) {
    return {
      pass: false,
      reason: "verify_no_tasks",
      snapshot: current,
    };
  }
  if (current.failed > 0) {
    return {
      pass: false,
      reason: `verify_failed_tasks:${current.failed}`,
      snapshot: current,
    };
  }
  if (prev && current.completed < prev.completed) {
    return {
      pass: false,
      reason: `verify_regression:${prev.completed}->${current.completed}`,
      snapshot: current,
    };
  }
  if (current.completed === 0) {
    return {
      pass: false,
      reason: "verify_no_completions",
      snapshot: current,
    };
  }
  return {
    pass: true,
    reason: "verify_ok",
    snapshot: current,
  };
}

function recordPhaseLog(
  team_name: string,
  event: PhaseEvent,
): void {
  const reason = event.reason ? ` reason=${event.reason}` : "";
  process.stderr.write(
    `[omghc-runtime] team=${team_name} phase: ${event.from} -> ${event.to}${reason}\n`,
  );
}

function refreshRouterFromState(
  router: RoleRouter,
  team_name: string,
  cwd: string,
): void {
  const identities = listWorkerIdentities(team_name, {
    workingDirectory: cwd,
  });
  router.refreshWorkers(identitiesToSlots(identities));
}

interface RuntimeLoopContext {
  options: ResolvedRuntimeOptions;
  orchestrator: OrchestratorHandle;
  phase: PhaseController;
  router: RoleRouter;
  startedAt: number;
}

async function runMainLoop(
  ctx: RuntimeLoopContext,
): Promise<RuntimeResult> {
  const { options, orchestrator, phase, router } = ctx;
  let iterations = 0;
  let lastVerify: VerifySnapshot | null = null;
  const lastTransitionAt = { time: Date.now() };

  const offPhase = phase.onPhaseChange((event) => {
    recordPhaseLog(options.team_name, event);
    lastTransitionAt.time = Date.now();
  });

  try {
    if (phase.getCurrentPhase() === "team-plan") {
      phase.transitionPhase("team-exec", "initial_dispatch");
    }

    while (true) {
      iterations += 1;
      const current = phase.getCurrentPhase();

      if (current === "team-done" || current === "team-failed") {
        break;
      }

      if (Date.now() - lastTransitionAt.time > DEFAULT_TERMINAL_TIMEOUT_MS) {
        try {
          phase.transitionPhase(
            "team-failed",
            "terminal_timeout_no_progress",
          );
        } catch {
          // already in a terminal-incompatible state; break out
          break;
        }
        break;
      }

      const status = await orchestrator.status();
      refreshRouterFromState(router, options.team_name, options.cwd);
      await getSummary(options.team_name, options.cwd);

      if (current === "team-exec") {
        if (allTerminal(status)) {
          try {
            phase.transitionPhase("team-verify", "all_tasks_terminal");
          } catch {
            break;
          }
        } else {
          await delay(options.iterationCadenceMs);
        }
        continue;
      }

      if (current === "team-verify") {
        const snapshot = snapshotTasks(options.team_name, options.cwd);
        const verdict = runVerifyGate(lastVerify, snapshot);
        lastVerify = snapshot;

        if (verdict.pass) {
          try {
            phase.transitionPhase("team-done", verdict.reason);
          } catch {
            break;
          }
          break;
        }

        if (phase.getFixLoopCount() >= options.maxFixLoops) {
          try {
            phase.transitionPhase("team-failed", "max_fix_loops_exceeded");
          } catch {
            // ignore
          }
          break;
        }

        try {
          phase.transitionPhase("team-fix", verdict.reason);
        } catch {
          break;
        }
        continue;
      }

      if (current === "team-fix") {
        try {
          phase.transitionPhase("team-exec", "resume_after_fix");
        } catch {
          break;
        }
        continue;
      }

      if (current === "team-prd") {
        try {
          phase.transitionPhase("team-exec", "skip_prd_in_v0");
        } catch {
          break;
        }
        continue;
      }

      // Unknown / unhandled phase: exit defensively.
      break;
    }
  } finally {
    offPhase();
  }

  const finalSnapshot = snapshotTasks(options.team_name, options.cwd);
  return {
    team_name: options.team_name,
    finalPhase: phase.getCurrentPhase(),
    iterations,
    tasksCompleted: finalSnapshot.completed,
    tasksFailed: finalSnapshot.failed,
    durationMs: Date.now() - ctx.startedAt,
  };
}

export async function runTeamRuntime(
  opts: RuntimeOptions,
): Promise<RuntimeResult> {
  const options = resolveOptions(opts);
  const startedAt = Date.now();

  const orchestratorOpts: OrchestratorOptions = {
    team_name: options.team_name,
    worker_count: options.worker_count,
    role: options.role,
    task_description: options.task_description,
    workingDirectory: options.cwd,
    cli: options.cli,
    worktreePerWorker: options.worktreePerWorker,
  };

  const orchestrator = await startOrchestrator(orchestratorOpts);
  const phase = createPhaseController({
    team_name: options.team_name,
    workingDirectory: options.cwd,
    initialPhase: "team-plan",
    maxFixLoops: options.maxFixLoops,
  });
  const identities = listWorkerIdentities(options.team_name, {
    workingDirectory: options.cwd,
  });
  const router = createRoleRouter({
    workers: identitiesToSlots(identities),
  });

  try {
    return await runMainLoop({
      options,
      orchestrator,
      phase,
      router,
      startedAt,
    });
  } finally {
    try {
      await orchestrator.shutdown();
    } catch {
      // shutdown best-effort; runtime result still returned
    }
  }
}

export async function resumeTeamRuntime(
  team_name: string,
  opts: { workingDirectory?: string } = {},
): Promise<RuntimeResult> {
  assertTeamName(team_name);
  const cwd = resolveCwd(opts.workingDirectory);
  const startedAt = Date.now();

  const orchestrator = await resumeOrchestrator(team_name, {
    workingDirectory: cwd,
  });

  const phase = createPhaseController({
    team_name,
    workingDirectory: cwd,
  });

  const identities = listWorkerIdentities(team_name, {
    workingDirectory: cwd,
  });
  const router = createRoleRouter({
    workers: identitiesToSlots(identities),
  });

  const resolved: ResolvedRuntimeOptions = {
    team_name,
    worker_count: identities.length || 1,
    role: identities[0]?.role ?? "executor",
    task_description: "(resumed)",
    cwd,
    cli: (identities[0]?.cli as TeamWorkerCli | undefined) ?? "copilot",
    maxFixLoops: DEFAULT_MAX_FIX_LOOPS,
    iterationCadenceMs: DEFAULT_ITERATION_CADENCE_MS,
    worktreePerWorker: false,
  };

  try {
    return await runMainLoop({
      options: resolved,
      orchestrator,
      phase,
      router,
      startedAt,
    });
  } finally {
    try {
      await orchestrator.shutdown();
    } catch {
      // best-effort
    }
  }
}
