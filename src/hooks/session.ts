/**
 * Session lifecycle hook for oh-my-ghcopilot (OMGHC).
 *
 * Tracks SessionStart / Stop into `.omghc/state/session.json` and an append-only
 * `.omghc/logs/session-history.jsonl` log. Ported from OMX `src/hooks/session.ts`
 * (Yeachan Heo et al., MIT). The OMX implementation also tracks Linux PID
 * identity and HUD reset; that responsibility is deferred to a follow-up
 * because Copilot v1.0.40 does not yet fire hooks. This module focuses on the
 * minimal SessionMetadata contract required by M2b.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export interface SessionMetadata {
  session_id: string;
  started_at: string;
  cwd: string;
  copilot_version?: string;
}

interface SessionFile extends SessionMetadata {
  pid: number;
}

interface SessionEndEntry {
  session_id: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  cwd: string;
  copilot_version?: string;
}

export interface SessionLifecycleOptions {
  workingDirectory?: string;
}

const SESSION_FILE = "session.json";
const HISTORY_FILE = "session-history.jsonl";

function resolveCwd(options?: SessionLifecycleOptions): string {
  const cwd = options?.workingDirectory;
  if (typeof cwd === "string" && cwd.trim().length > 0) return cwd;
  return process.cwd();
}

function omghcStateDir(cwd: string): string {
  return join(cwd, ".omghc", "state");
}

function omghcLogsDir(cwd: string): string {
  return join(cwd, ".omghc", "logs");
}

function sessionPath(cwd: string): string {
  return join(omghcStateDir(cwd), SESSION_FILE);
}

function historyPath(cwd: string): string {
  return join(omghcLogsDir(cwd), HISTORY_FILE);
}

function readSessionFile(cwd: string): SessionFile | null {
  const path = sessionPath(cwd);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SessionFile;
  } catch {
    return null;
  }
}

function writeSessionFile(cwd: string, state: SessionFile): void {
  mkdirSync(omghcStateDir(cwd), { recursive: true });
  writeFileSync(sessionPath(cwd), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Record the start of a session. Returns the persisted metadata. Existing
 * session files are overwritten so a fresh launch always wins.
 */
export function onSessionStart(
  metadata: Partial<SessionMetadata>,
  opts?: SessionLifecycleOptions,
): SessionMetadata {
  const cwd = resolveCwd(opts);
  const sessionId = metadata.session_id?.trim() || randomUUID();
  const startedAt = metadata.started_at?.trim() || new Date().toISOString();
  const recordedCwd = metadata.cwd?.trim() || cwd;
  const copilotVersion =
    typeof metadata.copilot_version === "string" &&
    metadata.copilot_version.trim().length > 0
      ? metadata.copilot_version.trim()
      : undefined;

  const state: SessionFile = {
    session_id: sessionId,
    started_at: startedAt,
    cwd: recordedCwd,
    pid: process.pid,
    ...(copilotVersion ? { copilot_version: copilotVersion } : {}),
  };

  writeSessionFile(cwd, state);

  const out: SessionMetadata = {
    session_id: sessionId,
    started_at: startedAt,
    cwd: recordedCwd,
    ...(copilotVersion ? { copilot_version: copilotVersion } : {}),
  };
  return out;
}

/**
 * Record the end of the active session. Returns null if no session was active.
 * On success, the session file is removed and a JSONL line is appended to the
 * session history log.
 */
export function onSessionEnd(
  opts?: SessionLifecycleOptions,
): { sessionId: string; durationMs: number } | null {
  const cwd = resolveCwd(opts);
  const state = readSessionFile(cwd);
  if (!state) return null;

  const endedAt = new Date();
  const startedAtMs = Date.parse(state.started_at);
  const durationMs = Number.isFinite(startedAtMs)
    ? Math.max(0, endedAt.getTime() - startedAtMs)
    : 0;

  const entry: SessionEndEntry = {
    session_id: state.session_id,
    started_at: state.started_at,
    ended_at: endedAt.toISOString(),
    duration_ms: durationMs,
    cwd: state.cwd,
    ...(state.copilot_version ? { copilot_version: state.copilot_version } : {}),
  };

  mkdirSync(omghcLogsDir(cwd), { recursive: true });
  appendFileSync(historyPath(cwd), `${JSON.stringify(entry)}\n`);

  try {
    unlinkSync(sessionPath(cwd));
  } catch {
    // Already gone — best effort.
  }

  return { sessionId: state.session_id, durationMs };
}

/**
 * Read the currently active session, if any. Returns null when no session
 * file is present or when it is malformed.
 */
export function getCurrentSession(
  opts?: SessionLifecycleOptions,
): SessionMetadata | null {
  const cwd = resolveCwd(opts);
  const state = readSessionFile(cwd);
  if (!state) return null;
  const out: SessionMetadata = {
    session_id: state.session_id,
    started_at: state.started_at,
    cwd: state.cwd,
    ...(state.copilot_version ? { copilot_version: state.copilot_version } : {}),
  };
  return out;
}
