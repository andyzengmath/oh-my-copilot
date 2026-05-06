# oh-my-ghcopilot Demo Guide

A walkthrough of the OMGHC v0.1.0 surface against GitHub Copilot CLI v1.0.40.
Each demo lists the exact command and the expected behavior on a clean machine.

> **Honesty note:** Copilot CLI v1.0.40 file-based hooks **load but do not
> fire** in production. OMGHC writes them for forward-compatibility, but
> keyword routing and lifecycle continuation are exposed today via
> `omghc continue` and skill-text fallbacks rather than hooks. See
> [docs/copilot-native-hooks.md](./docs/copilot-native-hooks.md).

## Prerequisites

- Node.js >= 20
- GitHub Copilot CLI v1.0.40+ (`npm install -g @github/copilot`)
- `copilot login` configured (or `GH_TOKEN`/`GITHUB_TOKEN` exported for headless)
- Optional: `tmux` on Linux/macOS for `omghc team` parallel workers
- Git (worktree-aware workflows; hooks discovery requires `git init` repo)

Windows hosts run team mode through WSL2; psmux on native Windows is
secondary in v0.1.0.

## Setup (< 2 minutes)

```bash
npm install -g oh-my-ghcopilot
omghc setup
```

**Expected output (abbreviated, scope=user, mode=plugin):**

```
Plugin mode: register OMGHC plugin via 'copilot plugin install <repo-root>/plugins/oh-my-ghcopilot'.
Plugin directory pending — will be available in M4. For now, agents and instructions are installed directly to /home/<you>/.copilot/.
MCP server registration pending — run 'omghc setup --finalize-mcp' after M2 build.
Project hook file written: /repo/.github/hooks/oh-my-ghcopilot.json
NOTE: file-based hooks are wired up at the schema layer in Copilot CLI v1.0.40 but DO NOT FIRE in production. This file is forward-compat. See docs/copilot-native-hooks.md.

omghc setup complete (scope=user, mode=plugin):
  21 agents installed at /home/<you>/.copilot/agents/
  instructions.md wrote at /home/<you>/.copilot/instructions.md
  settings.json wrote at /home/<you>/.copilot/settings.json
Run 'omghc doctor' to verify.
```

Then complete the MCP step:

```bash
omghc setup --finalize-mcp
```

This registers `omghc_state`, `omghc_memory`, `omghc_trace`, `omghc_wiki`
in `~/.copilot/mcp-config.json`.

## Verify install

```bash
omghc doctor
```

**Expected output:**

```
oh-my-ghcopilot doctor
======================

  [OK] Copilot CLI: v1.0.40
  [OK] Node.js: v20.x
  [OK] Copilot home: ~/.copilot
  [OK] Authentication: GH_TOKEN set (or login cache populated)
  [OK] Agents: 21 agent prompts installed
  [OK] Instructions: ~/.copilot/instructions.md present
  [OK] settings.json: OMGHC marker block present
  [OK] MCP servers: 4 OMGHC servers registered
  [INFO] Hook file: /repo/.github/hooks/oh-my-ghcopilot.json (forward-compat; v1.0.40 will not fire)

Results: 8 passed, 1 informational, 0 failed
```

## Demo 1 — Skills via `$keywords`

OMGHC ships skills routed by keyword. Inside a Copilot session, prefix
your prompt with the skill's `$<name>` token:

```
$ralph fix the failing test in src/foo.ts and verify
$ralplan add a webhook listener for the inventory service
$team 3:executor "split work across 3 panes and ship a verified PR"
$plan refactor the auth middleware
$tdd add input validation to the user schema
$code-review
```

**What happens (today, v1.0.40):** the keyword sequence is matched by
the skill catalogue's textual instructions in `~/.copilot/instructions.md`
and `~/.copilot/agents/*.agent.md`. The dedicated `keyword-detector` hook
writes its forward-compat hook file but does not fire — the agent honors
the keyword via instruction-level routing instead.

**Hook-fire caveat:** when GitHub ships the missing wiring (tracking
key: `PreToolUseHooksProcessor` ↔ `Session.hooks`), OMGHC will switch
to hook-driven routing automatically — no user action required.

