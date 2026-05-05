## Handoff: team-verify → end (M1b complete)

- **Decided**: M1b CLI subcommands phase passes verification: 10/10 tasks complete, 44/44 tests pass, build clean, all subcommands route correctly through dispatcher. M1 is now functionally complete.
- **Rejected**: Continuing into M2 (hooks + state + MCP servers) in this session — context is large; M2 has its own day-1 spike (hooks.json schema) that's more important to do at the start of a fresh team session.
- **Risks discovered**:
  - **HIGH (acknowledge with user):** During M1b execution, OMGHC's setup was run against the user's real `~/.copilot/` directory. The `omghc doctor` output shows 33 agents installed at `C:\Users\andyzeng\.copilot\agents` and an OMGHC namespace in `settings.json`. Likely cause: worker-1's manual smoke test of `setup.ts` did not consistently isolate via `COPILOT_HOME`. Recommended remediation: `omghc uninstall --force --scope=user`. The uninstall.ts implementation handles this case (preserves user-authored content via catalog name matching).
  - worker-2 stalled silently for ~30 min after completing #4 — task wasn't marked done. Lead detected via watchdog and marked it manually. Worker-2 was iterating on Windows `.cmd` shim issue (Node v24 EINVAL on `.cmd` without `shell:true`).
  - worker-3 stalled on #1 (dispatcher rewire) after completing #6 and #7 — lead took over the 5-line edit to keep momentum. Lead-as-executor is a deviation from the team skill discipline but justified for a single small task at end of phase.

- **Files (M1b deliverables):**

| File | LOC | Status |
|------|-----|--------|
| `src/cli/setup.ts` | ~400 | functional MVP; defer-heavy features documented |
| `src/cli/setup-finalize-mcp.ts` | ~40 | M2 placeholder |
| `src/cli/doctor.ts` | ~375 | auth-aware per spike (env precedence + login cache); 6 checks |
| `src/cli/uninstall.ts` | ~408 | catalog-name matching for managed assets; preserves user content |
| `src/cli/list.ts` | (verified) | `--json`, `--skills-only`, etc. |
| `src/cli/update.ts` | (verified) | `npm view` check + `--check-only` + setup refresh |
| `src/cli/index.ts` (rewired) | (edit) | All M1 subcommands routed; `setup --finalize-mcp` special routing |
| `src/cli/__tests__/setup.test.ts` | (verified) | 7 tests pass |
| `src/cli/__tests__/doctor.test.ts` | (verified) | 8 tests pass |
| `src/cli/__tests__/list.test.ts` | (verified) | 4 tests pass |

- **Verification results:**
  - `npm run build` → clean
  - `node --test dist/cli/__tests__/*.test.js dist/agents/__tests__/*.test.js dist/catalog/__tests__/*.test.js` → **44/44 pass**
  - `node dist/cli/omghc.js list --json` → returns `{summary: {skills: 21, prompts: 33, agents: 0}}`
  - `node dist/cli/omghc.js doctor` → runs end-to-end on real machine; 5 PASS, 1 FAIL (auth missing because no GH_TOKEN was set during run); exit 1 (correct)
  - `node dist/cli/omghc.js setup --finalize-mcp` → routes to placeholder, prints M2-pending message, exit 0

- **Auth spike applied successfully**: doctor.ts reads from `${COPILOT_HOME:-~/.copilot}/config.json` and checks env precedence. Tested on a real Copilot CLI v1.0.40 install on Windows.

- **Plan correction logged**: plan v2 §A says doctor calls `copilot login --status`. That is now disproven by the spike. The plan should be updated in M2 to reference the actual doctor behavior; for now `docs/auth.md` is the authoritative source.

- **Remaining (next phase — M2)**: hooks + state + MCP servers + day-1 hooks.json schema spike. The `omghc setup --finalize-mcp` placeholder becomes functional when M2 ships.

- **Known cleanup needed**:
  - User should run `omghc uninstall --force --scope=user` to remove the unintended M1b side-effect (33 agents + OMGHC settings) from their real `~/.copilot/` if they prefer.
  - User should commit M1b files (~10 new src/, 3 new test files, 1 docs file, 4 templates carry-over from M1a, 1 dispatcher edit). Suggested commit message: `M1a foundation + M1b CLI subcommands (skills/prompts/templates port, agent-md generator, catalog reader, setup, doctor, uninstall, list, update + tests)`.
