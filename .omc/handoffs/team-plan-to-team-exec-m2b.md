## Handoff: team-plan → team-exec (M2b — hook layer + finalize-mcp + plugin manifests + probe-hooks)

- **Decided**: M2b ships the **last** piece of M2 — hook ports (forward-compat only), `copilot-native-hook.ts` adapter, plugin manifests, `omghc setup --finalize-mcp` functional, `omghc doctor --probe-hooks`. M2a's spike output is the design reference.
- **Rejected**: Building hooks that "should fire" and then live-testing them. **Hooks DO NOT FIRE in v1.0.40 production binary** (M2a finding). M2b builds for forward-compat ONLY. Tests must NOT depend on Copilot actually invoking hooks; they exercise the adapter logic directly.
- **Risks**:
  - **HIGH:** workers may try to "fix" the not-wired-hooks issue and waste cycles. Reinforce in worker prompts: "Build for forward-compat. Do NOT attempt to make Copilot fire hooks."
  - **MEDIUM:** `omghc setup` extension touches `<projectRoot>/.github/hooks/` — that path is project-local, not user-home. Setup must NOT write to `~/.copilot/.github/hooks/` (that's wrong by 2 dimensions).
  - **MEDIUM:** `omghc doctor --probe-hooks` requires invoking `copilot --prompt "list files"` — but this needs `GH_TOKEN`/auth. In CI without auth, the probe should report `inconclusive` rather than `fail`. Document this in the doctor task.
  - **LOW:** plugin manifest does NOT have a `hooks` field. Workers must NOT attempt to register hooks via `plugin.json`.

- **Reference**:
  - `docs/copilot-native-hooks.md` — canonical zod schema, per-event stdin/stdout, 10 OMGHC implications
  - `src/mcp/bootstrap.ts` `generateMcpConfig()` — for #7 finalize-mcp
  - OMX source for hook ports: `oh-my-codex/src/hooks/{keyword-detector,agents-overlay,session,prompt-guidance-contract,triage-heuristic}.ts`

- **Task plan (10 tasks, 5 workers)**:

| ID | Task | Owner | Depends |
|----|------|-------|---------|
| 1 | Port `src/hooks/keyword-detector.ts` (detects `$ralph`, `$team`, `$ralplan`, `$deep-interview`, `$autopilot` keywords from user prompt). | worker-1 | — |
| 2 | Port `src/hooks/agents-overlay.ts` + `src/hooks/session.ts` (overlay AGENTS.md content, session lifecycle tracking). | worker-2 | — |
| 3 | Port `src/hooks/prompt-guidance-contract.ts` + `src/hooks/triage-heuristic.ts`. | worker-3 | — |
| 4 | `src/scripts/copilot-native-hook.ts` (6-event stdin/stdout dispatcher; reads JSON event, dispatches to OMGHC plugin runtime, writes JSON response). | worker-4 | 1, 2, 3 |
| 5 | `plugins/oh-my-ghcopilot/{plugin.json, .mcp.json}` (plugin.json has NO `hooks` field per spike; .mcp.json registers the 4 OMGHC MCP servers). | worker-1 | — |
| 6 | Extend `src/cli/setup.ts` to write `<projectRoot>/.github/hooks/oh-my-ghcopilot.json` with dual bash/powershell entries pointing to `dist/scripts/copilot-native-hook.js`. | worker-2 | 4 |
| 7 | Make `omghc setup --finalize-mcp` functional: read `~/.copilot/mcp-config.json` (preserve user entries), merge `generateMcpConfig()` output, write back. | worker-3 | — |
| 8 | `omghc doctor --probe-hooks` flag: drop a marker hook into `<projectRoot>/.github/hooks/`, fire `copilot --prompt "list files"` via spawnSync, assert marker fired. PASS = wiring shipped; FAIL = expected on v1.0.40; INCONCLUSIVE = no auth available. | worker-4 | 4, 6 |
| 9 | Tests: `src/hooks/__tests__/{keyword-detector,agents-overlay}.test.ts` (function-level, ≥6 each). | worker-5 | 1, 2 |
| 10 | Tests: setup hook-write + finalize-mcp + doctor probe-hooks + native-hook-adapter (combined ≥10 tests across 4 areas). | worker-5 | 4, 6, 7, 8 |

- **Remaining (next phase — M3)**:
  - `src/team/runtime.ts` (4,752-LOC port — primary tech-debt liability)
  - 79-file team runtime port (orchestrator, tmux-session with `'copilot'` worker variant added, worker-bootstrap with auth env propagation, mailbox, dispatch, state, policies, phase-controller, role-router, repo-aware-decomposition, model-contract, api)
  - `omghc team` CLI subcommand
  - `omghc hud` CLI subcommand
  - M3 day-0 spike: validate `copilot --prompt` headless behavior (R10) — TTY required? exit code? streaming?
  - Worker auth (§A.3): GH_TOKEN propagation from leader to tmux pane workers
  - Cross-CLI worker support (D8): `'copilot'` variant added to `TeamWorkerCli` enum + `translateWorkerLaunchArgsForCli` Copilot branch
  - Stop-event redesign (per M2a R-no-stop-event): Ralph continuation via `sessionEnd` hook + persisted hint + `omghc continue` wrapper

- **Remaining (next phase — M4)**:
  - Plugin packaging final: `npm run sync:plugin` mirror script, `npm run verify:plugin-bundle` parity test, `prepack` lifecycle, `copilot plugin install` smoke test (note: only works with marketplace/owner-repo paths, not local — may need to publish to a test marketplace or use file copy)
  - Slack/Discord notification routing
  - Documentation (`README.md`, `DEMO.md`, `docs/getting-started.md`, `docs/skills.md`, etc.)
  - Coverage thresholds + CI matrix green
