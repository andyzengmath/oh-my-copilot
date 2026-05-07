const HELP_TEXT = `oh-my-ghcopilot (omghc) — harness layer for GitHub Copilot CLI

USAGE:
  omghc <subcommand> [options]

SUBCOMMANDS:
  version              Print version and platform info
  status               Show active OMGHC modes
  help                 Show this help

  setup                Install OMGHC into ~/.copilot/
  setup --finalize-mcp Register OMGHC MCP servers in ~/.copilot/mcp-config.json
  doctor               Diagnose OMGHC + Copilot CLI install + auth
  list                 List installed skills + prompts + agents
  uninstall            Remove OMGHC managed assets (preserves user content)
  update               Check npm and refresh setup

  state                State CLI parity (omghc_state MCP)
  mcp-serve            Launch a stdio MCP server (state/memory/trace/wiki)
  wiki                 Wiki MCP CLI parity
  trace                Trace MCP CLI parity

  team                 Spawn parallel tmux team workers
  hud                  Show team HUD
  continue             Resume an interrupted workflow (Stop-event replacement)

  notify               Slack/Discord notification routing

EXAMPLES:
  omghc version
  omghc setup
  omghc doctor --probe-hooks
  omghc team 3:executor "fix the failing tests"
  omghc hud --team <name> --watch
  omghc continue --list

DOCS:
  README.md, DEMO.md, docs/{auth,copilot-native-hooks,copilot-prompt-mode}.md

`;

export async function runHelp(_args: string[]): Promise<number> {
  process.stdout.write(HELP_TEXT);
  return 0;
}
