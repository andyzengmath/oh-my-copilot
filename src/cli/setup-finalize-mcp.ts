/**
 * `omghc setup --finalize-mcp` — placeholder until M2 ships.
 *
 * M2 will implement the OMGHC MCP servers (omghc_state, omghc_memory,
 * omghc_trace, omghc_wiki) and register them in `~/.copilot/mcp-config.json`.
 * Until then, this subcommand is a no-op that exits 0 with a notice.
 */

const HELP_TEXT = `omghc setup --finalize-mcp

Register OMGHC MCP servers (omghc_state, omghc_memory, omghc_trace, omghc_wiki) in ~/.copilot/mcp-config.json.

USAGE:
  omghc setup --finalize-mcp

STATUS:
  This subcommand is a placeholder until M2 ships. M2 will implement the MCP servers and this finalize step.

EXIT CODES:
  0 (placeholder mode): always exits 0 with a notice.
  Once M2 ships: 0 on success, 1 on error.
`;

const PLACEHOLDER_TEXT = `omghc setup --finalize-mcp: M2 placeholder.

The OMGHC MCP servers (omghc_state, omghc_memory, omghc_trace, omghc_wiki) will be implemented in M2.
Until M2 ships, this subcommand is a no-op that exits 0.

Track M2 progress in .omc/plans/2026-05-05-port-omx-to-copilot.md §M2.
`;

export async function runSetupFinalizeMcp(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  process.stdout.write(PLACEHOLDER_TEXT);
  return 0;
}
