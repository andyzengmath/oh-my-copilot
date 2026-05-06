/**
 * OMGHC MCP server registry + launcher.
 *
 * Single source of truth for the four first-party MCP servers shipped with
 * `oh-my-ghcopilot`. Used by the `omghc mcp-serve` CLI to dispatch a launch,
 * and by `omghc setup --finalize-mcp` to generate the snippet that gets merged
 * into `~/.copilot/mcp-config.json`.
 */

export type McpServerName =
  | "omghc_state"
  | "omghc_memory"
  | "omghc_trace"
  | "omghc_wiki";

export interface McpServerEntry {
  name: McpServerName;
  description: string;
  entry: string;
}

export const MCP_SERVERS: McpServerEntry[] = [
  {
    name: "omghc_state",
    description: "Mode state management",
    entry: "dist/mcp/state-server.js",
  },
  {
    name: "omghc_memory",
    description: "Notepad + project memory",
    entry: "dist/mcp/memory-server.js",
  },
  {
    name: "omghc_trace",
    description: "Trace event consumer",
    entry: "dist/mcp/trace-server.js",
  },
  {
    name: "omghc_wiki",
    description: "Local markdown wiki",
    entry: "dist/mcp/wiki-server.js",
  },
];

const SERVER_NAMES: McpServerName[] = MCP_SERVERS.map((s) => s.name);

export function isMcpServerName(value: unknown): value is McpServerName {
  return typeof value === "string" && (SERVER_NAMES as string[]).includes(value);
}

export function listServers(): { name: string; description: string }[] {
  return MCP_SERVERS.map(({ name, description }) => ({ name, description }));
}

export async function launchServer(name: McpServerName): Promise<void> {
  switch (name) {
    case "omghc_state": {
      const mod = await import("./state-server.js");
      await mod.startStateServer();
      return;
    }
    case "omghc_memory": {
      const mod = await import("./memory-server.js");
      await mod.startMemoryServer();
      return;
    }
    case "omghc_trace": {
      const mod = await import("./trace-server.js");
      await mod.startTraceServer();
      return;
    }
    case "omghc_wiki": {
      const mod = await import("./wiki-server.js");
      await mod.startWikiServer();
      return;
    }
    default: {
      const exhaustive: never = name;
      throw new Error(`unknown MCP server: ${String(exhaustive)}`);
    }
  }
}

export interface McpConfigEntry {
  type: "stdio";
  command: string;
  args: string[];
  tools: string[];
}

export interface GenerateMcpConfigOptions {
  command?: string;
  args?: string[];
}

export function generateMcpConfig(
  opts: GenerateMcpConfigOptions = {},
): { mcpServers: Record<string, McpConfigEntry> } {
  const baseCommand = opts.command ?? "omghc";
  const baseArgs = opts.args ?? ["mcp-serve"];

  const mcpServers: Record<string, McpConfigEntry> = {};
  for (const { name } of MCP_SERVERS) {
    mcpServers[name] = {
      type: "stdio",
      command: baseCommand,
      args: [...baseArgs, name],
      tools: ["*"],
    };
  }
  return { mcpServers };
}
