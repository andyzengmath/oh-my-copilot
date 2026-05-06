#!/usr/bin/env node
/**
 * Copilot CLI native hook adapter for oh-my-ghcopilot (OMGHC).
 *
 * Invoked once per hook event by `<gitRoot>/.github/hooks/oh-my-ghcopilot.json`.
 * Reads JSON event payload from stdin, dispatches to the OMGHC plugin runtime,
 * writes JSON response to stdout, and exits.
 *
 * Usage:
 *   node dist/scripts/copilot-native-hook.js <event-name>
 *
 * Where <event-name> is one of:
 *   sessionStart, sessionEnd, userPromptSubmitted,
 *   preToolUse, postToolUse, errorOccurred
 *
 * Forward-compat note: file-based hooks DO NOT FIRE in Copilot CLI v1.0.40
 * (see docs/copilot-native-hooks.md). This adapter is built per-spec so that
 * when the wiring lands in a future release, OMGHC works automatically.
 *
 * Output contract (per docs/copilot-native-hooks.md):
 *   - Only `preToolUse` output is forwarded by the runtime in v1.0.40.
 *   - All other events: stdout is parsed and discarded; useful only for
 *     side effects (state writes, logging, telemetry).
 *
 * SECURITY: never write tokens or secrets to stdout/stderr.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import {
  type ResumeHint,
  type ResumeMode,
  isResumableMode,
  writeHint,
} from "../cli/continue.js";
import { generateOverlay } from "../hooks/agents-overlay.js";
import { detectKeyword } from "../hooks/keyword-detector.js";
import { onSessionEnd, onSessionStart } from "../hooks/session.js";
import {
  type ActiveModeEntry,
  type ModeName,
  type ModeState,
  SUPPORTED_MODES,
  stateListActive,
  stateRead,
  stateWrite,
} from "../state/operations.js";

// --- Event-name dispatch -----------------------------------------------------

const EVENT_NAMES = [
  "sessionStart",
  "sessionEnd",
  "userPromptSubmitted",
  "preToolUse",
  "postToolUse",
  "errorOccurred",
] as const;

type EventName = (typeof EVENT_NAMES)[number];

function isEventName(value: string): value is EventName {
  return (EVENT_NAMES as readonly string[]).includes(value);
}

// --- Stdin schemas (per docs/copilot-native-hooks.md, v1.0.40) ---------------

const SessionStartSchema = z.object({
  timestamp: z.number(),
  cwd: z.string(),
  source: z.enum(["startup", "resume", "new"]).optional(),
  initialPrompt: z.string().optional(),
});

const SessionEndSchema = z.object({
  timestamp: z.number(),
  cwd: z.string(),
  reason: z
    .enum(["complete", "error", "abort", "timeout", "user_exit"])
    .optional(),
});

const UserPromptSubmittedSchema = z.object({
  timestamp: z.number(),
  cwd: z.string(),
  prompt: z.string(),
});

const PreToolUseSchema = z.object({
  timestamp: z.number(),
  cwd: z.string(),
  toolName: z.string(),
  toolArgs: z.unknown(),
});

const PostToolUseSchema = z.object({
  timestamp: z.number(),
  cwd: z.string(),
  toolName: z.string(),
  toolArgs: z.unknown(),
  toolResult: z
    .object({
      resultType: z.string().optional(),
      textResultForLlm: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

const ErrorOccurredSchema = z.object({
  timestamp: z.number(),
  cwd: z.string(),
  error: z
    .object({
      message: z.string().optional(),
      name: z.string().optional(),
      stack: z.string().optional(),
    })
    .passthrough(),
});

// --- Stdin reader ------------------------------------------------------------

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

// --- Logging utilities -------------------------------------------------------

function omghcDir(cwd: string): string {
  return join(cwd, ".omghc");
}

function appendJsonl(filepath: string, payload: unknown): void {
  try {
    mkdirSync(dirname(filepath), { recursive: true });
    appendFileSync(filepath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch (err) {
    process.stderr.write(
      `[copilot-native-hook] log append failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

// --- Pre-tool-use deny logic -------------------------------------------------

interface DenyDecision {
  decision: "allow" | "deny" | "ask";
  reason?: string;
}

const DANGEROUS_BASH_PATTERNS: RegExp[] = [
  /\brm\s+-rf?\s+\/(?:\s|$)/, // rm -rf /
  /\brm\s+-rf?\s+~(?:\/|\s|$)/, // rm -rf ~
  /\bgit\s+push\s+(?:[^|;&]*\s+)?--force\b[^|;&]*\b(?:main|master)\b/, // force push to main/master
  /\bgit\s+push\s+(?:[^|;&]*\s+)?-f\b[^|;&]*\b(?:main|master)\b/, // git push -f to main/master
];

function evaluatePreToolUse(toolName: string, toolArgs: unknown): DenyDecision {
  const command = extractCommand(toolArgs);
  if (typeof command === "string" && command.length > 0) {
    for (const pattern of DANGEROUS_BASH_PATTERNS) {
      if (pattern.test(command)) {
        return {
          decision: "deny",
          reason: `OMGHC blocked dangerous command pattern in tool '${toolName}'`,
        };
      }
    }
  }
  return { decision: "allow" };
}

function extractCommand(toolArgs: unknown): string | null {
  if (!toolArgs || typeof toolArgs !== "object") return null;
  const obj = toolArgs as Record<string, unknown>;
  const candidates = ["command", "cmd", "shell", "bash", "powershell", "script"];
  for (const key of candidates) {
    const value = obj[key];
    if (typeof value === "string") return value;
  }
  return null;
}

// --- Mode activation from keyword detection ----------------------------------

function intentToMode(intent: string): ModeName | null {
  return (SUPPORTED_MODES as readonly string[]).includes(intent)
    ? (intent as ModeName)
    : null;
}

// --- Per-event handlers ------------------------------------------------------

async function handleSessionStart(raw: unknown): Promise<unknown> {
  const event = SessionStartSchema.parse(raw);
  onSessionStart(
    {
      cwd: event.cwd,
      started_at: new Date(event.timestamp).toISOString(),
    },
    { workingDirectory: event.cwd },
  );

  let additionalContext = "";
  try {
    const overlay = generateOverlay({ projectRoot: event.cwd });
    additionalContext = overlay.managedOnly;
  } catch (err) {
    process.stderr.write(
      `[copilot-native-hook] overlay generation failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }

  return { additionalContext };
}

async function handleSessionEnd(raw: unknown): Promise<unknown> {
  const event = SessionEndSchema.parse(raw);
  onSessionEnd({ workingDirectory: event.cwd });

  let hintsWritten = 0;
  try {
    hintsWritten = writeResumeHintsForActiveModes(event.cwd, event.timestamp);
  } catch (err) {
    process.stderr.write(
      `[copilot-native-hook] resume-hint generation failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
  return { ok: true, hintsWritten };
}

/**
 * For every active mode (per state/operations), write a resume hint to
 * `<cwd>/.omghc/state/<mode>-resume-hint.json` so `omghc continue` can pick
 * up where the session left off. Skips modes that are inactive, terminal,
 * or not resumable (skill-active, autoresearch, ultraqa).
 */
