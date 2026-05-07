# Changelog

All notable changes to `oh-my-ghcopilot` are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

(no unreleased changes)

## [0.2.0] — 2026-05-07

Skill expansion (ε scope per `.omc/plans/2026-05-07-v0.2.0-skill-expansion.md`): 14 new skills ported from OMX, raising the bundled catalog from 21 → 35 skills. No CLI subcommand changes; all activate via `$keyword` in Copilot sessions.

### Added — quick wins (Wave 1)
- `$swarm` — compatibility alias for `$team`
- `$review` — alias for `$plan --review`
- `$ralph-init` — initialize a PRD that `$ralph` can iterate against
- `$ecomode` — token-efficient model routing modifier (combines with execution modes)
- `$deepsearch` — thorough codebase search mode with synthesis output
- `$trace` — agent flow timeline + summary (uses `omghc_trace` MCP)
- `$security-review` — OWASP Top 10 audit + secrets / dependency scan
- `$ask-claude` — second-opinion advisor via local `claude` CLI; artifacts at `.omghc/artifacts/`
- `$ask-gemini` — second-opinion advisor via local `gemini` CLI; artifacts at `.omghc/artifacts/`
- `$configure-notifications` — Slack/Discord webhook setup wizard (env-var driven; pairs with `omghc notify`)
- `$skill` — meta-skill for managing user/project local skills (`~/.copilot/skills/`, `<proj>/.copilot/skills/`)

### Added — killer features (Wave 2)
- `$autoresearch` — stateful validator-gated research loop with artifact-gated completion (mission-validator-script or prompt-architect-artifact mode); state persists in `.omghc/state/autoresearch-state.json`
- `$ultrawork` — parallel execution engine (component, not standalone persistence mode); pairs with `$ralph` and team runtime
- `$ultraqa` — autonomous QA cycling (qa-tester → architect → fix → repeat) with `--tests`/`--build`/`--lint`/`--typecheck`/`--custom` goal modes, max 5 cycles

### Changed
- `src/hooks/keyword-detector.ts`: added `autoresearch` to `KeywordIntent` type and `KEYWORD_DEFINITIONS` (priority 7). `ultrawork`/`ultraqa` were already present from M3.
- `templates/instructions.md.tmpl`: added 14 new skill mentions organized by category (Planning / Execution / Quality / External advisors / Modifiers / Utilities).

### Tests
- 304/304 passing (added 2 keyword-detector tests for `$autoresearch` + bumped `list.test.ts` skill count assertions 21 → 35).

