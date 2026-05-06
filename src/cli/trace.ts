import { traceSummary, traceTimeline } from "../mcp/trace-server.js";

const HELP = `Usage: omghc trace <subcommand> [--input <json>] [--json]

Subcommands:
  summary     Aggregate trace event counts.
  timeline    Recent events (most recent first).

Options (in --input JSON):
  workingDirectory  string
  since             ISO8601 lower bound
  until             ISO8601 upper bound
  limit             positive number (timeline only; default 100, max 1000)
  eventFilter       exact event-type match (timeline only)

Examples:
  omghc trace summary --json
  omghc trace timeline --input '{"limit":20,"eventFilter":"hook.preToolUse"}'
  omghc trace summary --input '{"since":"2026-05-05T00:00:00Z"}'
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

function emit(payload: unknown, json: boolean): void {
  const indent = json ? 0 : 2;
  process.stdout.write(`${JSON.stringify(payload, null, indent)}\n`);
}

export async function runTrace(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(rest);
  } catch (error) {
    process.stderr.write(`omghc trace: ${(error as Error).message}\n`);
    return 2;
  }

  const wd =
    typeof parsed.input.workingDirectory === "string"
      ? (parsed.input.workingDirectory as string)
      : undefined;
  const since =
    typeof parsed.input.since === "string" ? (parsed.input.since as string) : undefined;
  const until =
    typeof parsed.input.until === "string" ? (parsed.input.until as string) : undefined;

  switch (subcommand) {
    case "summary": {
      const result = await traceSummary({ workingDirectory: wd, since, until });
      emit(result, parsed.json);
      return result.ok ? 0 : 1;
    }
    case "timeline": {
      const limit =
        typeof parsed.input.limit === "number" ? (parsed.input.limit as number) : undefined;
      const eventFilter =
        typeof parsed.input.eventFilter === "string"
          ? (parsed.input.eventFilter as string)
          : undefined;
      const result = await traceTimeline({
        workingDirectory: wd,
        since,
        until,
        limit,
        eventFilter,
      });
      emit(result, parsed.json);
      return result.ok ? 0 : 1;
    }
    default:
      process.stderr.write(`omghc trace: unknown subcommand '${subcommand}'\n${HELP}`);
      return 2;
  }
}
