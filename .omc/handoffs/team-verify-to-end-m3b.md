## Handoff: team-verify → end (M3b complete)

- **Decided**: M3b passes verification. 10/10 tasks done. **151/151 cumulative tests pass** (40 new in M3b: 8 phase-controller + 7 role-router + 8 team CLI smoke + 12 continue + 5 native-hook resume). M3 is now fully shipped.
- **Stop-event redesign successfully implemented**: per M2a finding (no `Stop` event in Copilot's hooks), OMGHC implements `sessionEnd` hook + persisted resume hint + `omghc continue` wrapper. Three pieces: (1) `src/scripts/copilot-native-hook.ts` writes `<wd>/.omghc/state/<mode>-resume-hint.json` on sessionEnd for active non-terminal modes; (2) `src/cli/continue.ts` reads hints and re-launches the recorded `resume_command`; (3) per-mode `resume_command` logic is in the native hook (team uses `omghc team resume <name>`, ralph uses `omghc ralph` with iteration N+1, etc.). This is the key architectural difference from OMX.

- **Files (M3b deliverables):**
  - `src/team/orchestrator.ts` (~460 LOC; spawn N workers via tmux + bootstrap, monitor heartbeats, dispatch tasks, claim-safe lifecycle)
  - `src/team/phase-controller.ts` (~190 LOC; 8 phases, valid-transition table, max fix loop enforcement, listener fan-out, atomic persistence with Windows EPERM/EBUSY/EACCES retry)
  - `src/team/role-router.ts` (~110 LOC; round-robin with index-tied tiebreaks, busy filtering, refreshable)
  - `src/team/runtime.ts` (~330 LOC condensed from OMX 4,752; team-plan→team-exec→team-verify→team-fix loop; defers rebalance/repo-aware-decomp/model-contract)
  - `src/cli/team.ts` (~340 LOC; `omghc team N:role "task"`, `team status|resume|shutdown`, `team api ...`, full --json mode)
  - `src/hud/{constants,state,tmux,index}.ts` + `src/cli/hud.ts` (minimal HUD: status table, --watch, --json, --tmux fallback)
  - `src/cli/continue.ts` (~280 LOC; `omghc continue` Stop-event replacement; --list, --clear, --dry-run, --mode flags)
  - `src/scripts/copilot-native-hook.ts` (extended with sessionEnd resume-hint generation; ~120 LOC added)

- **Tests added (40, total 151):**
  - `src/team/__tests__/phase-controller.test.ts` (8)
  - `src/team/__tests__/role-router.test.ts` (7)
  - `src/cli/__tests__/team.test.ts` (8)
  - `src/cli/__tests__/continue.test.ts` (12)
  - `src/scripts/__tests__/copilot-native-hook-resume.test.ts` (5; subprocess-driven via spawnSync)

- **Verification results:**
  - `npm run build` → clean
  - 151/151 tests pass cumulative
  - 0 lead corrections during verify; workers' output passed all spot-checks
  - `omghc team --help` shows usage; `omghc team api get-summary --input '{...}' --json` returns valid envelope
  - `omghc continue --list` against empty state returns "No active OMGHC mode to continue"
  - `omghc hud --team test --json` returns `{ok:false,error:"team not found"}` cleanly

- **Stop-event redesign details (architectural decision logged for future maintainers):**
  - **Problem:** Copilot CLI v1.0.40 has no `Stop` hook event (M2a finding). OMX uses Stop to detect Ralph/team continuation needs.
  - **Solution (this milestone):** sessionEnd hook + persisted hint + wrapper command.
  - **Flow:** session ends → sessionEnd hook fires → adapter iterates active non-terminal modes → writes `.omghc/state/<mode>-resume-hint.json` per active mode. Next session: user runs `omghc continue` → reads most-recent hint (or by `--mode`) → spawns `resume_command`.
  - **Per-mode resume_command:** team→`omghc team resume <name>`; ralph→`omghc ralph` (iteration N+1); ultrawork/autopilot/ralplan/deep-interview→`omghc <mode>` with appropriate flags.
  - **Skipped modes (NOT_RESUMABLE):** skill-active, autoresearch, ultraqa (intentional; these have transient state).
  - **Caveat:** hooks DO NOT FIRE in Copilot v1.0.40 production binary (per M2a). The redesign is forward-compat. Until Copilot ships hook wiring, users must run `omghc continue` manually rather than have it auto-trigger via sessionEnd.

- **Plan implications:**
  - §M3 fully shipped. M3a + M3b commits: `b6770d3` + (M3b commit pending).
  - R-no-stop-event from M2a is now MITIGATED via the sessionEnd-hint design.
  - R10 (`copilot --prompt` TTY) was DISPROVEN by M3a spike (subprocess mode confirmed working).
  - Next phase: M4 (plugin packaging final + notification routing + docs polish + CI matrix).

- **Remaining (next phase — M4):**
  - Plugin packaging final: `npm run sync:plugin` mirror, `verify:plugin-bundle` parity test, `prepack` lifecycle
  - Notification routing (Slack/Discord) via `omghc notify`
  - Documentation polish: `README.md`, `DEMO.md`, `docs/getting-started.md`, `docs/skills.md`, `docs/integrations.md`, `docs/troubleshooting.md`
  - CI matrix green on Linux + macOS + Windows
  - Coverage thresholds: ≥78% lines on `src/team/` and `src/state/`
  - `npm publish --dry-run` shows expected file list
  - Release readiness: `RELEASE_BODY.md` for v0.1.0
  - `omghc agents-init`, `omghc reasoning`, `omghc tmux-hook`, `omghc cancel`, `omghc question`, `omghc explore`, `omghc exec`, `omghc list` (most existing in M1; verify wiring + polish)

- **Cumulative project state through M3:**
  - 6 milestones shipped: M0, M1 (a+b), M2a, M2b, M3a (M3b commit pending)
  - 7 git commits + 1 pending
  - **151 tests, 100% pass rate**
  - 4 MCP servers + 5 hook modules + native-hook adapter (with sessionEnd) + plugin manifests + 4 team-state modules + worktree mgmt + tmux-session foundation + worker-bootstrap + api dispatcher + orchestrator + phase-controller + role-router + condensed runtime + omghc team CLI + omghc hud CLI + omghc continue + Stop-event redesign on disk
  - All 3 spikes complete (auth, hooks.json schema, copilot --prompt headless)
  - Plan v2.4 reflects all 6 milestone learnings
