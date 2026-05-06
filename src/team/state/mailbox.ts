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

export interface MailboxMessage {
  message_id: string;
  team_name: string;
  from_worker: string;
  to_worker?: string;
  body: string;
  sent_at: string;
  notified_at?: string;
  delivered_at?: string;
}

export interface MailboxOpts {
  workingDirectory?: string;
}

export interface ListMailboxOpts extends MailboxOpts {
  includeDelivered?: boolean;
}

export interface SendMessageInput {
  team_name: string;
  from_worker: string;
  to_worker: string;
  body: string;
}

export interface BroadcastInput {
  team_name: string;
  from_worker: string;
  body: string;
}

const STATE_DIR_NAME = ".omghc";
const STATE_SUBDIR = "state";
const MAILBOX_SUBDIR = "mailbox";
const WORKERS_SUBDIR = "workers";

function resolveCwd(opts: MailboxOpts | undefined): string {
  const wd = opts?.workingDirectory;
  return wd && wd.trim().length > 0 ? wd : process.cwd();
}

function teamDir(team_name: string, opts: MailboxOpts | undefined): string {
  return join(
    resolveCwd(opts),
    STATE_DIR_NAME,
    STATE_SUBDIR,
    `team-${team_name}`,
  );
}

function mailboxRoot(team_name: string, opts: MailboxOpts | undefined): string {
  return join(teamDir(team_name, opts), MAILBOX_SUBDIR);
}

function workerMailboxDir(
  team_name: string,
  worker: string,
  opts: MailboxOpts | undefined,
): string {
  return join(mailboxRoot(team_name, opts), worker);
}

function workersDir(team_name: string, opts: MailboxOpts | undefined): string {
  return join(teamDir(team_name, opts), WORKERS_SUBDIR);
}

function ensureWorkerMailboxDir(
  team_name: string,
  worker: string,
  opts: MailboxOpts | undefined,
): string {
  const dir = workerMailboxDir(team_name, worker, opts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function messageFilePath(
  team_name: string,
  worker: string,
  message_id: string,
  opts: MailboxOpts | undefined,
): string {
  return join(workerMailboxDir(team_name, worker, opts), `${message_id}.json`);
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  renameSync(tmp, path);
}

function isMailboxMessage(v: unknown): v is MailboxMessage {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.message_id === "string" &&
    typeof o.team_name === "string" &&
    typeof o.from_worker === "string" &&
    typeof o.body === "string" &&
    typeof o.sent_at === "string"
  );
}

function readMessageFile(path: string): MailboxMessage | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return isMailboxMessage(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function listWorkerNames(
  team_name: string,
  opts: MailboxOpts | undefined,
): string[] {
  const dir = workersDir(team_name, opts);
  if (!existsSync(dir)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(dir)) {
    const child = join(dir, entry);
    try {
      const st = statSync(child);
      if (st.isDirectory()) names.push(entry);
    } catch {
      // skip
    }
  }
  return names;
}

export function sendMessage(
  input: SendMessageInput,
  opts?: MailboxOpts,
): MailboxMessage {
  if (!input.team_name || input.team_name.trim() === "") {
    throw new Error("sendMessage: team_name required");
  }
  if (!input.from_worker || input.from_worker.trim() === "") {
    throw new Error("sendMessage: from_worker required");
  }
  if (!input.to_worker || input.to_worker.trim() === "") {
    throw new Error("sendMessage: to_worker required");
  }
  ensureWorkerMailboxDir(input.team_name, input.to_worker, opts);
  const message: MailboxMessage = {
    message_id: randomUUID(),
    team_name: input.team_name,
    from_worker: input.from_worker,
    to_worker: input.to_worker,
    body: input.body,
    sent_at: new Date().toISOString(),
  };
  const path = messageFilePath(
    input.team_name,
    input.to_worker,
    message.message_id,
    opts,
  );
  writeJsonAtomic(path, message);
  return message;
}

export function broadcast(
  input: BroadcastInput,
  opts?: MailboxOpts,
): MailboxMessage[] {
  if (!input.team_name || input.team_name.trim() === "") {
    throw new Error("broadcast: team_name required");
  }
  if (!input.from_worker || input.from_worker.trim() === "") {
    throw new Error("broadcast: from_worker required");
  }
  const recipients = listWorkerNames(input.team_name, opts).filter(
    (w) => w !== input.from_worker,
  );
  const delivered: MailboxMessage[] = [];
  for (const recipient of recipients) {
    delivered.push(
      sendMessage(
        {
          team_name: input.team_name,
          from_worker: input.from_worker,
          to_worker: recipient,
          body: input.body,
        },
        opts,
      ),
    );
  }
  return delivered;
}

export function listMailbox(
  team_name: string,
  worker: string,
  opts?: ListMailboxOpts,
): MailboxMessage[] {
  const dir = workerMailboxDir(team_name, worker, opts);
  if (!existsSync(dir)) return [];
  const includeDelivered = opts?.includeDelivered ?? false;
  const messages: MailboxMessage[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const stem = entry.slice(0, -".json".length);
    const message = readMessageFile(join(dir, entry));
    if (!message) continue;
    if (message.message_id !== stem) continue;
    if (!includeDelivered && message.delivered_at) continue;
    messages.push(message);
  }
  messages.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  return messages;
}

export function markNotified(
  team_name: string,
  worker: string,
  message_id: string,
  opts?: MailboxOpts,
): MailboxMessage {
  const path = messageFilePath(team_name, worker, message_id, opts);
  const current = readMessageFile(path);
  if (!current) {
    throw new Error(`MESSAGE_NOT_FOUND: ${team_name}/${worker}/${message_id}`);
  }
  const updated: MailboxMessage = {
    ...current,
    notified_at: current.notified_at ?? new Date().toISOString(),
  };
  writeJsonAtomic(path, updated);
  return updated;
}

export function markDelivered(
  team_name: string,
  worker: string,
  message_id: string,
  opts?: MailboxOpts,
): MailboxMessage {
  const path = messageFilePath(team_name, worker, message_id, opts);
  const current = readMessageFile(path);
  if (!current) {
    throw new Error(`MESSAGE_NOT_FOUND: ${team_name}/${worker}/${message_id}`);
  }
  const updated: MailboxMessage = {
    ...current,
    delivered_at: current.delivered_at ?? new Date().toISOString(),
  };
  writeJsonAtomic(path, updated);
  return updated;
}