function writeResumeHintsForActiveModes(
  cwd: string,
  timestampMs: number,
): number {
  const active: ActiveModeEntry[] = stateListActive({ workingDirectory: cwd });
  const capturedAt = new Date(timestampMs).toISOString();

  let written = 0;
  for (const entry of active) {
    if (!isResumableMode(entry.mode as string)) continue;
    if (isTerminalPhase(entry.current_phase)) continue;

    const fullState = stateRead(entry.mode, { workingDirectory: cwd });
    if (!fullState || fullState.active !== true) continue;

    const hint = buildResumeHint(
      entry.mode as ResumeMode,
      fullState,
      capturedAt,
    );
    if (!hint) continue;

    try {
      writeHint(hint, cwd);
      written++;
    } catch (err) {
      process.stderr.write(
        `[copilot-native-hook] failed to write hint for ${entry.mode}: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }
  return written;
}

function isTerminalPhase(phase?: string): boolean {
  if (!phase) return false;
  const lower = phase.toLowerCase();
  return (
    lower === "completed" ||
    lower === "failed" ||
    lower === "aborted" ||
    lower === "done" ||
    lower === "finished"
  );
}

function teamNameFromState(state: ModeState): string | null {
  const candidate = state.state?.team_name ?? state.state?.name;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return null;
}

function buildResumeHint(
  mode: ResumeMode,
  state: ModeState,
  capturedAt: string,
): ResumeHint | null {
  const sessionId = state._meta?.sessionId ?? "";
  const phase = state.current_phase ?? "unknown";
  const iteration = typeof state.iteration === "number" ? state.iteration : 0;

  let resumeCommand: string;
  let nextAction: string;

  switch (mode) {
    case "team": {
      const teamName = teamNameFromState(state);
      if (!teamName) {
        return null;
      }
      resumeCommand = `omghc team resume ${teamName}`;
      nextAction = `Resume team ${teamName} from ${phase}`;
      break;
    }
    case "ralph": {
      resumeCommand = "omghc ralph";
      nextAction = `Continue ralph iteration ${iteration + 1}`;
      break;
    }
    case "ultrawork": {
      resumeCommand = "omghc ultrawork";
      nextAction = `Continue ultrawork from ${phase}`;
      break;
    }
    case "autopilot": {
      resumeCommand = "omghc autopilot";
      nextAction = `Continue autopilot from ${phase}`;
      break;
    }
    case "ralplan": {
      resumeCommand = "omghc ralplan";
      nextAction = `Continue ralplan from ${phase}`;
      break;
    }
    case "deep-interview": {
      resumeCommand = "omghc deep-interview";
      nextAction = `Continue deep-interview from ${phase}`;
      break;
    }
    default: {
      return null;
    }
  }

  const hint: ResumeHint = {
    mode,
    session_id: sessionId,
    captured_at: capturedAt,
    next_action: nextAction,
    resume_command: resumeCommand,
  };
  if (state.current_phase || typeof state.iteration === "number") {
    const snapshot: Record<string, unknown> = {};
    if (state.current_phase) snapshot.current_phase = state.current_phase;
    if (typeof state.iteration === "number") snapshot.iteration = state.iteration;
    if (state.state) snapshot.state = state.state;
    hint.state_snapshot = snapshot;
  }
  return hint;
}

async function handleUserPromptSubmitted(raw: unknown): Promise<unknown> {
  const event = UserPromptSubmittedSchema.parse(raw);
  const detected = detectKeyword(event.prompt);

  if (detected.intent) {
    const mode = intentToMode(detected.intent);
    if (mode) {
      try {
        stateWrite(
          mode,
          {
            active: true,
            started_at: new Date(event.timestamp).toISOString(),
          },
          { workingDirectory: event.cwd },
        );
      } catch (err) {
        process.stderr.write(
          `[copilot-native-hook] state write failed: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      }
    }
  }

  return { ok: true, detected: detected.intent };
}

