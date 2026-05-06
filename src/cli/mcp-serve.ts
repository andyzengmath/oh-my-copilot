import {
  isMcpServerName,
  launchServer,
  listServers,
  type McpServerName,
} from "../mcp/bootstrap.js";

const ALIASES: Record<string, McpServerName> = {
  state: "omghc_state",
  "state-server": "omghc_state",
  omghc_state: "omghc_state",
  memory: "omghc_memory",
  "memory-server": "omghc_memory",
  omghc_memory: "omghc_memory",
  trace: "omghc_trace",
  "trace-server": "omghc_trace",
  omghc_trace: "omghc_trace",
  wiki: "omghc_wiki",
  "wiki-server": "omghc_wiki",
  omghc_wiki: "omghc_wiki",
};

function normalize(target: string): McpServerName | null {
  const key = target.trim().toLowerCase();
  if (key in ALIASES) return ALIASES[key]!;
  if (isMcpServerName(key)) return key;
  return null;
}

function buildHelp(): string {
  const rows = listServers()
    .map((entry) => `  ${entry.name.padEnd(16)}${entry.description}`)
    .join("\n");
  return [
    "Usage: omghc mcp-serve <target>",
    "",
    "Launch an OMGHC stdio MCP server. Reads JSON-RPC on stdin and writes",
    "JSON-RPC on stdout. Used by Copilot CLI's mcp-config.json entries.",
    "",
    "Targets:",
    rows,
    "",
    "Aliases: state, memory, trace, wiki (and *-server forms).",
  ].join("\n");
}

export async function runMcpServe(args: string[]): Promise<number> {
  const first = args[0];
  if (!first || first === "--help" || first === "-h" || first === "help") {
    process.stdout.write(`${buildHelp()}\n`);
    return 0;
  }

  if (args.length > 1) {
    process.stderr.write(`omghc mcp-serve: unexpected arguments: ${args.slice(1).join(" ")}\n`);
    return 2;
  }

  const target = normalize(first);
  if (!target) {
    process.stderr.write(`omghc mcp-serve: unknown target '${first}'\n`);
    process.stderr.write(`${buildHelp()}\n`);
    return 2;
  }

  await launchServer(target);
  return 0;
}
