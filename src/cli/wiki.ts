import {
  wikiLint,
  wikiList,
  wikiRead,
  wikiRefresh,
  wikiSearch,
  wikiWrite,
} from "../wiki/operations.js";

const HELP = `Usage: omghc wiki <subcommand> [--input <json>] [--json]

Subcommands:
  list      List all wiki pages with metadata.
  read      Read a wiki page. Requires --input '{"slug":"<slug>"}'.
  write     Create/update a page. Requires --input '{"slug","title","body",...}'.
  search    Grep search. Requires --input '{"query":"<text>"[,"limit":N]}'.
  lint      Validate frontmatter on all pages.
  refresh   Walk wiki dir and report total page count.

Examples:
  omghc wiki list --json
  omghc wiki read --input '{"slug":"intro"}'
  omghc wiki write --input '{"slug":"intro","title":"Intro","body":"# Hello"}'
  omghc wiki search --input '{"query":"copilot","limit":5}'
  omghc wiki lint --json
  omghc wiki refresh --json
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

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`input must include a non-empty string \`${key}\` field`);
  }
  return value;
}

function emit(payload: unknown, json: boolean): void {
  const indent = json ? 0 : 2;
  process.stdout.write(`${JSON.stringify(payload, null, indent)}\n`);
}

export async function runWiki(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(rest);
  } catch (error) {
    process.stderr.write(`omghc wiki: ${(error as Error).message}\n`);
    return 2;
  }

  const wd =
    typeof parsed.input.workingDirectory === "string"
      ? (parsed.input.workingDirectory as string)
      : undefined;

  try {
    switch (subcommand) {
      case "list": {
        const data = wikiList({ workingDirectory: wd });
        emit({ ok: true, data }, parsed.json);
        return 0;
      }
      case "read": {
        const slug = requireString(parsed.input, "slug");
        const data = wikiRead(slug, { workingDirectory: wd });
        if (!data) {
          emit({ ok: false, error: "not found" }, parsed.json);
          return 1;
        }
        emit({ ok: true, data }, parsed.json);
        return 0;
      }
      case "write": {
        const slug = requireString(parsed.input, "slug");
        const title = requireString(parsed.input, "title");
        const body = requireString(parsed.input, "body");
        const tags = Array.isArray(parsed.input.tags)
          ? (parsed.input.tags as unknown[]).filter(
              (item): item is string => typeof item === "string",
            )
          : undefined;
        const data = wikiWrite({ slug, title, body, tags, workingDirectory: wd });
        emit({ ok: true, data }, parsed.json);
        return 0;
      }
      case "search": {
        const query = requireString(parsed.input, "query");
        const limit =
          typeof parsed.input.limit === "number" ? (parsed.input.limit as number) : undefined;
        const data = wikiSearch({ query, limit, workingDirectory: wd });
        emit({ ok: true, data }, parsed.json);
        return 0;
      }
      case "lint": {
        const data = wikiLint({ workingDirectory: wd });
        emit({ ok: true, data }, parsed.json);
        return 0;
      }
      case "refresh": {
        const data = wikiRefresh({ workingDirectory: wd });
        emit({ ok: true, data }, parsed.json);
        return 0;
      }
      default:
        process.stderr.write(`omghc wiki: unknown subcommand '${subcommand}'\n${HELP}`);
        return 2;
    }
  } catch (error) {
    process.stderr.write(`omghc wiki: ${(error as Error).message}\n`);
    return 1;
  }
}