### Forward-compat notes
- Each killer feature includes a forward-compat note about R-hooks-not-wired (file-based hooks don't fire in Copilot CLI v1.0.40). Until Copilot wires hook execution, run `omghc continue` manually after session restart, or re-invoke the skill to resume from persisted state.

### Excluded from this release
- `web-clone` skill (HARD DEPRECATED upstream in OMX; "do not start new work")
- Visual track (`frontend-ui-ux`, `visual-ralph`, `visual-verdict`) — γ scope, deferred to v0.2.1
- Rust crates port, `omghc_code_intel` MCP server, OMX→OMGHC sync tooling, i18n READMEs — deferred to v0.3.x

## [0.1.1] — 2026-05-07

### Removed
- Eight unimplemented stub subcommands removed from CLI: `cancel`, `reasoning`, `exec`, `explore`, `question`, `agents-init`, `tmux-hook`, `hooks`. Typing these now returns "unknown subcommand" (exit 2) instead of the misleading "not implemented yet (planned for M2+)" (exit 0). They were never advertised in user-facing docs; the entries were vestigial OMX subcommand names that don't apply to Copilot CLI.

### Fixed
- `omghc status` was hardcoded to print "No active modes" with a stale note claiming "Mode tracking will be available in M2." M2 shipped in commit `065626a`; status now reads real mode state via `stateListActive()` from `src/state/operations.ts` and prints active modes (or "No active modes" honestly).
- `omghc help` no longer labels commands as "M0 stubs" or lists the eight removed stub subcommands. Help text now reflects shipped surface only.
- README "Subcommands" table dropped `omghc cancel` from the "Standard utilities" row (was misleading; `cancel` was always a stub).
- README header status line updated from "v0.1.0-pre — functional, not yet published" to "v0.1.0 — published on npm" (with link).

### Tests
- **136 new tests** added; cumulative suite: **302/302 passing** (was 166).
- New test files: `cli/state.test.ts` (19 tests), `cli/wiki.test.ts` (21), `cli/trace.test.ts` (15), `cli/notify.test.ts` (28), `team/runtime.test.ts` (24), `team/orchestrator.test.ts` (27).
- Exposed `_internals` test seam on `src/team/runtime.ts` and `src/team/orchestrator.ts` (matches existing pattern in `src/cli/notify.ts` and `src/cli/continue.ts`).

### Coverage
- `src/state/operations.js`: **97.37%** lines (M3 acceptance ≥78% met for `src/state/`).
- `src/team/state/` aggregate: **86.76%** lines (was 51.78% per pre-cleanup memory; the prior coverage supplement commit `857e53b` already pushed this above target — original v0.1.x defect resolved before this session).
- CLI handlers: `state.js` 100%, `trace.js` 100%, `wiki.js` 97.87%, `notify.js` 82.93% (was 14.73% / 19.63% / 14.89% / 25.20% respectively).
- `src/team/runtime.js`: **47.18%** (was 4.57%) — pure logic and validation paths covered; the main loop and orchestrator wiring remain integration-only.
- `src/team/orchestrator.js`: **48.48%** (was 5.71%) — same shape: pure helpers and validation entry paths covered; subprocess/tmux paths integration-only.
- All-files aggregate moved 45.86% → 50.95% lines (75.59% branches).
- **Strict M3 acceptance ("≥78% lines on `src/team/` AND `src/state/`")**: met for `src/state/` and for `src/team/state/`; not met for the broader `src/team/` directory (`tmux-session.js`, `worker-bootstrap.js` remain at ~10% — these are subprocess/tmux IPC modules requiring integration mocking, deferred to v1.x).

### Documentation
- Created `CHANGELOG.md` (this file).
- Plan doc (`.omc/plans/2026-05-05-port-omx-to-copilot.md`) bumped to v2.7 with v0.1.0 SHIPPED entry; M4 line 351 acceptance reconciled with `R-plugin-install-no-local` (`copilot plugin install` rejects local paths — plugin bundle is forward-compat for v0.2.x marketplace listing).

## [0.1.0] — 2026-05-06

Initial release. TypeScript port of [oh-my-codex (OMX)](https://github.com/Yeachan-Heo/oh-my-codex) v0.15.1, targeting GitHub Copilot CLI instead of OpenAI Codex CLI.

### Added
- **21 skills** ported from OMX: `ralph`, `ralplan`, `team`, `deep-interview`, `autopilot`, `plan`, `code-review`, `tdd`, `doctor`, `omghc-setup`, `worker`, `pipeline`, `hud`, `wiki`, `cancel`, `help`, `note`, `git-master`, `analyze`, `build-fix`, `ai-slop-cleaner`.
- **33 role prompts** ported as Copilot agent markdown (`agents/*.agent.md` with YAML frontmatter).
- **4 stdio MCP servers**: `omghc_state`, `omghc_memory`, `omghc_trace`, `omghc_wiki`. Reachable via `omghc mcp-serve <name>`.
- **5 hook modules** (forward-compat): `keyword-detector`, `agents-overlay`, `session`, `prompt-guidance-contract`, `triage-heuristic`. File-based hooks do not yet fire in Copilot CLI v1.0.40 production binary; OMGHC builds for the wiring to ship in a future release.
- **6-event native-hook adapter** (`sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`); registers at `<gitRoot>/.github/hooks/oh-my-ghcopilot.json` (per the M2a spike, hooks live in the project, not the plugin manifest).
- **Stop-event redesign** via `sessionEnd` + persisted resume hint + `omghc continue` wrapper. Copilot CLI has no `Stop` event; OMGHC's `omghc continue [--list|--mode|--clear]` reads `<wd>/.omghc/state/<mode>-resume-hint.json` and re-launches the recorded `resume_command`.
- **Tmux/psmux team runtime** with subprocess Copilot workers (no TTY required) — the inverse of OMX's Codex constraint, confirmed by the M3a spike (`docs/copilot-prompt-mode.md`). Cross-CLI optional: workers can be `copilot`, `codex`, `claude`, or `gemini` via `OMGHC_TEAM_WORKER_CLI_MAP`.
- **CLI surface**: `omghc {setup, doctor, list, uninstall, update, mcp-serve, state, wiki, trace, team, hud, continue, notify, version, help, status}`. `setup --finalize-mcp` registers OMGHC servers in `~/.copilot/mcp-config.json`. `doctor --probe-hooks` is the canonical detection mechanism for hook wiring (PASS = wiring landed; FAIL = expected today).
- **Plugin packaging**: `npm run sync:plugin` mirrors canonical `skills/`/`prompts/`/`agents/` into `plugins/oh-my-ghcopilot/`; `npm run verify:plugin-bundle` parity test; `npm prepack` runs `build → sync:plugin → verify:plugin-bundle`.
- **Documentation**: `README.md`, `DEMO.md`, `docs/{getting-started,skills,integrations,auth,copilot-native-hooks,copilot-prompt-mode}.md`, `RELEASE_BODY.md`.
- **CI matrix**: Linux + macOS + Windows; `.gitattributes` enforces LF on text files to prevent Windows line-ending drift.
- **166 tests passing** across CLI, MCP, hooks, team runtime, state modules, and orchestrator.

### Known issues
- **File-based hooks DO NOT FIRE in Copilot CLI v1.0.40 production binary.** Schema validates and processor registers, but the bridge from `Session.hooks` to `preToolsExecution` is incomplete. OMGHC is forward-compat; when the wiring lands, hooks activate automatically with no code change. Probe with `omghc doctor --probe-hooks`.
- **`copilot plugin install` does not accept local paths** (only `owner/repo`, marketplace, archive URLs). OMGHC is delivered via `npm install -g oh-my-ghcopilot`; the `plugins/oh-my-ghcopilot/` bundle is forward-compat for a marketplace listing in v0.2.x.
- **Coverage on `src/team/state/` is 51.78%** (M3 acceptance target was ≥78%). Captured as v0.1.x defect; mechanical follow-up.
- **Windows is a secondary platform** (psmux). WSL2 is recommended for the team runtime; CLI subcommands work natively on Windows but psmux team behavior on bare Windows has known sharp edges inherited from OMX.
- **18 advanced skills deferred** to v0.2.x: `ultrawork`, `ultraqa`, `swarm`, `autoresearch`, `frontend-ui-ux`, `web-clone`, `visual-ralph`, `visual-verdict`, `deepsearch`, `ecomode`, `configure-notifications`, `ask-claude`, `ask-gemini`, `security-review`, `skill`, `trace`, `review`.
- **5 Rust crates deferred** to v1.x: `omx-explore`, `omx-mux`, `omx-runtime-core`, `omx-runtime`, `omx-sparkshell`. TS-only sparkshell shim is ~5–10× slower than Rust on hot paths; acceptable because LLM latency dominates Copilot workflows.
- **`omghc_code_intel` MCP server deferred** to v0.2.x (LSP-parity code-intel).

### Acknowledgments
OMGHC is a structural port of OMX, originally authored by Yeachan Heo and contributors, also licensed under MIT. Skill and prompt content is ported with attribution preserved in file headers.

[Unreleased]: https://github.com/andyzengmath/oh-my-copilot/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/andyzengmath/oh-my-copilot/releases/tag/v0.2.0
[0.1.1]: https://github.com/andyzengmath/oh-my-copilot/releases/tag/v0.1.1
[0.1.0]: https://github.com/andyzengmath/oh-my-copilot/releases/tag/v0.1.0
