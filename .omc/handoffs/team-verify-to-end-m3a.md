## Handoff: team-verify → end (M3a complete)

- **Decided**: M3a foundation passes. 10/10 tasks done, 111/111 cumulative tests pass, build clean.
- **Spike-driven decisions baked in**:
  - **Subprocess-mode workers (NOT interactive-tmux):** `copilot -p "<prompt>" --allow-all-tools --no-color --no-ask-user --no-auto-update`. Confirmed via 2 live probes — TTY NOT required. Opposite of OMX's Codex constraint (`runtime.ts:1347` `PROMPT_MODE_CODEX_UNSUPPORTED_REASON`).
  - **Auth: cached login at `~/.copilot/` is sufficient.** Env vars `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN` propagated from leader → worker but no per-worker handshake.
  - **JSON output mode supported:** `--output-format json` emits JSONL with terminal `result` event (`exitCode`, `usage`).
  - Doc: `docs/copilot-prompt-mode.md` (canonical reference).

- **Files (M3a deliverables):**
  - `src/team/state/tasks.ts` — claim-safe lifecycle (7 exports + types; UUID IDs, atomic tmp+rename writes, advisory `.lock`)
  - `src/team/state/workers.ts` — heartbeat tracking (7 exports; default 90s stale threshold)
  - `src/team/state/mailbox.ts` — inter-worker messaging (5 exports; broadcast skips sender)
  - `src/team/state/dispatch.ts` — dispatch lifecycle (6 exports)
  - `src/team/worktree.ts` — git worktree mgmt (7 exports; `--no-pager`, `--no-ff`, sanitized names, ~330 LOC)
  - `src/team/tmux-session.ts` — foundation (TeamWorkerCli union with `'copilot'` added, SUPPORTED_WORKER_CLIS, isWorkerCli, defaultWorkerCli, translateWorkerLaunchArgsForCli, pane primitives; cross-platform tmux/psmux; ~270 LOC)
  - `src/team/worker-bootstrap.ts` — auth resolution + bootstrap plan (3 exports)
  - `src/team/api.ts` — JSON envelope CLI dispatcher (24 operations, zod schemas, wired into `omghc team api ...`)
  - `docs/copilot-prompt-mode.md` — spike output (recommendations + observations)

- **Tests added (17, total 111):**
  - `src/team/state/__tests__/tasks.test.ts` (6)
  - `src/team/state/__tests__/workers.test.ts` (3)
  - `src/team/state/__tests__/mailbox.test.ts` (4)
  - `src/team/__tests__/worktree.test.ts` (4 — uses `git init --initial-branch=main` in tmpdir; `t.skip` if git unavailable)

- **Verification results:**
  - `npm run build` → clean
  - 111/111 tests pass: 6 smoke + 10 generator + 9 reader + 7 setup + 8 doctor + 4 list + 10 state-server + 14 memory-server + 8 keyword-detector + 6 agents-overlay + 3 setup-hooks + 3 finalize-mcp + 2 probe-hooks + 4 native-hook + 6 tasks-state + 3 workers-state + 4 mailbox + 4 worktree
  - 0 lead corrections during verify; workers' output passed all spot-checks

- **Lead-led task closures during M3a (silent-completion pattern continued):**
  - worker-3 #3, #4 — files on disk, lead marked done after grep verification
  - worker-4 #6 — file on disk, lead marked done after worker confirmed
  - worker-5 #8 — file on disk, lead marked done after grep verification
  - worker-1 #1 had a productive ~30 min spike with concrete observations, marked complete on first message

- **Plan implications now realized:**
  - R10 (`copilot --prompt` TTY) DISPROVEN — subprocess mode works. Plan v2.x R10 should be DOWNGRADED to LOW (not blocking).
  - §M3 day-0 spike COMPLETE per plan acceptance criteria.
  - No `Stop` event still confirmed (per M2a) — Ralph continuation redesign is M3b scope.

- **Remaining (next phase — M3b):**
  - `src/team/runtime.ts` (4,752-LOC port — primary tech-debt liability; consider splitting into ≤500-LOC modules)
  - Orchestrator: `src/team/orchestrator.ts`
  - Policies: `src/team/{delegation,allocation,rebalance}-policy.ts`
  - Phase controller: `src/team/phase-controller.ts`
  - Role router: `src/team/role-router.ts`
  - Repo-aware decomposition: `src/team/repo-aware-decomposition.ts`
  - Model contract: `src/team/model-contract.ts`
  - `omghc team` CLI subcommand
  - `omghc hud` CLI subcommand + `src/hud/{index,tmux,state,constants}.ts`
  - Stop-event redesign: `sessionEnd` hook + persisted re-invocation hint + `omghc continue` wrapper
  - Tests: api dispatcher + bootstrap + tmux-session translation + orchestrator + phase-controller (≥20 new tests)
  - Coverage threshold: ≥78% lines on `src/team/` and `src/state/`

- **Remaining (M4):**
  - Plugin packaging final: `npm run sync:plugin`, `verify:plugin-bundle`, `prepack` lifecycle
  - Notification routing
  - Documentation polish (`README.md`, `DEMO.md`, `docs/getting-started.md`, `docs/skills.md`, `docs/integrations.md`)
  - CI matrix green Linux+macOS+Windows
  - `npm publish --dry-run` verification
