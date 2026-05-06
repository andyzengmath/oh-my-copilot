## Handoff: team-verify → end (M2a complete)

- **Decided**: M2a foundation passes verification. 10/10 tasks complete; 68/68 tests pass; all 4 MCP servers + CLI surface functional.
- **Rejected**: Continuing into M2b (hooks ports + plugin manifests + finalize-mcp) in this session — context is large; M2b's design is significantly impacted by M2a's hooks-don't-fire finding and warrants a fresh team session with the revised plan.
- **Risks discovered (M2a-spike-driven)**:
  - **CRITICAL:** File-based hooks DO NOT FIRE in Copilot CLI v1.0.40 production binary. Schema validates, hook file is loaded, processor list registers — but the bridge from `Session.hooks` to the actual `preToolsExecution` invocation is incomplete in this build. Empirical: 3 independent runs with valid hook file produced zero hook executions. Standalone Node script replicating the loader+executor logic fires correctly, so the file format is right; the production CLI binary's wiring is incomplete.
  - **HIGH:** No `Stop` event exists in Copilot's hook schema. Ralph continuation, ultrawork persistence, team Stop-blocking — all need a different design (likely `sessionEnd` + persisted re-invocation hint + `omghc continue` wrapper).
  - **HIGH:** Plan v2 §9 R-new ("HTTP-POST hooks fallback") is impossible — schema only allows `type: "command"`. Must be removed from the plan.
  - **MEDIUM:** Hook discovery is `<gitRoot>/.github/hooks/*.json` — not plugin-manifest based. OMGHC `setup` must write the hook file directly to the project's `.github/hooks/` directory.
  - **MEDIUM:** `copilot plugin install` does NOT accept local paths (only `owner/repo`, marketplace URLs, archive URLs). Plugin delivery requires publishing to a Copilot-recognized source. For M2b, OMGHC's plugin packaging at `plugins/oh-my-ghcopilot/` will only be usable via direct file copy until a marketplace strategy is decided.
  - **MEDIUM:** Cross-platform requirement: every hook entry must set BOTH `bash` AND `powershell` fields. Runtime picks via `process.platform`.
  - **LOW:** preToolUse output mapper only forwards `{permissionDecision, permissionDecisionReason}` back to the agent. Other events' outputs are parsed and discarded. So `userPromptSubmitted.modifiedPrompt`, `postToolUse.modifiedResult`, `additionalContext` cannot be used through external file-based hooks today, even when wiring lands.

- **Files (M2a deliverables):**

| File | LOC | Status |
|------|-----|--------|
| `docs/copilot-native-hooks.md` | 270 | spike documentation (canonical zod schema, per-event stdin/stdout, empirical findings, 10 OMGHC-specific implications) |
| `src/state/operations.ts` | ~165 | mode state read/write/clear/list/get_status (file-based JSON) |
| `src/mcp/state-server.ts` | (verified) | 5 stdio MCP tools + buildStateServer + startStateServer exports |
| `src/mcp/memory-server.ts` | (verified) | 10 tools (notepad + project memory); 8 underlying functions exported for CLI parity |
| `src/mcp/trace-server.ts` | (verified) | 2 tools (read-only); streams trace.jsonl line-by-line |
| `src/wiki/operations.ts` | (worker-4 added) | 6 wiki ops as standalone module (shared by wiki-server + CLI) |
| `src/mcp/wiki-server.ts` | (verified) | 6 tools; thin MCP wrapper over operations.ts |
| `src/mcp/bootstrap.ts` | ~80-120 | McpServerName union, MCP_SERVERS registry, listServers, launchServer (dynamic ESM import), generateMcpConfig |
| `src/cli/mcp-serve.ts` | (worker-5 added) | dispatches to launchServer with name aliases |
| `src/cli/state.ts` | (worker-5 added) | direct wrap of state/operations.ts |
| `src/cli/wiki.ts` | (worker-5 added) | direct wrap of wiki/operations.ts |
| `src/cli/trace.ts` | (worker-5 added) | wraps trace-server's exported traceSummary/traceTimeline |
| `src/cli/index.ts` | (rewired) | all 4 new subcommands routed; mcp-serve/state/wiki/trace removed from STUBS |
| `src/mcp/__tests__/state-server.test.ts` | (verified) | 10 tests pass |
| `src/mcp/__tests__/memory-server.test.ts` | (verified) | 14 tests pass |

