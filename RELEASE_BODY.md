# oh-my-ghcopilot v0.1.0 — initial release

## TL;DR

`oh-my-ghcopilot` (OMGHC) is a comprehensive harness-engineering plugin and runtime layer for **GitHub Copilot CLI** (`@github/copilot`) — a TypeScript port of [`oh-my-codex`](https://github.com/yeachan-heo/oh-my-codex) (OMX) v0.15.1, structurally analogous but targeting Copilot's plugin model (`~/.copilot/`, `plugin.json`, `mcp-config.json`, `agents/*.agent.md`, `hooks.json`). v0.1.0 ships 21 skills, 33 role prompts, 4 stdio MCP servers, 5 hook modules (forward-compat — see Known Issues), a tmux/psmux team runtime with subprocess Copilot workers, and the `omghc` CLI binary with `setup`, `doctor`, `team`, `state`, `wiki`, `trace`, `notify`, `continue`, and more. Install via `npm install -g oh-my-ghcopilot && omghc setup`.

---

## Highlights (per-milestone)

### M0 — Scaffold (commit `f397693`)
- `package.json` with `name=oh-my-ghcopilot`, `bin.omghc=dist/cli/omghc.js`, `engines.node>=20`, `type=module`.
- `tsconfig.json` strict, ESM, `target=es2022`.
- Initial `src/cli/omghc.ts` boots; `omghc version` prints `oh-my-ghcopilot v0.0.1`.
- CI workflow scaffold (Linux + macOS + Windows).
- Repo layout established (`src/`, `skills/`, `prompts/`, `templates/`, `plugins/oh-my-ghcopilot/`, `docs/`, `crates/` placeholder).

### M1 — Skills + setup + doctor (commits `6dbcb2e`, `41c9ae6`)
- 21 skills ported from OMX (`ralph`, `ralplan`, `team`, `deep-interview`, `autopilot`, `plan`, `code-review`, `tdd`, `doctor`, `omghc-setup`, `worker`, `pipeline`, `hud`, `wiki`, `cancel`, `help`, `note`, `git-master`, `analyze`, `build-fix`, `ai-slop-cleaner`).
- 33 role prompts ported.
- `agents/*.agent.md` synthesized from prompts via Markdown + YAML-frontmatter generator (replacing OMX's TOML format).
- `omghc setup` writes `~/.copilot/settings.json`, `~/.copilot/agents/*.agent.md`, `~/.copilot/instructions.md`; `--plugin` (default) vs `--legacy`; `--merge-agents` preserves user content between markers.
- `omghc doctor` checks Copilot CLI version, Node 20+, project `.omghc/` writability, settings, agents.
- **Auth (per M1a spike):** doctor enforces env-var precedence `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`; reads `${COPILOT_HOME:-~/.copilot}/config.json` `loggedInUsers` array (NOT `login-cache`); never invokes interactive `copilot login`. See `docs/auth.md`.
- `omghc uninstall`, `omghc list --json`, `omghc update` ported.

### M2 — Hooks + state + MCP servers (commits `065626a`, `af06fa2`, `4f8aa47`, `a20e6af`)
- **4 stdio MCP servers** (`omghc_state`, `omghc_memory`, `omghc_trace`, `omghc_wiki`) reachable via `omghc mcp-serve <name>`; bootstrap dispatcher.
- **CLI parity:** `omghc state {read|write|clear|list}`, `omghc wiki {list|query|lint|refresh}`, `omghc trace {summary|timeline}`.
- **5 hook modules** ported for forward-compat: `keyword-detector`, `agents-overlay`, `session`, `prompt-guidance-contract`, `triage-heuristic`.
- **Native-hook adapter** (`dist/scripts/copilot-native-hook.js`) — 6-event dispatcher for `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`. preToolUse output mapper forwards `{permissionDecision, permissionDecisionReason}` per Copilot CLI v1.0.40 contract.
- **Hook registration:** per the M2a spike, hooks live at `<projectRoot>/.github/hooks/oh-my-ghcopilot.json` (NOT in plugin manifest — Copilot does not honor a `hooks` field there). `omghc setup` writes this file with both `bash` and `powershell` script entries.
- **`omghc setup --finalize-mcp`** registers OMGHC servers in `~/.copilot/mcp-config.json` with `"command": "omghc"` (relies on global install).
- **`omghc doctor --probe-hooks`** drops a marker hook, fires `copilot --prompt`, asserts firing — canonical mechanism for detecting if Copilot's hook wiring lands in a future release.
- `docs/copilot-native-hooks.md` is the authoritative hook reference.

### M3 — Team runtime (commits `b6770d3`, `dde4d9a`)
- **M3a (`b6770d3`):** Team runtime foundation — 4 state modules (`tasks`, `workers`, `mailbox`, `dispatch`), `worktree`, `tmux-session` (with `'copilot'` worker variant — uses subprocess mode, opposite of OMX's Codex TTY constraint), `worker-bootstrap` (auth env propagation), JSON-envelope `team api` (24 ops). M3a-day-0 spike (`docs/copilot-prompt-mode.md`) **disproved R10**: `copilot -p ... --allow-all-tools --no-color --no-ask-user --no-auto-update` runs headless without a TTY.
- **M3b (`dde4d9a`):** Orchestrator + condensed runtime (~330 LOC vs OMX's 4,752) + phase-controller + role-router + `omghc team` CLI + `omghc hud --watch` + **`omghc continue` (Stop-event redesign)**. Because Copilot has no `Stop` event, `sessionEnd` writes resume hints to `.omghc/state/<mode>-resume-hint.json` for active non-terminal modes; `omghc continue` reads and re-spawns.
- 151+ tests passing across the cumulative test suite.
- Coverage targets met on `src/team/` and `src/state/`.

### M4 — Plugin packaging + docs (this release)
- `plugins/oh-my-ghcopilot/{plugin.json, .mcp.json, agents/, skills/}` with required Copilot fields and contributions.
- `npm run sync:plugin` mirrors `skills/`, `prompts/` (as agents), `agents/` into the plugin dir; `--check` mode for CI parity.
- `npm run verify:plugin-bundle` validates `plugin.json` schema, `.mcp.json` schema, and catalog/file parity.
- `npm prepack` runs `build → sync:plugin → verify:plugin-bundle`.
- `omghc notify` posts to Slack/Discord webhooks via `OMGHC_NOTIFY_SLACK_WEBHOOK` / `OMGHC_NOTIFY_DISCORD_WEBHOOK`.
- Documentation: `README.md`, `DEMO.md`, `docs/getting-started.md`, `docs/skills.md`, `docs/integrations.md`, `docs/auth.md`, `docs/copilot-native-hooks.md`, `docs/copilot-prompt-mode.md`.
- CI matrix on Linux + macOS + Windows; `npm publish --dry-run` clean.

---

## What's included

- **21 skills + 33 prompts** ported from OMX with rename pass (Codex → Copilot, omx → omghc).
- **4 stdio MCP servers** (`omghc_state`, `omghc_memory`, `omghc_trace`, `omghc_wiki`). `omghc_code_intel` is deferred to v0.2.x.
- **5 hook modules** wired through a 6-event native-hook adapter, registered at `<projectRoot>/.github/hooks/oh-my-ghcopilot.json`. **(Forward-compat — hooks do not yet fire in Copilot CLI v1.0.40 production binary; see Known Issues.)**
- **tmux/psmux team runtime** with subprocess Copilot workers (no TTY required). Cross-CLI optional: workers can be `copilot`, `claude`, `gemini`, or `codex`.
- **`omghc team` CLI** for parallel execution (`omghc team N:role "task"`, plus `status|resume|shutdown|api`).
- **`omghc continue` Stop-event redesign** (sessionEnd-based resume hint for Ralph/ultrawork/team continuation, since Copilot has no `Stop` event).
- **`omghc hud --watch`** team status display.
- **151+ tests passing** across CLI, MCP, hooks, team runtime, and state modules.

### CLI surface
```
omghc setup [--plugin|--legacy] [--merge-agents] [--finalize-mcp]
omghc doctor [--probe-hooks]
omghc list [--json]
omghc state {read|write|clear|list}
omghc wiki {list|query|lint|refresh}
omghc trace {summary|timeline}
omghc team N:role "task" | team {status|resume|shutdown|api}
omghc hud --watch
omghc continue
omghc notify --message <text> --target <slack|discord|all>
omghc mcp-serve <server-name>
omghc cancel | status | reasoning {low|medium|high|xhigh}
omghc update | uninstall | version | help
```

---

## Known issues

- **Hooks do not fire in Copilot CLI v1.0.40.** The hook schema validates and the processor registers correctly, but the wiring from `Session.hooks` to `preToolsExecution` is incomplete in the production binary. OMGHC is built **forward-compat**: when Copilot ships the wiring, hooks will fire automatically with no OMGHC change required. The canonical detection mechanism is `omghc doctor --probe-hooks` (PASS = wiring landed; FAIL = expected today). Until then, **`omghc continue` is the manual workaround** for session-end continuation flows that OMX would have handled via the `Stop` event.
- **`copilot plugin install` does not accept local paths.** It only accepts `owner/repo`, marketplace IDs, and archive URLs. For now, OMGHC is delivered via `npm install -g oh-my-ghcopilot` (the binary is on `PATH`; `omghc setup` wires `~/.copilot/`). The `plugins/oh-my-ghcopilot/` directory is an internal mirror, ready for a marketplace listing in v0.2.x.
- **Windows is a secondary platform** (psmux). WSL2 is recommended for the team runtime; CLI subcommands work natively on Windows but tmux/psmux behavior on bare Windows has known sharp edges inherited from OMX.
- **Rust crates deferred to v1.x.** OMX's 5 Rust crates (`omx-explore`, `omx-mux`, `omx-runtime-core`, `omx-runtime`, `omx-sparkshell`) are NOT ported in v0.1.0. TS-only sparkshell shim is ~5–10× slower than Rust on hot paths; acceptable because LLM latency dominates Copilot workflows.
- **`omghc_code_intel` MCP server deferred.** LSP-parity code-intel is on the v0.2.x roadmap.
- **18 advanced skills deferred** (`ultrawork`, `ultraqa`, `swarm`, `autoresearch`, `frontend-ui-ux`, `web-clone`, `visual-ralph`, `visual-verdict`, `deepsearch`, `ecomode`, `configure-notifications`, `ask-claude`, `ask-gemini`, `security-review`, `skill`, `trace`, `review`, plus i18n READMEs).

---

## Auth

OMGHC uses Copilot CLI's documented auth model. Env-var precedence (per the M1a auth spike):

1. `COPILOT_GITHUB_TOKEN` (highest precedence)
2. `GH_TOKEN`
3. `GITHUB_TOKEN`

First non-empty wins. Alternatively, `copilot login` populates `${COPILOT_HOME:-~/.copilot}/config.json` `loggedInUsers` array. `omghc doctor` verifies one of these is present and never prints token contents. Supported tokens: fine-grained PAT with "Copilot Requests" permission, or OAuth tokens from the Copilot CLI app or `gh` CLI app. Classic `ghp_*` PATs are not supported.

For BYOK mode (`COPILOT_PROVIDER_BASE_URL` set), doctor notes the mode but does not require GitHub auth.

See **`docs/auth.md`** for the authoritative auth model, mixed-CLI worker auth (Codex/Claude/Gemini), and CI patterns.

---

## Acknowledgments

OMGHC is a structural port of [`oh-my-codex`](https://github.com/yeachan-heo/oh-my-codex) (OMX) v0.15.1, originally authored by **Yeachan Heo and contributors**. OMX inherited ~7 months of multi-maintainer work to mature its claim-safe task lifecycle, Korean IME drift fixes, BusyBox/Windows psmux fixes, and 297-test invariant suite. OMGHC inherits that foundation through verbatim port + rename pass; attribution is preserved in skill and prompt headers, in `CONTRIBUTING.md`, and in this release.

License: **MIT**, matching OMX.

---

## Disclaimer

OMGHC is an **independent project** and is **not affiliated with GitHub or Microsoft**. "GitHub Copilot CLI" is a product of GitHub, Inc.; OMGHC is a third-party harness layer that targets its plugin/extension surface. The naming "ghcopilot" reflects the target CLI; if GitHub objects, the rename surface is mechanical (see plan §3 and the `npm run rename:port` tooling).

---

## Install

```sh
npm install -g oh-my-ghcopilot
omghc setup
omghc doctor
```

Next steps: see `README.md` quickstart, `DEMO.md` for end-to-end flows, and `docs/getting-started.md` for the full guide.
