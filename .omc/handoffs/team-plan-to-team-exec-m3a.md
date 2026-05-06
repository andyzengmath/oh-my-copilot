## Handoff: team-plan → team-exec (M3a — team runtime foundation)

- **Decided**: M3 is the largest phase (4,752-LOC `runtime.ts` + 79 team files). Split: M3a foundation (day-0 spike + tmux-session with copilot variant + worker-bootstrap + git worktree + state ops + api skeleton + tests). M3b (orchestrator + policies + phase-controller + role-router + Stop-event redesign + omghc team CLI + omghc hud CLI) follows.
- **Rejected**: One-shot M3 — too large. Day-0 spike output (whether `copilot --prompt` is TTY-required) reshapes M3b's worker model significantly.
- **Risks**:
  - **HIGH (R10):** `copilot --prompt` may require TTY (matching Codex precedent at OMX `runtime.ts:1347-1361` `PROMPT_MODE_CODEX_UNSUPPORTED_REASON`). If yes, OMGHC team workers must use interactive tmux panes (the OMX-Codex pattern) instead of subprocess workers. Spike validates.
  - **HIGH (R-no-stop-event from M2a):** No `Stop` event exists in Copilot's hooks. Ralph continuation cannot port verbatim. Design alternative: `sessionEnd` hook + persisted hint + `omghc continue` wrapper (defer detailed design to M3b).
  - **MEDIUM (R-auth from M1a):** Worker tmux panes inherit leader's `GH_TOKEN`/`GITHUB_TOKEN`. Worker bootstrap must validate auth-env presence before spawning `copilot`.
  - **MEDIUM (D8 cross-CLI):** Adding `'copilot'` to `TeamWorkerCli = 'codex' | 'claude' | 'gemini'` in tmux-session.ts:88 + `translateWorkerLaunchArgsForCli` Copilot branch (~20-30 LOC). Real cost, not free.
  - **MEDIUM (Windows psmux):** Windows secondary; recommend WSL2 in docs.

- **Reference**:
  - OMX `src/team/{runtime,tmux-session,worker-bootstrap,worktree,api}.ts`
  - OMX `src/team/state/{tasks,workers,mailbox,dispatch}.ts`
  - `docs/auth.md` (auth env precedence)
  - `docs/copilot-native-hooks.md` (Stop-event absence)
  - Plan §M3 acceptance criteria

- **Task plan (10 tasks, 5 workers)**:

| ID | Task | Owner | Depends |
|----|------|-------|---------|
| 1 | **PRIORITY** M3 day-0 spike: `copilot --prompt "echo hi"` headless behavior. Capture: TTY-required? exit code? streaming vs buffered? auth env required? Document in `docs/copilot-prompt-mode.md`. Includes "minimal viable Copilot worker" example. | worker-1 | — |
| 2 | Port OMX `src/team/state/tasks.ts` (claim-safe task lifecycle: create-task → claim-task → transition-task-status → completed/failed/cancelled with version tokens). | worker-2 | — |
| 3 | Port OMX `src/team/state/workers.ts` (worker identity, heartbeat tracking, alive/stale detection). | worker-3 | — |
| 4 | Port OMX `src/team/state/mailbox.ts` (send-message, broadcast, mailbox-list, mailbox-mark-{notified,delivered}). | worker-3 | — |
| 5 | Port OMX `src/team/state/dispatch.ts` (dispatch request lifecycle). | worker-2 | 2 (uses task primitives) |
| 6 | Port OMX `src/team/worktree.ts` (git worktree create/cleanup per worker; sanitize names; check merge conflicts). | worker-4 | — |
| 7 | Port OMX `src/team/tmux-session.ts` foundation: TeamWorkerCli enum (with `'copilot'` added), session/pane management primitives, `translateWorkerLaunchArgsForCli` for Copilot. **DEPENDS ON spike #1** for whether to use subprocess or interactive pane mode. | worker-4 | 1 |
| 8 | Port OMX `src/team/worker-bootstrap.ts` (worker startup script generation, auth env propagation per §A.3, fail-closed on missing auth). | worker-5 | 1, 3 |
| 9 | Port OMX `src/team/api.ts` (JSON envelope CLI: create-task, claim-task, transition-task-status, send-message, broadcast, mailbox-list, etc.). | worker-5 | 2, 3, 4 |
| 10 | Tests: state/tasks + state/workers + state/mailbox + worktree (≥3 each, 12+ total). | worker-1 (after #1) | 2, 3, 4, 6 |

- **Forward-compat reminders for workers**:
  - Hooks don't fire in v1.0.40 (per `docs/copilot-native-hooks.md`). M3 doesn't depend on hook firing — team coordination is state-file based.
  - No `Stop` event. Ralph continuation design is M3b — don't try to design it in M3a.
  - Auth env precedence: `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`. See `docs/auth.md`.

- **Remaining (next phase — M3b)**:
  - `src/team/runtime.ts` (the 4,752-LOC port; primary tech-debt liability — port carefully and consider splitting into ≤500-LOC modules)
  - Orchestrator: `src/team/orchestrator.ts`
  - Policies: `src/team/{delegation,allocation,rebalance}-policy.ts`
  - Phase controller: `src/team/phase-controller.ts`
  - Role router: `src/team/role-router.ts`
  - Repo-aware decomposition: `src/team/repo-aware-decomposition.ts`
  - Model contract: `src/team/model-contract.ts`
  - `omghc team` CLI subcommand (`team N:role "task"`, `team status|resume|shutdown`, `team api ...`)
  - `omghc hud` CLI subcommand
  - Stop-event redesign: `sessionEnd` hook + persisted re-invocation hint + `omghc continue` wrapper
  - HUD module (`src/hud/{index,tmux,state,constants}.ts`)
  - Coverage threshold: ≥78% lines on `src/team/` and `src/state/`
