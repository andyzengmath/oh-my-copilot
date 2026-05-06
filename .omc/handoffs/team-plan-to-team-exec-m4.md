## Handoff: team-plan → team-exec (M4 — plugin packaging + docs + v0.1.0 release prep)

- **Decided**: M4 is the **last team session before v0.1.0**. Scope: plugin packaging final (sync mirror, verify, prepack lifecycle), notification routing, documentation polish (README, DEMO, getting-started, skills, integrations docs), CI matrix verification, release body, coverage check, `npm publish --dry-run` verification.
- **Rejected**: deferring docs to v0.2.0. Without README and DEMO, v0.1.0 isn't a real release. Worker-3 owns docs polish.
- **Risks**:
  - **MEDIUM:** README.md is the user-facing doc; quality matters. Worker-1 must spend time on this — not a quick port.
  - **MEDIUM:** CI matrix may have undiscovered Linux/macOS issues since dev was on Windows. Worker-4 reviews CI workflow + simulates locally where possible.
  - **LOW:** Notification routing (Slack/Discord) is optional for v0.1.0 — flag it but ship a minimal implementation that doesn't block release.
  - **LOW:** Coverage threshold (≥78% lines on team/state) may not be met without additional tests; worker-5 verifies and adds tests if needed.

- **Reference**:
  - OMX `package.json` (prepack/sync:plugin patterns)
  - OMX `README.md` (high-level structure to mirror)
  - OMX `DEMO.md` (8-section structure)
  - OMX `docs/getting-started.html`, `docs/skills.html`
  - Plan §M4 acceptance criteria

- **Task plan (10 tasks, 5 workers)**:

| ID | Task | Owner | Depends |
|----|------|-------|---------|
| 1 | `src/scripts/sync-plugin-mirror.ts` (mirror `skills/`, `prompts/` (as agents), `agents/` into `plugins/oh-my-ghcopilot/`. Idempotent: skip if no changes. `--check` mode for CI parity.) | worker-2 | — |
| 2 | `src/scripts/verify-plugin-bundle.ts` (validates plugin.json schema, .mcp.json schema, agents/skills counts match catalog, no missing files) | worker-2 | — |
| 3 | `package.json` lifecycle: add `sync:plugin`, `verify:plugin-bundle`, `prepack` (build → sync → verify), `postpack` (cleanup if needed) scripts | worker-2 | 1, 2 |
| 4 | `src/cli/notify.ts` (Slack/Discord posting; webhook URL via env `OMGHC_NOTIFY_SLACK_WEBHOOK` / `OMGHC_NOTIFY_DISCORD_WEBHOOK`; `omghc notify --message <text> --target <slack|discord|all>`. If no webhook configured, prints "no notification target" and exits 0) + dispatcher rewire | worker-3 | — |
| 5 | `README.md` — full v0.1.0 README (replaces M0 placeholder). Sections: title + tagline, status (v0.1.0-pre), what OMGHC does, install (`npm install -g oh-my-ghcopilot`), quickstart (`omghc setup` → `omghc doctor` → `omghc team ...`), available skills (link to docs/skills.md), `$keyword` workflow, hooks status (forward-compat note per `docs/copilot-native-hooks.md`), state model, auth (link to `docs/auth.md`), architecture (1-paragraph), contributors, license, attribution to OMX. ~150-300 lines. | worker-1 | — |
| 6 | `DEMO.md` — mirrors OMX DEMO.md structure: prereqs, setup, doctor verify, demo flows for skills + AGENTS.md + CLI status + omghc team. Replace OMX-specific commands with OMGHC equivalents. Include a section on the Stop-event redesign (`omghc continue` workflow). ~200-400 lines. | worker-3 | — |
| 7 | `docs/getting-started.md` + `docs/skills.md` + `docs/integrations.md` — concise developer-facing reference. Skills doc lists all 21 + descriptions; integrations doc covers Slack/Discord/CI patterns. ~100-200 lines each. | worker-4 | — |
| 8 | CI workflow review + tightening: ensure `.github/workflows/ci.yml` matrix runs on Linux + macOS + Windows; add `npm run sync:plugin --check` and `npm run verify:plugin-bundle` to the test pipeline; document any platform-specific skips with comments | worker-4 | 3 |
| 9 | `RELEASE_BODY.md` for v0.1.0 — release notes summarizing all 6 milestones, breaking changes (none — first release), known issues (hooks don't fire in v1.0.40 production), forward-compat features, attribution. ~100-200 lines. | worker-5 | — |
| 10 | Final verification: run `npm run build`, run all tests, run `npm publish --dry-run`, check coverage thresholds (≥78% lines on `src/team/` and `src/state/`). If coverage low, add 2-3 targeted tests. Document outcome in handoff. | worker-5 | 1, 2, 3, 4 |

**Worker distribution:**
- worker-1: #5 README (heavy, single task)
- worker-2: #1 sync + #2 verify + #3 prepack (linked sequence)
- worker-3: #4 notify + #6 DEMO
- worker-4: #7 docs + #8 CI
- worker-5: #9 release body + #10 final verification

- **Forward-compat reminders for workers**:
  - Hooks don't fire in v1.0.40 production. README should mention this honestly.
  - Stop-event replaced via sessionEnd + `omghc continue`. DEMO should show this workflow.
  - Plugin distribution: `copilot plugin install` doesn't accept local paths — for now users use direct file copy or `npm install -g`.

- **Acceptance criteria for M4 (per plan §M4):**
  - [ ] `plugins/oh-my-ghcopilot/plugin.json` validated by `verify-plugin-bundle`
  - [ ] `npm run sync:plugin` mirrors content
  - [ ] `npm prepack` runs build → sync → verify
  - [ ] `omghc notify` works with webhook env vars
  - [ ] README, DEMO, docs/* exist and are coherent
  - [ ] CI matrix green on Linux + macOS + Windows
  - [ ] `npm publish --dry-run` shows expected file list
  - [ ] Coverage ≥78% lines on `src/team/` and `src/state/`
  - [ ] `RELEASE_BODY.md` for v0.1.0 written

- **After M4 completes:** lead bumps version to `0.1.0`, commits, runs `npm publish --dry-run` final, and proposes a publish (user authorizes). Then v0.1.0 ships.

- **Remaining (deferred to v1.x — M5):**
  - Rust crates port (`crates/omghc-{explore,mux,runtime-core,runtime,sparkshell}`)
  - 18 advanced skills (ultrawork, ultraqa, swarm, autoresearch, frontend-ui-ux, visual-ralph, visual-verdict, etc.)
  - i18n (15 README languages)
  - Sparkshell native binary
  - Adapt for OpenClaw / Hermes
  - OMX ↔ OMGHC sync tooling (one-shot rebases)