async function handlePreToolUse(raw: unknown): Promise<unknown> {
  const event = PreToolUseSchema.parse(raw);
  const decision = evaluatePreToolUse(event.toolName, event.toolArgs);

  appendJsonl(join(omghcDir(event.cwd), "logs", "preuse.jsonl"), {
    timestamp: event.timestamp,
    toolName: event.toolName,
    decision: decision.decision,
  });

  const out: { permissionDecision: "allow" | "deny" | "ask"; permissionDecisionReason?: string } = {
    permissionDecision: decision.decision,
  };
  if (decision.reason) out.permissionDecisionReason = decision.reason;
  return out;
}

async function handlePostToolUse(raw: unknown): Promise<unknown> {
  const event = PostToolUseSchema.parse(raw);

  appendJsonl(join(omghcDir(event.cwd), "logs", "postuse.jsonl"), {
    timestamp: event.timestamp,
    toolName: event.toolName,
    resultType: event.toolResult?.resultType,
  });

  appendJsonl(join(omghcDir(event.cwd), "trace.jsonl"), {
    type: "tool_use",
    timestamp: event.timestamp,
    toolName: event.toolName,
    resultType: event.toolResult?.resultType,
  });

  return { ok: true };
}

async function handleErrorOccurred(raw: unknown): Promise<unknown> {
  const event = ErrorOccurredSchema.parse(raw);

  appendJsonl(join(omghcDir(event.cwd), "logs", "errors.jsonl"), {
    timestamp: event.timestamp,
    name: event.error.name,
    message: event.error.message,
  });

  return { ok: true };
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<number> {
  const eventArg = process.argv[2];
  if (!eventArg || !isEventName(eventArg)) {
    process.stderr.write(
      `Usage: copilot-native-hook <${EVENT_NAMES.join("|")}>\n`,
    );
    return 2;
  }

  const stdin = await readStdin();
  let parsed: unknown;
  try {
    parsed = stdin.trim().length > 0 ? JSON.parse(stdin) : {};
  } catch (err) {
    process.stderr.write(
      `[copilot-native-hook] invalid JSON on stdin: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return 1;
  }

  let response: unknown;
  try {
    switch (eventArg) {
      case "sessionStart":
        response = await handleSessionStart(parsed);
        break;
      case "sessionEnd":
        response = await handleSessionEnd(parsed);
        break;
      case "userPromptSubmitted":
        response = await handleUserPromptSubmitted(parsed);
        break;
      case "preToolUse":
        response = await handlePreToolUse(parsed);
        break;
      case "postToolUse":
        response = await handlePostToolUse(parsed);
        break;
      case "errorOccurred":
        response = await handleErrorOccurred(parsed);
        break;
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      process.stderr.write(
        `[copilot-native-hook] schema validation failed for ${eventArg}: ${err.message}\n`,
      );
      return 1;
    }
    process.stderr.write(
      `[copilot-native-hook] handler error for ${eventArg}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return 1;
  }

  process.stdout.write(`${JSON.stringify(response)}\n`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(
      `[copilot-native-hook] fatal: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    process.exit(1);
  },
);
