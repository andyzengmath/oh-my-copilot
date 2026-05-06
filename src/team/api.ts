import { z } from "zod";
import {
  claimTask,
  createTask,
  listTasks,
  readTask,
  releaseClaim,
  transitionTaskStatus,
  updateTask,
  type TaskStatus,
  type TeamTask,
} from "./state/tasks.js";
import {
  isWorkerAlive,
  listAliveWorkers,
  listWorkerIdentities,
  readWorkerHeartbeat,
  readWorkerIdentity,
  writeWorkerHeartbeat,
  writeWorkerIdentity,
  type WorkerCli,
  type WorkerState,
} from "./state/workers.js";
import {
  broadcast,
  listMailbox,
  markDelivered as mailboxMarkDelivered,
  markNotified as mailboxMarkNotified,
  sendMessage,
} from "./state/mailbox.js";
import {
  createDispatch,
  listDispatches,
  markAcked as dispatchMarkAcked,
  markDelivered as dispatchMarkDelivered,
  markFailed as dispatchMarkFailed,
  readDispatch,
  type DispatchRequest,
} from "./state/dispatch.js";

export const TEAM_API_SCHEMA_VERSION = "1.0";

export const TEAM_API_OPERATIONS = [
  "create-task",
  "read-task",
  "list-tasks",
  "update-task",
  "claim-task",
  "transition-task-status",
  "release-task-claim",
  "write-worker-identity",
  "read-worker-identity",
  "list-worker-identities",
  "write-worker-heartbeat",
  "read-worker-heartbeat",
  "list-alive-workers",
  "send-message",
  "broadcast",
  "mailbox-list",
  "mailbox-mark-notified",
  "mailbox-mark-delivered",
  "dispatch-create",
  "dispatch-read",
  "dispatch-list",
  "dispatch-mark-delivered",
  "dispatch-mark-acked",
  "dispatch-mark-failed",
] as const;

export type TeamApiOperation = (typeof TEAM_API_OPERATIONS)[number];

export type TeamApiEnvelope =
  | {
      schema_version: typeof TEAM_API_SCHEMA_VERSION;
      operation: TeamApiOperation;
      ok: true;
      data: Record<string, unknown>;
    }
  | {
      schema_version: typeof TEAM_API_SCHEMA_VERSION;
      operation: TeamApiOperation | "unknown";
      ok: false;
      error: { code: string; message: string };
    };

const TEAM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const WORKER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const TEAM_NAME = z.string().regex(TEAM_NAME_PATTERN);
const WORKER_NAME = z.string().regex(WORKER_NAME_PATTERN);
const TASK_ID = z.string().regex(TASK_ID_PATTERN);
const WORKING_DIRECTORY = z.string().min(1).optional();

const TASK_STATUS = z.enum([
  "pending",
  "claimed",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
]);

const WORKER_CLI = z.enum(["copilot", "codex", "claude", "gemini"]);
const WORKER_STATE = z.enum(["idle", "busy", "stalled", "dead"]);
const DISPATCH_STATUS = z.enum(["pending", "delivered", "acked", "failed"]);

const CommonOpts = z.object({
  workingDirectory: WORKING_DIRECTORY,
});

const CreateTaskInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  subject: z.string().min(1),
  description: z.string().optional().default(""),
  owner: z.string().optional(),
});

const ReadTaskInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  task_id: TASK_ID,
});

const ListTasksInput = CommonOpts.extend({
  team_name: TEAM_NAME,
});

const UpdateTaskInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  task_id: TASK_ID,
  updates: z.record(z.string(), z.unknown()),
});

const ClaimTaskInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  task_id: TASK_ID,
  worker: WORKER_NAME,
  expected_version: z.number().int().nonnegative(),
});

const TransitionTaskInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  task_id: TASK_ID,
  from: TASK_STATUS,
  to: TASK_STATUS,
  claim_token: z.string().min(1),
});

const ReleaseClaimInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  task_id: TASK_ID,
  claim_token: z.string().min(1),
  worker: WORKER_NAME,
});

const WriteWorkerIdentityInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  name: WORKER_NAME,
  index: z.number().int().nonnegative(),
  role: z.string().min(1),
  pid: z.number().int().positive().optional(),
  cli: WORKER_CLI.optional(),
});

const ReadWorkerIdentityInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  worker: WORKER_NAME,
});

const ListWorkerIdentitiesInput = CommonOpts.extend({
  team_name: TEAM_NAME,
});

const WriteWorkerHeartbeatInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  worker_name: WORKER_NAME,
  pid: z.number().int().positive().optional(),
  last_beat_at: z.string().min(1).optional(),
  turn_count: z.number().int().nonnegative().optional(),
  alive: z.boolean().optional(),
  state: WORKER_STATE.optional(),
  current_task_id: TASK_ID.optional(),
});

const ReadWorkerHeartbeatInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  worker: WORKER_NAME,
  staleThresholdMs: z.number().int().positive().optional(),
});

const ListAliveWorkersInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  staleThresholdMs: z.number().int().positive().optional(),
});

const SendMessageInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  from_worker: WORKER_NAME,
  to_worker: WORKER_NAME,
  body: z.string().min(1),
});

const BroadcastInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  from_worker: WORKER_NAME,
  body: z.string().min(1),
});

const MailboxListInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  worker: WORKER_NAME,
  include_delivered: z.boolean().optional(),
});

const MailboxMarkInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  worker: WORKER_NAME,
  message_id: z.string().min(1),
});

const DispatchCreateInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  task_id: TASK_ID,
  worker: WORKER_NAME,
});

const DispatchReadInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  dispatch_id: z.string().min(1),
});

const DispatchListInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  worker: WORKER_NAME.optional(),
  status: DISPATCH_STATUS.optional(),
});

const DispatchMarkSimpleInput = CommonOpts.extend({
  team_name: TEAM_NAME,
  dispatch_id: z.string().min(1),
});

const DispatchMarkFailedInput = DispatchMarkSimpleInput.extend({
  reason: z.string().min(1),
});

function ok<T extends Record<string, unknown>>(
  operation: TeamApiOperation,
  data: T,
): TeamApiEnvelope {
  return {
    schema_version: TEAM_API_SCHEMA_VERSION,
    operation,
    ok: true,
    data,
  };
}

function fail(
  operation: TeamApiOperation | "unknown",
  code: string,
  message: string,
): TeamApiEnvelope {
  return {
    schema_version: TEAM_API_SCHEMA_VERSION,
    operation,
    ok: false,
    error: { code, message },
  };
}

function classifyError(message: string): string {
  if (message.startsWith("TASK_NOT_FOUND")) return "task_not_found";
  if (message.startsWith("MESSAGE_NOT_FOUND")) return "message_not_found";
  if (message.startsWith("DISPATCH_NOT_FOUND")) return "dispatch_not_found";
  if (message.startsWith("STALE_VERSION")) return "stale_version";
  if (message.startsWith("CLAIM_CONFLICT")) return "claim_conflict";
  if (message.startsWith("CLAIM_TOKEN_MISMATCH")) return "claim_token_mismatch";
  if (message.startsWith("INVALID_TRANSITION")) return "invalid_transition";
  if (message.startsWith("ALREADY_TERMINAL")) return "already_terminal";
  return "operation_failed";
}

export function isTeamApiOperation(
  candidate: string,
): candidate is TeamApiOperation {
  return (TEAM_API_OPERATIONS as readonly string[]).includes(candidate);
}

