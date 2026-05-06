# Getting Started

This guide walks you through installing oh-my-ghcopilot (OMGHC), running your first skill, and launching a coordinated team. It is the shortest path from a clean machine to a working OMGHC session.

## Prerequisites

- Node.js >= 20
- GitHub Copilot CLI installed and authenticated (`copilot login --status`)
- (Optional, for `$team`) `tmux` and a Unix-like shell — team mode is macOS / Linux only
- Git (for worktree-aware workflows)

For headless / CI environments, set `GH_TOKEN` or `GITHUB_TOKEN` instead of running interactive `copilot login`. See [auth](./auth.md).

## Install

OMGHC ships as an npm package and a Copilot plugin bundle.

```bash
npm install -g oh-my-ghcopilot
```

To use the plugin surface (skills, prompts, agents shipped under `plugins/`), reference the plugin bundle in your Copilot CLI config. The npm install carries an in-tree mirror under `plugins/oh-my-ghcopilot/` — `omghc setup` wires it up for you.

## Setup walkthrough

Run setup once per machine. It writes `~/.copilot/AGENTS.md`, installs skills under `${COPILOT_HOME:-~/.copilot}/skills/`, and registers OMGHC's MCP companion server.

```bash
omghc setup
```

Then verify the install:

```bash
omghc doctor
```

Expected report sections:

- Plugin Version: OK (or INFO if not cached yet)
- Hook Config: OK
- AGENTS.md: OK
- Authentication: OK
- Skills: OK (path printed)

If any check is `WARN` or `CRITICAL`, run the auto-fix flow `omghc doctor` prompts you through, or read [doctor](#troubleshooting) below.

## First skill invocation

Skills are activated by keyword in your Copilot session. From inside a Copilot CLI session:

```
$ralph fix the failing test in src/foo.ts and verify
```

The `$ralph` keyword routes the prompt to the [`ralph`](./skills.md#ralph) skill, which runs the persistence loop, delegates work, runs verification, and exits cleanly via `/cancel` once the architect approves.

Other common single-skill triggers:

```
$plan add a webhook listener for the inventory service
$tdd add input validation to the user schema
$code-review
```

See the full skill catalogue in [skills.md](./skills.md).

## First team execution

`$team` (or `omghc team`) launches N tmux worker panes that share a task list. **macOS / Linux only — Windows hosts can drive teams via WSL2.**

From inside a tmux session:

```bash
omghc team 3:executor "analyze auth flow, draft fix, ship PR with verification"
```

What happens:

1. OMGHC parses `N:role` and the task.
2. Initializes `.omghc/state/team/<team>/` with manifest, tasks, and worker identities.
3. Splits the current tmux window into 3 worker panes.
4. Triggers each worker via inbox + `tmux send-keys`.
5. Returns to the leader pane; you watch progress with `omghc team status`.

Monitor:

```bash
omghc team status <team-name>
omghc team await <team-name> --timeout-ms 30000 --json
```

To launch Claude workers instead of Copilot:

```bash
OMGHC_TEAM_WORKER_CLI=claude omghc team 2:executor "split doc/code tasks"
```

Mixed teams via `OMGHC_TEAM_WORKER_CLI_MAP=copilot,claude`.

## Cleanup

```bash
omghc team shutdown <team-name>
```

Run shutdown only when no tasks are `pending` or `in_progress` — otherwise late-writing workers will see `ENOENT` on the team state path.

To uninstall OMGHC entirely (skills, AGENTS.md marker, MCP registration):

```bash
omghc uninstall
npm uninstall -g oh-my-ghcopilot
```

## Troubleshooting

### `copilot: command not found`

Install GitHub Copilot CLI first. OMGHC is a wrapper, not a replacement.

### `copilot login --status` reports not signed in

Either run `copilot login`, or for headless flows:

```bash
export GH_TOKEN="<personal-access-token>"
```

### `omghc doctor` reports legacy hooks

OMGHC migrated away from `~/.copilot/hooks/*.sh`. Let `omghc doctor` auto-clean them, or remove manually:

```bash
rm -f ~/.copilot/hooks/keyword-detector.sh ~/.copilot/hooks/persistent-mode.sh
```

### Skills not firing on `$keyword`

1. Check `${COPILOT_HOME:-~/.copilot}/skills/` exists and contains skill folders.
2. Confirm `~/.copilot/AGENTS.md` includes the OMGHC marker (`oh-my-ghcopilot Multi-Agent System`).
3. Restart your Copilot CLI session after install.

### `$team` says tmux not available

Team mode requires `tmux` on the host. On Windows, run inside WSL2. From a non-tmux shell, OMGHC will refuse to launch panes — start `tmux new -s omghc` first.

### MCP companion server fails to start

```bash
omghc setup --finalize-mcp
```

This reregisters the OMGHC MCP entry without rerunning the full setup.

### Multiple plugin cache versions

```bash
PLUGIN_CACHE_ROOT="${COPILOT_HOME:-$HOME/.copilot}/plugins/cache"
find "$PLUGIN_CACHE_ROOT" -path "*/oh-my-ghcopilot" -type d -prune -exec rm -rf {} +
```

Restart Copilot CLI; it will refetch the latest entry.

## Next steps

- Browse the skill catalogue: [skills.md](./skills.md)
- Wire up Slack / Discord / CI: [integrations.md](./integrations.md)
- Read about Copilot-native auth and hooks: [auth.md](./auth.md), [copilot-native-hooks.md](./copilot-native-hooks.md)
