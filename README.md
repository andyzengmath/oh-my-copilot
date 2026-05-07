# oh-my-ghcopilot (OMGHC)

> Harness-engineering plugin for **GitHub Copilot CLI** — an analogue of [oh-my-codex (OMX)](https://github.com/Yeachan-Heo/oh-my-codex) for OpenAI Codex CLI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

**Status:** v0.1.0 — [published on npm](https://www.npmjs.com/package/oh-my-ghcopilot). M0–M4 shipped (166 tests passing on Linux + macOS + Windows).

OMGHC adds a workflow layer on top of [GitHub Copilot CLI](https://github.com/github/copilot-cli):

- Start Copilot sessions with project-aware **skills** and **role prompts**
- Spawn coordinated **parallel team workers** on a shared, claim-safe task list
- Persist **state, plans, drafts, wiki, memory** in `.omghc/` per project
- Register **MCP servers** (state, memory, trace, wiki) for tool-level integration
- Replace OMX's `Stop` hook with a **`sessionEnd` + `omghc continue`** redesign for resumable flows

If you already like Copilot CLI and want a richer workflow on top of it, OMGHC is for you. If you want plain Copilot with no extra workflow, you don't need OMGHC.

---

## Install

```bash
npm install -g @github/copilot   # GitHub Copilot CLI itself
npm install -g oh-my-ghcopilot   # this project
```

**Requirements:** Node.js ≥ 20. macOS or Linux recommended (Windows is supported but secondary). `tmux` (or `psmux` on Windows) only needed for `omghc team`.

---

## Quickstart

```bash
# 1. Verify Copilot is installed and authenticated
copilot --version
copilot login            # if not already authenticated

# 2. Set up OMGHC
omghc setup              # writes ~/.copilot/{settings,instructions,agents/} + .github/hooks/oh-my-ghcopilot.json

# 3. Verify install + auth
omghc doctor

# 4. Use a skill or spawn a team
copilot                  # then type: $ralph "fix the failing tests"
omghc team 3:executor "fix all TypeScript errors"
```

---

## Subcommands

| Command | Purpose |
|---------|---------|
| `omghc setup` | Install OMGHC into `~/.copilot/` and `<project>/.github/hooks/` |
| `omghc setup --finalize-mcp` | Register OMGHC MCP servers in `~/.copilot/mcp-config.json` |
| `omghc doctor [--probe-hooks]` | Diagnose OMGHC + Copilot CLI install + auth |
| `omghc list [--json]` | List installed skills, prompts, agents |
| `omghc uninstall [--force]` | Remove managed assets (preserves user content) |
| `omghc update [--check-only]` | Check npm + refresh setup |
| `omghc team N:role "task"` | Spawn N coordinated parallel workers in tmux |
| `omghc team {status\|resume\|shutdown\|api}` | Team lifecycle commands |
| `omghc hud --team <name> [--watch]` | Live HUD for team status |
| `omghc state {read\|write\|clear\|list}` | State CLI parity (`omghc_state` MCP) |
| `omghc wiki {list\|read\|write\|search\|lint\|refresh}` | Local markdown wiki |
| `omghc trace {summary\|timeline}` | Trace event consumer |
| `omghc mcp-serve <name>` | Launch a stdio MCP server (state/memory/trace/wiki) |
| `omghc continue [--list\|--clear\|--mode <mode>]` | Resume an interrupted workflow (Stop-event replacement) |
| `omghc notify --message <text> [--target slack\|discord\|all]` | Webhook notifications |
| `omghc version`, `omghc help`, `omghc status` | Standard utilities |

Run `omghc <subcommand> --help` for details on any command.

---

## `$keyword` workflow

Inside a Copilot session, OMGHC recognizes a small set of activation keywords:

| Keyword | What it does |
|---------|--------------|
| `$ralph "<task>"` | Persistent completion loop with verification gate |
| `$ralplan "<task>"` | Multi-perspective consensus planning (Planner/Architect/Critic) |
| `$team N:role "<task>"` | Spawn coordinated parallel workers |
| `$deep-interview "<task>"` | Socratic clarification before autonomous execution |
| `$autopilot "<task>"` | Full autonomous pipeline from idea to working code |
| `$plan "<task>"` | Strategic planning consultant (interview or direct mode) |

Keyword detection is implemented in `src/hooks/keyword-detector.ts` and runs as part of the `userPromptSubmitted` hook adapter. **Caveat:** in Copilot CLI v1.0.40, file-based hooks are wired up at the schema layer but the runtime bridge is incomplete (see [Hooks status](#hooks-status) below). Keyword-driven activation will become automatic once Copilot CLI ships hook execution; until then, run `omghc <skill>` or invoke skills via the workflows yourself.

See [`docs/skills.md`](docs/skills.md) for the full catalog of 21 ported skills.

---

## Hooks status

Per the M2a spike (see [`docs/copilot-native-hooks.md`](docs/copilot-native-hooks.md)):

- **Hook discovery is `<gitRoot>/.github/hooks/**/*.json`** — not via plugin manifest. OMGHC's `omghc setup` writes the hook file directly to your project.
- **6 events supported by Copilot's schema**: `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`. (No `Stop` event — see "Stop-event redesign" below.)
- **Hooks DO NOT FIRE in Copilot CLI v1.0.40 production binary.** Schema validates, hook loader runs, processor registers — but the bridge from `Session.hooks` to `preToolsExecution` is incomplete in this build. OMGHC builds for **forward-compat**: when a future Copilot release wires this up, OMGHC's hooks will activate automatically with no further work.
- **Probe with**: `omghc doctor --probe-hooks` — it drops a marker hook, fires a tool call, asserts firing. PASS = wiring is live; FAIL = expected today; INCONCLUSIVE = no auth available to probe.

---

## Stop-event redesign

Copilot CLI's hook schema has **no `Stop` event** (a key divergence from OMX). OMGHC implements an equivalent via `sessionEnd` + persisted resume hint:

1. When a session ends, the `copilot-native-hook.ts` adapter writes a hint file at `<wd>/.omghc/state/<mode>-resume-hint.json` for each active non-terminal mode (e.g., a Ralph iteration in flight, an unfinished team).
2. `omghc continue` reads the most recent hint (or pick by `--mode <name>`) and re-launches the recorded `resume_command`.

```bash
omghc continue --list           # show all hints
omghc continue                  # resume the most recent active mode
omghc continue --mode team      # resume team specifically
omghc continue --clear --mode ralph   # discard a stale hint
```

Once Copilot CLI's `sessionEnd` hook actually fires, this becomes automatic. Today, run `omghc continue` manually after restarting a session.

---

## State model

```
.omghc/
├── state/                        # mode-specific JSON state files
│   ├── team-<name>/
│   │   ├── state.json            # team metadata
│   │   ├── tasks/<id>.json       # claim-safe task lifecycle
│   │   ├── workers/<name>/{identity,heartbeat}.json
│   │   ├── mailbox/<worker>/<msg-id>.json
│   │   └── dispatch/<id>.json
│   ├── ralph-state.json
│   ├── trace.jsonl               # append-only event log
│   └── <mode>-resume-hint.json   # session-end hints
├── plans/                        # planning artifacts
├── drafts/                       # work in progress
├── wiki/<slug>.md                # local markdown wiki (frontmatter + body)
├── logs/                         # hook execution logs
├── memory/                       # notepad + project memory
├── handoffs/                     # team-stage handoffs
└── worktrees/                    # team git worktrees
```

---

## Auth

Copilot CLI uses GitHub OAuth tokens via env-var precedence:

1. `COPILOT_GITHUB_TOKEN` (highest)
2. `GH_TOKEN`
3. `GITHUB_TOKEN`

If none set, falls back to cached login at `~/.copilot/config.json` (`loggedInUsers` array).

Run `copilot login` to authenticate interactively. `omghc doctor` verifies and reports without printing token contents.

See [`docs/auth.md`](docs/auth.md) for the full auth model.

---

## Architecture

OMGHC is **TypeScript-only** for v0.x (Rust crates planned for v1.x). The plugin layout mirrors GitHub Copilot CLI's documented schema:

```
src/
├── cli/             # all CLI subcommands (~25 files)
├── catalog/         # skill/prompt/agent registry reader
├── agents/          # generateAgentMarkdown (Markdown frontmatter generator)
├── state/           # mode state operations
├── mcp/             # 4 stdio MCP servers (state, memory, trace, wiki) + bootstrap
├── hooks/           # keyword-detector, agents-overlay, session, prompt-guidance, triage
├── team/            # orchestrator + runtime + tmux-session + workers + worktree + api
├── hud/             # team status display
├── scripts/         # copilot-native-hook adapter, plugin sync/verify
├── question/        # blocking-question UI
└── runtime/         # run-outcome contract

plugins/oh-my-ghcopilot/
├── plugin.json      # Copilot plugin manifest (no `hooks` field per spike)
├── .mcp.json        # MCP server registrations
├── skills/<name>/SKILL.md       # mirrored from canonical skills/
└── agents/<name>.agent.md       # generated from canonical prompts/
```

Workers are **subprocess-mode** (`copilot --prompt "..." --allow-all-tools --no-color --no-ask-user --no-auto-update`) — no TTY required. This is the inverse of OMX's Codex constraint, confirmed by the M3a spike (see [`docs/copilot-prompt-mode.md`](docs/copilot-prompt-mode.md)).

---

## Differences from OMX

| Aspect | OMX | OMGHC |
|--------|-----|-------|
| Target CLI | OpenAI Codex CLI | GitHub Copilot CLI |
| Config | `~/.codex/config.toml` | `~/.copilot/settings.json` |
| Agents | `agents/*.toml` | `agents/*.agent.md` (YAML frontmatter) |
| Hook discovery | Plugin manifest | `<gitRoot>/.github/hooks/*.json` |
| Hook firing | Live | Forward-compat (Copilot v1.0.40 doesn't fire yet) |
| Stop event | Yes | No — replaced by `sessionEnd` + `omghc continue` |
| Worker mode | Codex requires TTY (interactive panes) | Copilot subprocess (`-p`), no TTY |
| Auth | `OPENAI_API_KEY` | `GH_TOKEN`/`GITHUB_TOKEN` (env-var precedence) |
| Stack | TS + 5 Rust crates | TS-only for v0.x |
| Skill catalog | 39 skills | 21 (M1 MVP); 18 deferred to v1.x |

---

## Documentation

- [Plan](.omc/plans/2026-05-05-port-omx-to-copilot.md) — full implementation plan with milestone history
- [Getting started](docs/getting-started.md) — install + first commands
- [Skills](docs/skills.md) — catalog of 21 ported skills
- [Integrations](docs/integrations.md) — Slack/Discord/CI patterns
- [Auth](docs/auth.md) — env-var precedence + login cache
- [Hooks](docs/copilot-native-hooks.md) — Copilot hook schema (M2a spike)
- [`copilot --prompt` mode](docs/copilot-prompt-mode.md) — worker invocation reference (M3a spike)
- [Demo](DEMO.md) — guided walkthroughs

---

## Milestones shipped

| Milestone | Commits | Tests |
|-----------|---------|-------|
| M0 — Scaffold | `f397693` | 6 |
| M1 — Skills + setup + doctor | `6dbcb2e`, `41c9ae6` | 38 |
| M2a — MCP servers + CLI parity + hooks spike | `065626a`, `af06fa2` | 24 |
| M2b — Hook ports + plugin manifests + finalize-mcp + probe-hooks | `4f8aa47`, `a20e6af` | 26 |
| M3a — Team state + worktree + tmux-session + worker-bootstrap + api | `b6770d3` | 17 |
| M3b — Orchestrator + runtime + omghc team CLI + hud + omghc continue | `dde4d9a` | 40 |
| **Total** | **8 commits** | **151+ tests passing** |

---

## Contributing

Plan and handoffs live under `.omc/plans/` and `.omc/handoffs/`. The codebase is structured to absorb upstream OMX improvements via a rename pass; if you spot OMX patterns worth bringing over, contributions welcome.

---

## License

MIT — see [LICENSE](./LICENSE).

This project is an independent reimplementation inspired by [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex) by Yeachan Heo and contributors, also licensed under MIT. Skill and prompt content is ported with attribution preserved in file footers.

**Disclaimer:** Independent project, not affiliated with GitHub or Microsoft.