export async function executeTeamApiOperation(
  operation: string,
  rawInput: unknown,
): Promise<TeamApiEnvelope> {
  if (!isTeamApiOperation(operation)) {
    return fail(
      "unknown",
      "unknown_operation",
      `unknown operation: ${operation}`,
    );
  }

  const input =
    rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
      ? (rawInput as Record<string, unknown>)
      : {};

  try {
    switch (operation) {
      case "create-task": {
        const args = CreateTaskInput.parse(input);
        const task = createTask(
          {
            team_name: args.team_name,
            subject: args.subject,
            description: args.description,
            owner: args.owner,
          },
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, { task });
      }
      case "read-task": {
        const args = ReadTaskInput.parse(input);
        const task = readTask(args.team_name, args.task_id, {
          workingDirectory: args.workingDirectory,
        });
        if (!task) {
          return fail(
            operation,
            "task_not_found",
            `task not found: ${args.team_name}/${args.task_id}`,
          );
        }
        return ok(operation, { task });
      }
      case "list-tasks": {
        const args = ListTasksInput.parse(input);
        const tasks = listTasks(args.team_name, {
          workingDirectory: args.workingDirectory,
        });
        return ok(operation, { count: tasks.length, tasks });
      }
      case "update-task": {
        const args = UpdateTaskInput.parse(input);
        const updates = args.updates as Partial<TeamTask>;
        const task = updateTask(args.team_name, args.task_id, updates, {
          workingDirectory: args.workingDirectory,
        });
        return ok(operation, { task });
      }
      case "claim-task": {
        const args = ClaimTaskInput.parse(input);
        const result = claimTask(
          args.team_name,
          args.task_id,
          args.worker,
          args.expected_version,
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, {
          task: result.task,
          claim_token: result.claim_token,
        });
      }
      case "transition-task-status": {
        const args = TransitionTaskInput.parse(input);
        const task = transitionTaskStatus(
          args.team_name,
          args.task_id,
          args.from as TaskStatus,
          args.to as TaskStatus,
          args.claim_token,
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, { task });
      }
      case "release-task-claim": {
        const args = ReleaseClaimInput.parse(input);
        const task = releaseClaim(
          args.team_name,
          args.task_id,
          args.claim_token,
          args.worker,
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, { task });
      }
      case "write-worker-identity": {
        const args = WriteWorkerIdentityInput.parse(input);
        writeWorkerIdentity(
          {
            name: args.name,
            index: args.index,
            role: args.role,
            team_name: args.team_name,
            pid: args.pid,
            cli: args.cli as WorkerCli | undefined,
          },
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, { worker: args.name });
      }
      case "read-worker-identity": {
        const args = ReadWorkerIdentityInput.parse(input);
        const identity = readWorkerIdentity(args.team_name, args.worker, {
          workingDirectory: args.workingDirectory,
        });
        return ok(operation, { worker: args.worker, identity });
      }
      case "list-worker-identities": {
        const args = ListWorkerIdentitiesInput.parse(input);
        const identities = listWorkerIdentities(args.team_name, {
          workingDirectory: args.workingDirectory,
        });
        return ok(operation, { count: identities.length, identities });
      }
      case "write-worker-heartbeat": {
        const args = WriteWorkerHeartbeatInput.parse(input);
        const heartbeat = writeWorkerHeartbeat(
          {
            worker_name: args.worker_name,
            team_name: args.team_name,
            pid: args.pid,
            last_beat_at: args.last_beat_at,
            turn_count: args.turn_count,
            alive: args.alive,
            state: args.state as WorkerState | undefined,
            current_task_id: args.current_task_id,
          },
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, { heartbeat });
      }
      case "read-worker-heartbeat": {
        const args = ReadWorkerHeartbeatInput.parse(input);
        const heartbeat = readWorkerHeartbeat(args.team_name, args.worker, {
          workingDirectory: args.workingDirectory,
        });
        const alive = isWorkerAlive(heartbeat, {
          staleThresholdMs: args.staleThresholdMs,
        });
        return ok(operation, { worker: args.worker, heartbeat, alive });
      }
      case "list-alive-workers": {
        const args = ListAliveWorkersInput.parse(input);
        const identities = listAliveWorkers(args.team_name, {
          workingDirectory: args.workingDirectory,
          staleThresholdMs: args.staleThresholdMs,
        });
        return ok(operation, { count: identities.length, identities });
      }
      case "send-message": {
        const args = SendMessageInput.parse(input);
        const message = sendMessage(
          {
            team_name: args.team_name,
            from_worker: args.from_worker,
            to_worker: args.to_worker,
            body: args.body,
          },
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, { message });
      }
      case "broadcast": {
        const args = BroadcastInput.parse(input);
        const messages = broadcast(
          {
            team_name: args.team_name,
            from_worker: args.from_worker,
            body: args.body,
          },
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, { count: messages.length, messages });
      }
      case "mailbox-list": {
        const args = MailboxListInput.parse(input);
        const messages = listMailbox(args.team_name, args.worker, {
          workingDirectory: args.workingDirectory,
          includeDelivered: args.include_delivered,
        });
        return ok(operation, {
          worker: args.worker,
          count: messages.length,
          messages,
        });
      }
      case "mailbox-mark-notified": {
        const args = MailboxMarkInput.parse(input);
        const message = mailboxMarkNotified(
          args.team_name,
          args.worker,
          args.message_id,
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, {
          worker: args.worker,
          message_id: args.message_id,
          message,
        });
      }
      case "mailbox-mark-delivered": {
        const args = MailboxMarkInput.parse(input);
        const message = mailboxMarkDelivered(
          args.team_name,
          args.worker,
          args.message_id,
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, {
          worker: args.worker,
          message_id: args.message_id,
          message,
        });
      }
      case "dispatch-create": {
        const args = DispatchCreateInput.parse(input);
        const dispatch = createDispatch(
          {
            team_name: args.team_name,
            task_id: args.task_id,
            worker: args.worker,
          },
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, { dispatch });
      }
      case "dispatch-read": {
        const args = DispatchReadInput.parse(input);
        const dispatch = readDispatch(args.team_name, args.dispatch_id, {
          workingDirectory: args.workingDirectory,
        });
        if (!dispatch) {
          return fail(
            operation,
            "dispatch_not_found",
            `dispatch not found: ${args.team_name}/${args.dispatch_id}`,
          );
        }
        return ok(operation, { dispatch });
      }
      case "dispatch-list": {
        const args = DispatchListInput.parse(input);
        const dispatches = listDispatches(args.team_name, {
          workingDirectory: args.workingDirectory,
          worker: args.worker,
          status: args.status as DispatchRequest["status"] | undefined,
        });
        return ok(operation, { count: dispatches.length, dispatches });
      }
      case "dispatch-mark-delivered": {
        const args = DispatchMarkSimpleInput.parse(input);
        const dispatch = dispatchMarkDelivered(
          args.team_name,
          args.dispatch_id,
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, { dispatch });
      }
      case "dispatch-mark-acked": {
        const args = DispatchMarkSimpleInput.parse(input);
        const dispatch = dispatchMarkAcked(args.team_name, args.dispatch_id, {
          workingDirectory: args.workingDirectory,
        });
        return ok(operation, { dispatch });
      }
      case "dispatch-mark-failed": {
        const args = DispatchMarkFailedInput.parse(input);
        const dispatch = dispatchMarkFailed(
          args.team_name,
          args.dispatch_id,
          args.reason,
          { workingDirectory: args.workingDirectory },
        );
        return ok(operation, { dispatch });
      }
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(
        operation,
        "invalid_input",
        error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; "),
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail(operation, classifyError(message), message);
  }

  return fail(operation, "operation_failed", "no handler returned a result");
}

interface ParsedTeamApiArgs {
  operation: string;
  input: unknown;
  json: boolean;
}

function parseTeamApiArgs(rest: string[]): ParsedTeamApiArgs {
  if (rest.length === 0) {
    throw new Error("operation is required");
  }
  const [operation, ...flags] = rest;
  if (!operation || operation.startsWith("--")) {
    throw new Error("operation is required as the first argument");
  }
  let input: unknown = {};
  let json = false;
  for (let i = 0; i < flags.length; i += 1) {
    const token = flags[i]!;
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--input") {
      const next = flags[i + 1];
      if (typeof next !== "string") {
        throw new Error("--input requires a JSON value");
      }
      input = parseInputJson(next);
      i += 1;
      continue;
    }
    if (token.startsWith("--input=")) {
      input = parseInputJson(token.slice("--input=".length));
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return { operation, input, json };
}

function parseInputJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`--input must be valid JSON: ${(error as Error).message}`);
  }
}