## Demo 2 — `omghc team` parallel execution

The team runtime spawns N tmux panes, gives each a worker identity,
and shares a claim-safe task list under `.omghc/state/team-<name>/`.

```bash
# Linux / macOS / WSL2
tmux new -s omghc-demo
omghc team 3:executor "fix TypeScript errors and verify with tsc --noEmit"
```

**Expected:**

```
omghc team: starting team 'fix-typescript-errors-...' (3 executors)
  worker-1: pane spawned (copilot)
  worker-2: pane spawned (copilot)
  worker-3: pane spawned (copilot)
  task list: .omghc/state/team-fix-typescript-errors-.../tasks.json
  mailbox:   .omghc/state/team-fix-typescript-errors-.../mailbox/
Team started. Watch with: omghc hud --team fix-typescript-errors-... --watch
```

Mixed-CLI workers (e.g., 1 Copilot + 2 Claude):

```bash
OMGHC_TEAM_WORKER_CLI=auto \
OMGHC_TEAM_WORKER_CLI_MAP=copilot,claude,claude \
omghc team 3:executor "split work across CLIs"
```

**Claim-safe lifecycle (JSON envelope):**

```bash
CREATE=$(omghc team api create-task --input \
  '{"team_name":"<team>","subject":"demo","description":"verify","owner":"worker-1"}' --json)
TASK_ID=$(echo "$CREATE" | jq -r '.data.task.id')

CLAIM=$(omghc team api claim-task --input \
  "{\"team_name\":\"<team>\",\"task_id\":\"$TASK_ID\",\"worker\":\"worker-1\",\"expected_version\":1}" --json)
TOKEN=$(echo "$CLAIM" | jq -r '.data.claimToken')

omghc team api transition-task-status --input \
  "{\"team_name\":\"<team>\",\"task_id\":\"$TASK_ID\",\"from\":\"in_progress\",\"to\":\"completed\",\"claim_token\":\"$TOKEN\"}" --json
```

**Mailbox flow:**

```bash
omghc team api send-message --input \
  '{"team_name":"<team>","from_worker":"leader-fixed","to_worker":"worker-1","body":"ACK"}' --json
omghc team api mailbox-list --input \
  '{"team_name":"<team>","worker":"worker-1"}' --json
```

**Lifecycle:**

```bash
omghc team status   <team-name>
omghc team resume   <team-name>
omghc team shutdown <team-name>
```

## Demo 3 — `omghc hud --watch`

A live terminal HUD over the team's task and worker state.

```bash
omghc hud --team <team-name> --watch
```

**Expected (table, refreshes every 5s):**

```
oh-my-ghcopilot HUD — team 'fix-typescript-errors-...'
========================================================
  Tasks:    1 pending  | 2 in_progress | 4 completed
  Workers:  3 alive    | 0 stale       | leader-fixed ok
  Mailbox:  2 unread for worker-2

  TASK          STATUS         OWNER       UPDATED
  ─────         ──────         ─────       ───────
  task-001      completed      worker-1    14:02:11
  task-002      in_progress    worker-2    14:02:35
  task-003      in_progress    worker-3    14:02:38
  task-004      pending        —           14:01:50

(refreshes every 5s; Ctrl+C to exit)
```

JSON form for scripts:

```bash
omghc hud --team <team-name> --json
```

Tmux pane form:

```bash
omghc hud --team <team-name> --tmux
```

## Demo 4 — Stop-event redesign (`omghc continue`)

Copilot CLI has **no `Stop` event**. OMGHC implements a forward-compat
substitute via the `sessionEnd` hook (when wiring lands) plus
`omghc continue`.

The flow:

1. Active mode (e.g., `omghc team`) writes runtime state to
   `.omghc/state/team-<name>/`.
2. On session end (or manual invocation today), the `sessionEnd` adapter
   would persist a hint to `.omghc/state/<mode>-resume-hint.json`.
3. `omghc continue` reads the most recent hint and re-spawns the right
   command.

**Smoke-test today (manual hint, no live hook):**

```bash
export GH_TOKEN="<token>"
omghc team 2:executor "long-running multi-step task"
# (wait until the team has produced state under .omghc/state/team-...)

# Inspect what would be resumable:
omghc continue --list
```