**Other deliverables:**
- `package.json` updated with `dependencies: { "@modelcontextprotocol/sdk": "^1.26.0", "zod": "^3.23.0" }`. Resolved: SDK 1.29.0, zod 3.25.76.

- **Verification results:**
  - `npm run build` → clean
  - 68/68 tests pass: 6 smoke + 10 generator + 9 reader + 7 setup + 8 doctor + 4 list + 10 state-server + 14 memory-server
  - `echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/mcp/state-server.js` → returns 5 tools with valid input schemas
  - `omghc state list-active --json` → `{"ok":true,"data":[]}`
  - `omghc wiki list --json` → `{"ok":true,"data":[]}`
  - `omghc trace summary --json` → `{"ok":true,"data":{"totalEvents":0,"byEvent":{},"span":{...}}}`
  - `omghc mcp-serve --help` → shows all 4 targets

- **Team mechanics observed**:
  - 5 workers ran in parallel with dependency-aware blocking
  - worker-2 silently completed #4 (state-server) without marking task done — same pattern as M1b. Lead detected via watchdog and verified the file existed with correct exports, then marked done. (This appears to be a consistent worker-2 behavior pattern; consider explicit "after writing the file, IMMEDIATELY call TaskUpdate(N, status=completed)" instruction for future M2b worker prompts.)
  - All other workers reported in correctly.

- **Lead corrections during verify**: only the one above (worker-2's silent completion of #4).

- **Plan corrections logged for next plan-update pass:**
  1. Plan v2 §9 R-new (HTTP-POST hooks fallback) → DELETE; impossible per schema.
  2. Plan v2 §A.5 / §M2 → ADD note that `omghc setup` writes `<projectRoot>/.github/hooks/oh-my-ghcopilot.json`, NOT registered via plugin manifest.
  3. Plan v2 §M2 → ADD `omghc doctor --probe-hooks` requirement (drops marker hook, fires tool call, asserts firing — canonical signal of when Copilot fixes wiring).
  4. Plan v2 §M2 → ANNOTATE that M2b hook ports must build for forward-compat; no-op behavior expected against v1.0.40.
  5. Plan v2 §M3 / Ralph design → REVISIT Stop-event-based continuation. No `Stop` event exists; design alternatives needed.

- **Remaining (next phase — M2b)**:
  - Hooks ports (forward-compat only): `src/hooks/keyword-detector.ts`, `agents-overlay.ts`, `session.ts`, `prompt-guidance-contract.ts`, `triage-heuristic.ts`
  - `src/scripts/copilot-native-hook.ts` (Copilot stdin/stdout adapter — design now informed by spike: must handle both bash + powershell, write to log file via stderr if stdout is reserved for JSON response)
  - Plugin manifests: `plugins/oh-my-ghcopilot/{plugin.json, .mcp.json}` (note: NO `hooks` field on plugin.json — hooks live separately under project's `.github/hooks/`)
  - `omghc setup --finalize-mcp` becomes functional: writes OMGHC MCP entries to `~/.copilot/mcp-config.json` using `generateMcpConfig` from bootstrap.ts
  - `omghc setup` extension: write `<projectRoot>/.github/hooks/oh-my-ghcopilot.json` (not into ~/.copilot)
  - `omghc doctor --probe-hooks` (the canonical detection mechanism)
  - Hook integration tests (will pass once Copilot ships wiring)
