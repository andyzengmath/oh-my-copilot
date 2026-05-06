/**
 * `omghc setup --finalize-mcp` — register OMGHC MCP servers in
 * `~/.copilot/mcp-config.json`. Preserves user-authored entries; idempotent.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { generateMcpConfig } from "../mcp/bootstrap.js";

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function runSetupFinalizeMcp(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`omghc setup --finalize-mcp\n\nRegister OMGHC MCP servers (omghc_state, omghc_memory, omghc_trace, omghc_wiki) in ~/.copilot/mcp-config.json.\n\nUSAGE:\n  omghc setup --finalize-mcp [--dry-run] [--force]\n\nFLAGS:\n  --dry-run   Print the merged config that would be written; don't modify files\n  --force     Overwrite existing OMGHC MCP entries even if user has modified them\n\nThis command is idempotent and preserves user-authored MCP server entries.\n`);
    return 0;
  }

  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force");

  const copilotHome = process.env.COPILOT_HOME ?? join(homedir(), ".copilot");
  const mcpConfigPath = join(copilotHome, "mcp-config.json");

  let existing: McpConfig = {};
  if (existsSync(mcpConfigPath)) {
    try {
      existing = JSON.parse(readFileSync(mcpConfigPath, "utf8")) as McpConfig;
    } catch (err) {
      process.stderr.write(`omghc setup --finalize-mcp: failed to parse ${mcpConfigPath}: ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }

  const omghcConfig = generateMcpConfig({});
  const omghcServerNames = Object.keys(omghcConfig.mcpServers);

  const mergedServers: Record<string, unknown> = { ...(existing.mcpServers ?? {}) };
  for (const name of omghcServerNames) {
    if (mergedServers[name] && !force && !sameAsOmghc(mergedServers[name], omghcConfig.mcpServers[name])) {
      process.stderr.write(`omghc setup --finalize-mcp: ${name} exists with different config; use --force to overwrite\n`);
      return 1;
    }
    mergedServers[name] = omghcConfig.mcpServers[name];
  }

  const merged: McpConfig = { ...existing, mcpServers: mergedServers };

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(merged, null, 2)}\n`);
    process.stdout.write(`\n[dry-run] Would write to: ${mcpConfigPath}\n`);
    return 0;
  }

  mkdirSync(dirname(mcpConfigPath), { recursive: true });
  writeFileSync(mcpConfigPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  process.stdout.write(`omghc setup --finalize-mcp: registered ${omghcServerNames.length} MCP servers in ${mcpConfigPath}\n`);
  for (const name of omghcServerNames) {
    process.stdout.write(`  ${name}\n`);
  }
  return 0;
}

function sameAsOmghc(existing: unknown, omghc: unknown): boolean {
  return JSON.stringify(existing) === JSON.stringify(omghc);
}
