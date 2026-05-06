## Handoff: team-plan → team-exec (M2a — foundation)

- **Decided**: Scope this team to M2a foundation: (1) the hooks.json schema spike (gating for ALL hook work), (2) 4 stdio MCP servers (state, memory, trace, wiki), (3) MCP server bootstrap, (4) `omghc mcp-serve` + `omghc state/wiki/trace` CLI parity, (5) dispatcher rewire. Defer hooks ports (keyword-detector, agents-overlay, session, copilot-native-hook), plugin manifests, and the M2 ordering-fix `omghc setup --finalize-mcp` to M2b.
- **Rejected**: Single-team M2 — too many concerns, hook ports depend on the schema spike, and the spike output shapes the hook adapter design. Cleaner to run M2a, ingest spike findings, then design M2b.
- **Risks**:
  - **HIGH:** Hooks.json schema spike is the gating unknown for M2b. Spike will install a minimal plugin and capture the stdin event JSON Copilot CLI sends to a hook command. If schema is materially different from Codex's, the entire `src/scripts/copilot-native-hook.ts` adapter design changes. Worker-1 owns this task as priority-1.
  - **MEDIUM:** MCP servers depend on `@modelcontextprotocol/sdk` — needs to be added to package.json. Workers must coordinate this so we don't add it 4 times.
  - **MEDIUM:** Wiki server uses local markdown storage at `.omghc/wiki/`; need to define the on-disk format up front. Decision: one markdown file per page, frontmatter with title + slug + tags + updated_at. Search is grep-based, not vector-based.
  - **LOW:** Trace server consumes events from `.omghc/state/trace.jsonl` (append-only). Read-only consumer; writers will be M2b hooks.
- **Files**:
  - Source (read-only OMX): `src/mcp/{state,memory,trace,wiki,bootstrap}-server.ts`, `src/state/operations.ts`
  - Target: `oh-my-copilot/src/mcp/*.ts`, `oh-my-copilot/src/state/operations.ts`, `oh-my-copilot/src/cli/{mcp-serve,state,wiki,trace}.ts`, dispatcher edit

- **Task plan (10 tasks, 5 workers)**:

| ID | Task | Owner | Files | Depends |
|----|------|-------|-------|---------|
| 1 | **PRIORITY** M2 day-1 spike: install minimal plugin, capture Copilot `hooks.json` stdin/stdout contract → document in `docs/copilot-native-hooks.md` | worker-1 | `docs/copilot-native-hooks.md`, throwaway plugin in `/tmp/` | — |
| 2 | Add `@modelcontextprotocol/sdk` and `zod` to package.json devDependencies; run `npm install` | worker-1 | `package.json` (edit) | — |
| 3 | `src/state/operations.ts` (mode state read/write/clear/list/get_status, file-based JSON) | worker-2 | `src/state/operations.ts` | — |
| 4 | `src/mcp/state-server.ts` (stdio MCP for state ops) | worker-2 | `src/mcp/state-server.ts` | 3 |
| 5 | `src/mcp/memory-server.ts` (notepad + project memory) | worker-3 | `src/mcp/memory-server.ts` | 2 |
| 6 | `src/mcp/trace-server.ts` (trace summary/timeline read-only consumer of `.omghc/state/trace.jsonl`) | worker-3 | `src/mcp/trace-server.ts` | 2 |
| 7 | `src/mcp/wiki-server.ts` (markdown wiki storage at `.omghc/wiki/`) | worker-4 | `src/mcp/wiki-server.ts` | 2 |
| 8 | `src/mcp/bootstrap.ts` (start any MCP server by name; lifecycle + deduplication) | worker-4 | `src/mcp/bootstrap.ts` | 4 |
| 9 | `src/cli/mcp-serve.ts` + `src/cli/state.ts` + `src/cli/wiki.ts` + `src/cli/trace.ts` (CLI parity; thin wrappers calling MCP server tools directly without going through stdio) + dispatcher rewire to register them | worker-5 | 5 files | 8 |
| 10 | Tests: `src/mcp/__tests__/state-server.test.ts`, `src/mcp/__tests__/memory-server.test.ts` (≥6 tests each, exercising tool list + read/write round-trips against tmp dirs) | worker-5 (after #9 done) | 2 test files | 4, 5 |

- **Remaining (next phase — M2b)**:
  - Hooks ports: `src/hooks/keyword-detector.ts`, `agents-overlay.ts`, `session.ts`, `prompt-guidance-contract.ts`, `triage-heuristic.ts`
  - `src/scripts/copilot-native-hook.ts` (Copilot stdin/stdout adapter — design driven by M2a spike output)
  - Plugin manifests: `plugins/oh-my-ghcopilot/{plugin.json, hooks.json, .mcp.json}`
  - `omghc setup --finalize-mcp` becomes functional (writes OMGHC MCP servers into `~/.copilot/mcp-config.json`)
  - Hook integration tests