const HELP = `Usage: omghc team api <operation> [--input <json>] [--json]

Operations:
  Tasks:
    create-task, read-task, list-tasks, update-task,
    claim-task, transition-task-status, release-task-claim
  Workers:
    write-worker-identity, read-worker-identity, list-worker-identities,
    write-worker-heartbeat, read-worker-heartbeat, list-alive-workers
  Mailbox:
    send-message, broadcast, mailbox-list,
    mailbox-mark-notified, mailbox-mark-delivered
  Dispatch:
    dispatch-create, dispatch-read, dispatch-list,
    dispatch-mark-delivered, dispatch-mark-acked, dispatch-mark-failed

Output envelope:
  { "schema_version": "1.0", "operation": "<op>", "ok": true,  "data":  {...} }
  { "schema_version": "1.0", "operation": "<op>", "ok": false, "error": { "code": "...", "message": "..." } }

Examples:
  omghc team api create-task --json --input '{"team_name":"alpha","subject":"hello","description":"world"}'
  omghc team api list-tasks  --json --input '{"team_name":"alpha"}'
  omghc team api claim-task  --json --input '{"team_name":"alpha","task_id":"1","worker":"worker-1","expected_version":1}'
`;

function emit(payload: TeamApiEnvelope, json: boolean): void {
  const indent = json ? 0 : 2;
  process.stdout.write(`${JSON.stringify(payload, null, indent)}\n`);
}

export async function runTeamApi(rest: string[]): Promise<number> {
  if (
    rest.length === 0 ||
    rest[0] === "--help" ||
    rest[0] === "-h" ||
    rest[0] === "help"
  ) {
    process.stdout.write(HELP);
    return 0;
  }

  let parsed: ParsedTeamApiArgs;
  try {
    parsed = parseTeamApiArgs(rest);
  } catch (error) {
    process.stderr.write(
      `omghc team api: ${(error as Error).message}\n${HELP}`,
    );
    return 2;
  }

  const envelope = await executeTeamApiOperation(parsed.operation, parsed.input);
  emit(envelope, parsed.json);
  return envelope.ok ? 0 : 1;
}

export async function runTeam(rest: string[]): Promise<number> {
  const [subcommand, ...remaining] = rest;
  if (
    !subcommand ||
    subcommand === "--help" ||
    subcommand === "-h" ||
    subcommand === "help"
  ) {
    process.stdout.write(
      `Usage: omghc team <subcommand>\n\nSubcommands:\n  api  JSON envelope CLI for team state\n\n${HELP}`,
    );
    return 0;
  }
  if (subcommand === "api") {
    return runTeamApi(remaining);
  }
  process.stderr.write(
    `omghc team: unknown subcommand '${subcommand}'. Available: api\n`,
  );
  return 2;
}
