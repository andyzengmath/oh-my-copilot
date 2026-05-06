---
name: "hud"
description: "Show or configure the OMGHC HUD (two-layer statusline)"
role: "display"
scope: ".omghc/**"
---

# HUD Skill

The OMGHC HUD uses a two-layer architecture:

1. **Layer 1 - Copilot built-in statusLine**: Real-time TUI footer showing model, git branch, and context usage. Configured via `[tui] status_line` in `~/.copilot/settings.json`. Zero code required.

2. **Layer 2 - `omghc hud` CLI command**: Shows OMGHC-specific orchestration state (ralph, ultrawork, autopilot, team, pipeline, ecomode, turns). Reads `.omghc/state/` files.

## Quick Commands

| Command | Description |
|---------|-------------|
| `omghc hud` | Show current HUD (modes, turns, activity) |
| `omghc hud --watch` | Live-updating display (polls every 1s) |
| `omghc hud --json` | Raw state output for scripting |
| `omghc hud --preset=minimal` | Minimal display |
| `omghc hud --preset=focused` | Default display |
| `omghc hud --preset=full` | All elements |

## Presets

### minimal
```
[OMGHC] ralph:3/10 | turns:42
```

### focused (default)
```
[OMGHC] ralph:3/10 | ultrawork | team:3 workers | turns:42 | last:5s ago
```

### full
```
[OMGHC] ralph:3/10 | ultrawork | autopilot:execution | team:3 workers | pipeline:exec | turns:42 | last:5s ago | total-turns:156
```

## Setup

`omghc setup` automatically configures both layers:
- Adds `[tui] status_line` to `~/.copilot/settings.json` (Layer 1)
- Writes `.omghc/hud-config.json` with default preset (Layer 2)
- Default preset is `focused`; if HUD/statusline changes do not appear, restart Copilot CLI once.

## Layer 1: Copilot Built-in StatusLine

Configured in `~/.copilot/settings.json`:
```toml
[tui]
status_line = ["model-with-reasoning", "git-branch", "context-remaining"]
```

Available built-in items (Copilot CLI v0.101.0+):
`model-name`, `model-with-reasoning`, `current-dir`, `project-root`, `git-branch`, `context-remaining`, `context-used`, `five-hour-limit`, `weekly-limit`, `copilot-version`, `context-window-size`, `used-tokens`, `total-input-tokens`, `total-output-tokens`, `session-id`

## Layer 2: OMGHC Orchestration HUD

The `omghc hud` command reads these state files:
- `.omghc/state/ralph-state.json` - Ralph loop iteration
- `.omghc/state/ultrawork-state.json` - Ultrawork mode
- `.omghc/state/autopilot-state.json` - Autopilot phase
- `.omghc/state/team-state.json` - Team workers
- `.omghc/state/pipeline-state.json` - Pipeline stage
- `.omghc/state/ecomode-state.json` - Ecomode active
- `.omghc/state/hud-state.json` - Last activity (from notify hook)
- `.omghc/metrics.json` - Turn counts

## Configuration

HUD config stored at `.omghc/hud-config.json`:
```json
{
  "preset": "focused"
}
```

## Color Coding

- **Green**: Normal/healthy
- **Yellow**: Warning (ralph >70% of max)
- **Red**: Critical (ralph >90% of max)

## Troubleshooting

If the TUI statusline is not showing:
1. Ensure Copilot CLI v0.101.0+ is installed
2. Run `omghc setup` to configure `[tui]` section
3. Restart Copilot CLI

If `omghc hud` shows "No active modes":
- This is expected when no workflows are running
- Start a workflow (ralph, autopilot, etc.) and check again

<!-- Ported from oh-my-codex (OMX) v0.15.1 by oh-my-ghcopilot. Original by Yeachan Heo et al., MIT. -->
