## Handoff: team-verify → end (M1a complete)

- **Decided**: M1a foundation passes all acceptance criteria. 63 deliverables shipped, build clean, 25/25 unit tests pass, no residual OMX refs (only intentional attribution footers).
- **Rejected**: Continuing into M1b (setup.ts + doctor + uninstall + list + update) in this same team. M1b benefits from a fresh team that can use the catalog reader and agent generator + auth spike findings as inputs.
- **Risks**:
  - **Auth spike finding (HIGH for M1b doctor):** `copilot login --status` does NOT exist on v1.0.40. M1b doctor must use env precedence (`COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`) AND parse `~/.copilot/config.json` `loggedInUsers` array. Plan v2 §A previously assumed `--status` flag; correct in M1b.
  - BYOK mode (`COPILOT_PROVIDER_BASE_URL`) is an auth-bypass case the doctor must handle separately.
  - Catalog manifest's "agents" array (20 entries) merged related role prompts. M1b's `omghc list` and sync-plugin must respect this merging or risk drift.

- **Files (M1a deliverables):**

| Layer | Count | Locations |
|-------|-------|-----------|
| Ported skills | 21 | `skills/<name>/SKILL.md` |
| Ported prompts | 33 | `prompts/<name>.md` |
| Templates (2 ported, 2 new) | 4 | `templates/{AGENTS.md, instructions.md.tmpl, settings.seed.json, catalog-manifest.json}` |
| New TS modules | 2 | `src/agents/generateAgentMarkdown.ts`, `src/catalog/reader.ts` |
| New tests | 2 | `src/agents/__tests__/generator.test.ts` (10 tests), `src/catalog/__tests__/reader.test.ts` (9 tests) |
| Auth spike doc | 1 | `docs/auth.md` |

- **Lead corrections during verify**: none. Workers' output passed all spot-checks.

- **Auth spike highlights (must inform M1b doctor design):**
  - Env var precedence: `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`. First non-empty wins.
  - Login cache: `${COPILOT_HOME:-$HOME/.copilot}/config.json`, parse `loggedInUsers` array (each entry: `{ host, login }`).
  - **DO NOT call `copilot login` from doctor** — it starts an interactive OAuth device flow.
  - **DO NOT print token contents** to logs/output.
  - BYOK: if `COPILOT_PROVIDER_BASE_URL` is set, auth model differs — handle separately.
  - Supported token types: fine-grained PATs with "Copilot Requests" permission, OAuth tokens from Copilot CLI app or `gh` CLI app. Classic PATs (`ghp_`) NOT supported.

- **Skill rename specials**: `omx-setup` directory renamed to `omghc-setup`. All other skill directories preserve their OMX names.

- **Catalog manifest filter applied (worker-4)**: 21 skills retained for M1a, 18 OMX skills dropped (autoresearch, ultrawork, ultraqa, ecomode, swarm, deepsearch, security-review, visual-verdict, web-clone, visual-ralph, frontend-ui-ux, review, ask-claude, ask-gemini, trace, skill, configure-* family, ralph-init).

- **Remaining (next team — M1b)**:
  1. `src/cli/setup.ts` — uses `src/catalog/reader.ts` to enumerate skills/prompts/agents, uses `src/agents/generateAgentMarkdown.ts` to write `~/.copilot/agents/*.agent.md`, writes `~/.copilot/settings.json` from `templates/settings.seed.json`, writes `~/.copilot/instructions.md` from `templates/instructions.md.tmpl`, supports `--plugin` (default) and `--legacy` modes.
  2. `src/cli/doctor.ts` — uses auth spike findings to verify Copilot install + auth + OMGHC files. Reports HIGH severity on missing auth.
  3. `src/cli/uninstall.ts` — removes managed assets, preserves user content between markers.
  4. `src/cli/list.ts` — uses catalog reader; `--json` output supported.
  5. `src/cli/update.ts` — npm check + setup refresh.
  6. Test coverage: setup integration test (mocked filesystem), doctor unit tests, list golden output.
  7. `omghc setup --finalize-mcp` — separate flag to register OMGHC MCP servers in `~/.copilot/mcp-config.json` (deferred from M1 to M2 ordering bug fix).

- **Suggested team config for M1b**: 4 workers — worker-1 on setup.ts (large, sequential), worker-2 on doctor.ts, worker-3 on uninstall + list, worker-4 on update + tests. Estimated ~1.5 weeks via autonomous loop, possibly compressible to 1 week with the catalog reader and agent generator already in place.