**Expected:**

```
Found 1 resume hint(s):
  team             2026-05-06T14:02:38Z  Resume team 'long-running...' from worker mailbox
```

Resume:

```bash
omghc continue
# or to be specific:
omghc continue --mode team
# Dry-run prints the command without spawning:
omghc continue --dry-run
```

Clear stale hints:

```bash
omghc continue --clear              # all
omghc continue --clear --mode team  # just team
```

**Why this matters:** OMX's Ralph/ultrawork/team continuation depended on
Codex's `Stop` event. The `omghc continue` wrapper is the OMGHC-native
equivalent — works today via manual invocation, becomes automatic the
moment v1.0.41+ wires up `sessionEnd`.

## Demo 5 — MCP servers (`omghc mcp-serve`)

OMGHC exposes 4 stdio MCP servers backed by `.omghc/state/`.

```bash
omghc mcp-serve omghc_state
```

The process speaks JSON-RPC 2.0 on stdin/stdout. Probe its tool list:

```bash
# In another terminal:
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | omghc mcp-serve omghc_state
```

**Expected (abbreviated):**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      { "name": "state_read",        "description": "Read mode state" },
      { "name": "state_write",       "description": "Write mode state" },
      { "name": "state_clear",       "description": "Clear mode state" },
      { "name": "state_list_active", "description": "List active modes" },
      { "name": "state_get_status",  "description": "Get mode status" }
    ]
  }
}
```

CLI parity (skip MCP, hit state directly):

```bash
omghc state list
omghc state read --mode team
omghc state write --mode autopilot --json '{"active":true}'
omghc state clear --mode autopilot
```

Other servers expose the same shape:

```bash
omghc mcp-serve omghc_memory
omghc mcp-serve omghc_trace
omghc mcp-serve omghc_wiki
```

## Demo 6 — Notifications (`omghc notify`)

Wire workflow milestones to Slack/Discord webhooks. Used by long-running
modes (team, ralph) to surface completion outside the terminal.

```bash
export OMGHC_NOTIFY_SLACK_WEBHOOK="https://hooks.slack.com/services/..."
export OMGHC_NOTIFY_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."

# Default: post to all configured targets.
omghc notify --message "team finished" --severity info

# Single target with title:
omghc notify --target slack --title "CI" --severity error \
  --message "build failed on main"

# Dry-run prints redacted URLs and payload, no POST:
omghc notify --message "test" --dry-run --target all
```

**Dry-run output:**

```
[dry-run] slack -> https://hooks.slack.com/<redacted>
[dry-run] payload: {"text":":information_source: test"}
[dry-run] discord -> https://discord.com/<redacted>
[dry-run] payload: {"content":":information_source: test"}
```

If neither env var is set:

```
omghc notify: slack webhook not configured (set OMGHC_NOTIFY_SLACK_WEBHOOK)
omghc notify: discord webhook not configured (set OMGHC_NOTIFY_DISCORD_WEBHOOK)
no notification target
```

Exits 0 in all of those cases — graceful no-op for unconfigured users.

## Demo 7 — Plugin install (forward-compat)

OMGHC ships a Copilot plugin manifest under
`plugins/oh-my-ghcopilot/`. Today, `copilot plugin install` accepts
**only** `owner/repo`, marketplace, and archive URLs — **not local
paths**.

```bash
# This does NOT work in v1.0.40:
copilot plugin install ./plugins/oh-my-ghcopilot
# Error: source must be owner/repo, owner/repo:path, https://..., or plugin@marketplace
```

**Workaround for local development:** `omghc setup` already file-copies
agents and skills directly into `~/.copilot/`. The plugin bundle is
forward-compat for the marketplace flow.

**When this changes:** once `oh-my-ghcopilot` is published to a
Copilot-recognized source, the install command becomes:

```bash
copilot plugin install AndyZ/oh-my-ghcopilot
```

— no other user-facing change.

## Demo 8 — One-shot E2E script

A bundled smoke script lives at `scripts/demo-e2e.sh`
(forward-compat for v0.2; not a v0.1.0 deliverable).

The equivalent manual one-shot today:

```bash
set -euo pipefail

