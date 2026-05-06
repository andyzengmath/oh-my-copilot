import {
  readHudSnapshot,
  renderHudJson,
  renderHudTable,
  watchHud,
} from "../hud/index.js";
import { launchHudInTmux } from "../hud/tmux.js";

const HELP = `Usage: omghc hud --team <name> [--watch] [--json] [--tmux] [--refresh <ms>]

Options:
  --team <name>     Team name (required).
  --watch           Refresh every 5s; Ctrl+C to exit.
  --json            Emit JSON instead of a table.
  --tmux            Launch HUD in a tmux pane (falls back to stdout if tmux missing).
  --refresh <ms>    Override watch refresh interval (default 5000).
  --working-directory <path>
                    Override repo root (defaults to cwd).
  --help, -h        Show this help.

Examples:
  omghc hud --team alpha
  omghc hud --team alpha --watch
  omghc hud --team alpha --json
  omghc hud --tmux --team alpha
`;

interface ParsedArgs {
  team: string | null;
  watch: boolean;
  json: boolean;
  tmux: boolean;
  refreshMs: number | null;
  workingDirectory: string | null;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = {
    team: null,
    watch: false,
    json: false,
    tmux: false,
    refreshMs: null,
    workingDirectory: null,
    help: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]!;
    if (token === "--help" || token === "-h" || token === "help") {
      out.help = true;
      continue;
    }
    if (token === "--watch") {
      out.watch = true;
      continue;
    }
    if (token === "--json") {
      out.json = true;
      continue;
    }
    if (token === "--tmux") {
      out.tmux = true;
      continue;
    }
    if (token === "--team") {
      const next = args[i + 1];
      if (typeof next !== "string") throw new Error("--team requires a value");
      out.team = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--team=")) {
      out.team = token.slice("--team=".length);
      continue;
    }
    if (token === "--refresh") {
      const next = args[i + 1];
      if (typeof next !== "string") throw new Error("--refresh requires a value");
      out.refreshMs = parseRefresh(next);
      i += 1;
      continue;
    }
    if (token.startsWith("--refresh=")) {
      out.refreshMs = parseRefresh(token.slice("--refresh=".length));
      continue;
    }
    if (token === "--working-directory") {
      const next = args[i + 1];
      if (typeof next !== "string")
        throw new Error("--working-directory requires a value");
      out.workingDirectory = next;
      i += 1;
      continue;
    }
    if (token.startsWith("--working-directory=")) {
      out.workingDirectory = token.slice("--working-directory=".length);
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return out;
}

function parseRefresh(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--refresh must be a positive number of ms (got '${raw}')`);
  }
  return Math.floor(n);
}

function resolveOmghcBin(): string {
  return process.env.OMGHC_BIN ?? "omghc";
}

export async function runHud(args: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    process.stderr.write(`omghc hud: ${(error as Error).message}\n${HELP}`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (!parsed.team) {
    process.stderr.write(`omghc hud: --team <name> is required\n${HELP}`);
    return 2;
  }

  const wd = parsed.workingDirectory ?? undefined;

  if (parsed.tmux) {
    const result = launchHudInTmux(parsed.team, resolveOmghcBin());
    if (result.ok) {
      process.stdout.write(`omghc hud: launched in tmux for team '${parsed.team}'\n`);
      return 0;
    }
    process.stderr.write(`omghc hud: ${result.message ?? "tmux launch failed"}\n`);
    // fall through to stdout rendering
  }

  if (parsed.watch) {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      await watchHud({
        team_name: parsed.team,
        refreshMs: parsed.refreshMs ?? undefined,
        json: parsed.json,
        workingDirectory: wd,
        signal: controller.signal,
      });
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
    return 0;
  }

  const snapshot = readHudSnapshot(parsed.team, { workingDirectory: wd });
  if (parsed.json) {
    process.stdout.write(renderHudJson(snapshot));
    return snapshot.found ? 0 : 1;
  }
  process.stdout.write(renderHudTable(snapshot));
  return snapshot.found ? 0 : 1;
}
