## Handoff: team-plan → team-exec (M1b — CLI subcommands)

- **Decided**: Implement M1's CLI subcommands (setup, doctor, uninstall, list, update, finalize-mcp) on top of M1a's foundation (catalog reader + agent generator + auth spike findings + 21 skills + 33 prompts + 4 templates).
- **Rejected**: Bundling setup.ts and doctor.ts into one task (setup.ts is large; better as a dedicated worker). Skipping integration tests (setup.ts has too many code paths to leave untested).
- **Risks**:
  - **Setup.ts scope creep:** OMX's setup.ts is 3,094 LOC. Worker may hit context limits. Mitigation: task description scopes setup.ts to ~400-600 LOC for v0.0.x by deferring features (legacy mode is "stub", plugin mode is "stub", OS keychain integration deferred). The shipped setup is **functional but minimal**.
  - **Auth spike caveats not yet baked into doctor:** worker-2 must consult `docs/auth.md` directly during doctor.ts implementation; the spike's findings (no `--status` flag, env precedence, login cache parsing, BYOK mode) drive doctor's design.
  - **Plan §A says doctor calls `copilot login --status`** — that's WRONG per the spike. Workers must follow `docs/auth.md`, not the plan's outdated text.
  - **MCP config registration is DEFERRED** to M2 (per plan §M1/M2 ordering fix). Setup explicitly does NOT write `~/.copilot/mcp-config.json` for OMGHC servers in M1; the new `omghc setup --finalize-mcp` subcommand will do that in M2.

- **Files**:
  - Source (read-only): `oh-my-codex/src/cli/{setup,doctor,uninstall,list,update}.ts`, `oh-my-copilot/docs/auth.md`, `oh-my-copilot/templates/`, `oh-my-copilot/src/catalog/reader.ts`, `oh-my-copilot/src/agents/generateAgentMarkdown.ts`
  - Target: `oh-my-copilot/src/cli/{setup,doctor,uninstall,list,update,setup-finalize-mcp}.ts` and `__tests__/`

- **Task plan (10 tasks, 4 workers)**:

| ID | Task | Owner | Files | Depends |
|----|------|-------|-------|---------|
| 1 | Dispatcher rewire — register new subcommand handlers, remove from STUBS list | worker-3 | `src/cli/index.ts` (edit) | — |
| 2 | `src/cli/setup.ts` (functional MVP, defer-heavy features) | worker-1 | `src/cli/setup.ts` | — |
| 3 | `src/cli/setup-finalize-mcp.ts` (M2 placeholder; current behavior: print "M2 will implement; returns 0") | worker-1 | `src/cli/setup-finalize-mcp.ts` | — |
| 4 | `src/cli/doctor.ts` (auth-aware per `docs/auth.md`) | worker-2 | `src/cli/doctor.ts` | — |
| 5 | `src/cli/uninstall.ts` | worker-2 | `src/cli/uninstall.ts` | — |
| 6 | `src/cli/list.ts` (uses catalog reader) | worker-3 | `src/cli/list.ts` | — |
| 7 | `src/cli/update.ts` (npm check + setup refresh) | worker-3 | `src/cli/update.ts` | — |
| 8 | Integration test for `setup.ts` (tmp-dir mock filesystem) | worker-4 | `src/cli/__tests__/setup.test.ts` | 2 |
| 9 | Unit tests for `doctor.ts` (env precedence, login cache parse, missing auth) | worker-4 | `src/cli/__tests__/doctor.test.ts` | 4 |
| 10 | Tests for `list.ts` (golden output for --json and human format) | worker-4 | `src/cli/__tests__/list.test.ts` | 6 |

- **Remaining (next phase — M2)**: Hooks + State + MCP servers (`src/mcp/state-server.ts`, `src/mcp/memory-server.ts`, `src/mcp/trace-server.ts`, `src/mcp/wiki-server.ts`, `omghc mcp-serve <name>`, `src/hooks/keyword-detector.ts`, `src/hooks/agents-overlay.ts`, `src/hooks/session.ts`, `plugins/oh-my-ghcopilot/hooks.json`, `plugins/oh-my-ghcopilot/.mcp.json`, `dist/scripts/copilot-native-hook.js`, M2 day-1 spike for hooks.json schema). The new `omghc setup --finalize-mcp` subcommand becomes functional in M2.