# 1. install + verify
npm install -g oh-my-ghcopilot
omghc setup
omghc setup --finalize-mcp
omghc doctor

# 2. team smoke
tmux new -d -s omghc-demo
TEAM_TASK="omghc demo $(date +%s)"
omghc team 3:executor "$TEAM_TASK"

# Pull the team name from latest tasks dir.
TEAM_NAME=$(ls -1t .omghc/state/ | grep '^team-' | head -1 | sed 's/^team-//')

# 3. lifecycle + JSON envelope
omghc team status "$TEAM_NAME"
omghc team api get-summary --input "{\"team_name\":\"$TEAM_NAME\"}" --json \
  | jq -e '.schema_version == "1.0" and .ok == true'

# 4. continue smoke (no-op until a hint is persisted)
omghc continue --list

# 5. notify smoke (dry-run, no env vars required)
omghc notify --message "demo complete" --dry-run

# 6. shutdown
omghc team shutdown "$TEAM_NAME"

echo "OMGHC demo complete."
```

## File inventory (v0.1.0)

| Component       | Count  | Location                                                  |
|-----------------|--------|-----------------------------------------------------------|
| Agent prompts   | 21     | `~/.copilot/agents/*.agent.md`                            |
| Skills          | ~21    | `~/.copilot/skills/<name>/SKILL.md` (legacy mode)         |
| MCP servers     | 4      | Registered in `~/.copilot/mcp-config.json`                |
| CLI subcommands | 18+    | `omghc {setup, doctor, list, update, uninstall, state, mcp-serve, wiki, trace, team, hud, continue, notify, version, status, help, ...}` |
| Hook file       | 1      | `<gitRoot>/.github/hooks/oh-my-ghcopilot.json` (forward-compat) |
| Templates       | 3      | `templates/{AGENTS.md, instructions.md.tmpl, settings.seed.json}` |

## Caveats and known limitations (v0.1.0)

- **Hooks do not fire in Copilot CLI v1.0.40.** Schema validates,
  processor registers, but the bridge from `Session.hooks` to
  `preToolsExecution` is incomplete. Tracking via
  `omghc doctor --probe-hooks`. See
  [docs/copilot-native-hooks.md](./docs/copilot-native-hooks.md).
- **No native `Stop` event.** Use `omghc continue` for the OMGHC
  equivalent.
- **`copilot plugin install` rejects local paths.** Use file-based
  install via `omghc setup` until the plugin reaches a marketplace.
- **Windows team mode is secondary.** psmux works for many flows; WSL2
  is recommended.
- **Mixed-CLI workers** (Copilot + Claude + Codex + Gemini) are
  supported via `OMGHC_TEAM_WORKER_CLI_MAP`; each worker's auth env
  must be present in the leader's environment before launch.

## Troubleshooting

**`copilot: command not found`**
Install with `npm install -g @github/copilot`.

**Auth check fails**
Set `GH_TOKEN` (preferred), `GITHUB_TOKEN`, or `COPILOT_GITHUB_TOKEN`,
or run `copilot login` and confirm via the doctor's auth check.
See [docs/auth.md](./docs/auth.md).

**Skill keyword not routing**
Check that `~/.copilot/instructions.md` contains the OMGHC marker block
(`<!-- OMGHC:INSTRUCTIONS:START -->`) and that
`~/.copilot/agents/*.agent.md` is populated. Re-run
`omghc setup --merge-agents` if stale.

**MCP server fails to register**
`omghc setup --finalize-mcp` is idempotent — re-running re-registers
without rewriting agents.

**Team workers exit immediately**
Worker bootstrap fails closed when `GH_TOKEN`/`GITHUB_TOKEN` is missing
in the leader's environment. Export it and re-launch.

**Hook fires unexpectedly missing**
Expected today against Copilot CLI v1.0.40. OMGHC's
`omghc doctor --probe-hooks` is the canonical detection — when it
flips to PASS, GitHub has shipped the wiring and OMGHC's hooks
activate automatically.

---

For the full plan and milestone history, see
`.omc/plans/2026-05-05-port-omx-to-copilot.md`.
For the canonical hook contract, see
`docs/copilot-native-hooks.md`.
