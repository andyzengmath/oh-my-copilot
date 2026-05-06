import {
  type ModeName,
  SUPPORTED_MODES,
  stateClear,
  stateGetStatus,
  stateListActive,
  stateRead,
  stateWrite,
} from "../state/operations.js";

const HELP = `Usage: omghc state <subcommand> [--input <json>] [--json]

Subcommands:
  read         Read state for a mode. Requires --input '{"mode":"<mode>"}'.
  write        Write/merge state. Requires --input '{"mode":"<mode>", ...}'.
  clear        Clear state. Requires --input '{"mode":"<mode>"}'.
  list-active  List all modes whose state has active=true.
  get-status   Snapshot for a mode. Requires --input '{"mode":"<mode>"}'.

Examples:
  omghc state read --input '{"mode":"ralph"}'
  omghc state write --input '{"mode":"ralph","active":true,"current_phase":"executing"}'
  omghc state clear --input '{"mode":"team"}'
  omghc state list-active --json
  omghc state get-status --input '{"mode":"autopilot"}'
`;

interface ParsedArgs {
  input: Record<string, unknown>;
  json: boolean;
}

function parseArgs(rest: string[]): ParsedArgs {
  const parsed: ParsedArgs = { input: {}, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--input") {
      const next = rest[i + 1];
      if (typeof next !== "string") {
        throw new Error("--input requires a JSON value");
      }
      parsed.input = parseInputJson(next);
      i += 1;
      continue;
    }
    if (token.startsWith("--input=")) {
      parsed.input = parseInputJson(token.slice("--input=".length));
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return parsed;
}

function parseInputJson(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`--input must be valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--input must decode to a JSON object");
  }
  return { ...(parsed as Record<string, unknown>) };
}

function requireMode(input: Record<string, unknown>): ModeName {
  const mode = input.mode;
  if (typeof mode !== "string") {
    throw new Error("input must include a string `mode` field");
  }
  if (!SUPPORTED_MODES.includes(mode as ModeName)) {
    throw new Error(
      `unknown mode '${mode}'. Supported: ${SUPPORTED_MODES.join(", ")}`,
    );
  }
  return mode as ModeName;
}

function emit(payload: unknown, json: boolean): void {
  const indent = json ? 0 : 2;
  process.stdout.write(`${JSON.stringify(payload, null, indent)}\n`);
}

export async function runState(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(rest);
  } catch (error) {
    process.stderr.write(`omghc state: ${(error as Error).message}\n`);
    return 2;
  }

  const wd =
    typeof parsed.input.workingDirectory === "string"
      ? (parsed.input.workingDirectory as string)
      : undefined;

  try {
    switch (subcommand) {
      case "read": {
        const mode = requireMode(parsed.input);
        const data = stateRead(mode, { workingDirectory: wd });
        emit({ ok: true, data }, parsed.json);
        return 0;
      }
      case "write": {
        const mode = requireMode(parsed.input);
        const { mode: _mode, workingDirectory: _wd, ...partial } = parsed.input;
        const data = stateWrite(mode, partial, { workingDirectory: wd });
        emit({ ok: true, data }, parsed.json);
        return 0;
      }
      case "clear": {
        const mode = requireMode(parsed.input);
        stateClear(mode, { workingDirectory: wd });
        emit({ ok: true }, parsed.json);
        return 0;
      }
      case "list-active": {
        const data = stateListActive({ workingDirectory: wd });
        emit({ ok: true, data }, parsed.json);
        return 0;
      }
      case "get-status": {
        const mode = requireMode(parsed.input);
        const data = stateGetStatus(mode, { workingDirectory: wd });
        emit({ ok: true, data }, parsed.json);
        return 0;
      }
      default:
        process.stderr.write(`omghc state: unknown subcommand '${subcommand}'\n${HELP}`);
        return 2;
    }
  } catch (error) {
    process.stderr.write(`omghc state: ${(error as Error).message}\n`);
    return 1;
  }
}
