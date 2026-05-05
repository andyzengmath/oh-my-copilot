const HELP_TEXT = `oh-my-ghcopilot (omghc) — harness layer for GitHub Copilot CLI

USAGE:
  omghc <subcommand> [options]

SUBCOMMANDS (M0 stubs — implementation in later phases):
  version              Print version and platform info
  status               Show active OMGHC modes (M0: always 'no active modes')
  help                 Show this help

  setup                Install OMGHC into ~/.copilot/ (M1)
  doctor               Diagnose OMGHC + Copilot CLI install (M1)
  list                 List installed skills + agents (M1)
  uninstall            Remove OMGHC managed assets (M1)
  update               Check npm and refresh setup (M1)

  state                State server CLI parity (M2)
  mcp-serve            Launch a stdio MCP server (M2)
  wiki                 Wiki MCP CLI parity (M2)
  trace                Trace MCP CLI parity (M2)
  hooks                Manage hook plugins (M2)

  team                 Spawn parallel tmux team workers (M3)
  hud                  Show team HUD (M3)
  exec                 Run Copilot non-interactively (M3)
  explore              Read-only repo exploration (M3)
  question             Blocking-question UI (M3)
  cancel               Cancel active modes (M3)
  reasoning            Set reasoning effort level (M3)

  notify               Slack/Discord notification routing (M4)
  agents-init          Bootstrap AGENTS.md scaffolding (M4)
  tmux-hook            Manage tmux prompt-injection hook (M4)

EXAMPLES:
  omghc version
  omghc help
  omghc status

PLAN:
  See .omc/plans/2026-05-05-port-omx-to-copilot.md for the full M0–M5 roadmap.

`;

export async function runHelp(_args: string[]): Promise<number> {
  process.stdout.write(HELP_TEXT);
  return 0;
}
