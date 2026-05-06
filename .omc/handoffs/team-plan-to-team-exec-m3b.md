## Handoff: team-plan → team-exec (M3b — orchestrator + runtime + CLI + hud + Stop-event)

- **Decided**: Last piece of M3 — orchestrator, runtime, omghc team CLI, omghc hud, Stop-event redesign. **Scope tightly** to avoid the OMX 4,752-LOC runtime.ts becoming an overrun. Build "just enough for v0.x end-to-end team execution"; defer rebalance + repo-aware-decomposition + model contract subtleties to v1.x.
- **Rejected**: Full verbatim port of OMX runtime.ts. The OMX file is 4,752 LOC of mature edge-case handling. Porting verbatim risks weeks of work and inheriting OMX bugs. Pragmatic v0.x: ~500-800 LOC condensed runtime that exercises the M3a foundation (state ops, tmux-session, worker-bootstrap, api) end-to-end.
- **Risks**:
  - **HIGH:** runtime.ts scope creep. Workers must be told "minimal viable runtime, not OMX parity". Defer OMX's `rebalance-policy.ts`, `repo-aware-decomposition.ts`, `model-contract.ts`.
  - **MEDIUM:** Stop-event redesign needs new design (no precedent in OMX). Lead provides design in task spec; worker implements.
  - **MEDIUM:** `omghc team` CLI is the user-facing surface. Must work end-to-end (spawn workers, dispatch tasks, shutdown) before M3 is "done".
  - **LOW:** HUD is a polish feature; can be minimal in M3b.

- **Reference**:
  - OMX `src/team/{runtime,orchestrator,phase-controller,role-router}.ts` (heavily edit/condense; do NOT verbatim-port)
  - OMX `src/team/{delegation,allocation,rebalance}-policy.ts` (port delegation only; defer the others)
  - OMX `src/cli/team.ts` (port `omghc team` CLI surface)
  - OMX `src/hud/*.ts` (minimal port)
  - `docs/copilot-prompt-mode.md` (worker invocation pattern)
  - M3a foundation modules: state, tmux-session, worker-bootstrap, api

- **Task plan (10 tasks, 5 workers)**:

| ID | Task | Owner | Depends |
|----|------|-------|---------|
| 1 | `src/team/orchestrator.ts` (~300-500 LOC condensed: spawn N workers via tmux + bootstrap, monitor heartbeats, dispatch tasks via `state/dispatch.ts`, detect stale workers, run claim-safe lifecycle) | worker-1 | — |
| 2 | `src/team/phase-controller.ts` (~150-250 LOC: simple state machine `planning → execution → verify → cleanup`; expose `getCurrentPhase`, `transitionPhase`, `onPhaseChange`) | worker-2 | — |
| 3 | `src/team/role-router.ts` (~150 LOC: assign tasks to workers by role string; round-robin within role pool; respects task `blockedBy`) | worker-2 | — |
| 4 | `src/team/runtime.ts` CONDENSED (~500-800 LOC: leader's main loop. Uses orchestrator/phase-controller/role-router. Implements team-plan → team-exec → team-verify → team-fix loop. **DEFER:** rebalance, repo-aware-decomposition, model-contract.) | worker-3 | 1, 2, 3 |
| 5 | `src/cli/team.ts` (`omghc team N:role "task"`, `omghc team status <name>`, `omghc team resume <name>`, `omghc team shutdown <name>`, `omghc team api <op> --input <json>`) + dispatcher rewire to register `team` subcommand | worker-4 | 4 (calls runtime) |
| 6 | `src/hud/{index,tmux,state,constants}.ts` + `omghc hud` subcommand (minimal: `--watch` polls team state every 5s and prints status table; `--json` outputs JSON) + dispatcher rewire | worker-4 | 4 |
| 7 | `omghc continue` wrapper + sessionEnd-hook integration: when `sessionEnd` fires (per `docs/copilot-native-hooks.md`), the native hook adapter writes a "resume hint" to `.omghc/state/<mode>-resume-hint.json`. New `omghc continue` reads the hint and re-launches whatever was active (ralph, ultrawork, etc.). This replaces OMX's Stop-event semantics. | worker-5 | — |
| 8 | Update `src/scripts/copilot-native-hook.ts` to write resume hints on `sessionEnd` (per #7's design). | worker-5 | 7 |
| 9 | Tests: orchestrator + phase-controller + role-router + omghc team smoke (≥10 tests) | worker-5 (after #4) | 4 |
| 10 | Tests: omghc continue + sessionEnd hint integration (≥4 tests) | worker-5 (after #8) | 7, 8 |

**Worker distribution:**
- worker-1: #1 orchestrator
- worker-2: #2 phase-controller + #3 role-router
- worker-3: #4 runtime.ts (the big one)
- worker-4: #5 omghc team CLI + #6 hud
- worker-5: #7 continue + #8 hook update + #9 tests + #10 tests (heavy; will iterate)

- **CRITICAL reminders for workers**:
  - Build for v0.x MVP, NOT OMX parity. Defer features OMX has but v0.x doesn't need.
  - Use M3a modules: `import { listAliveWorkers } from "../team/state/workers.js"`, etc.
  - Subprocess workers via `worker-bootstrap.buildBootstrapPlan()`. NOT interactive tmux send-keys for prompt.
  - Auth: `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` per `docs/auth.md`.
  - Hooks don't fire in v1.0.40 production binary. Build for forward-compat.

- **Remaining (next phase — M4 polish)**:
  - Plugin packaging final: `npm run sync:plugin`, `verify:plugin-bundle`, `prepack` lifecycle
  - Notification routing (Slack/Discord)
  - Documentation (`README.md`, `DEMO.md`, `docs/getting-started.md`, `docs/skills.md`, `docs/integrations.md`)
  - CI matrix green on Linux + macOS + Windows
  - `npm publish --dry-run` shows expected file list
  - Coverage thresholds: ≥78% lines on `src/team/` and `src/state/`
