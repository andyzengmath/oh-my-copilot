# Copilot CLI Native Hook Contract

This document is the canonical answer to:

> What is the exact JSON contract Copilot CLI uses for hooks, and how must OMGHC's `dist/scripts/copilot-native-hook.js` adapter conform to it?

## Spike date / version

- **Date:** 2026-05-05 (M2 day-1 spike)
- **Platform:** Windows 11 Enterprise 10.0.26200, x64
- **Node:** v24.13.0 (system) / v24.15.0 (Copilot's bundled runtime)
- **Copilot CLI:** v1.0.40 (`@github/copilot v0.0.395`)
- **Method:** schema extracted from the bundled `index.js` of `@github/copilot@1.0.40` (zod schemas + loader function `Gvt` + executor `Avt` + processor wiring), validated against the runtime zod schema with a synthetic `hooks.json`, and end-to-end smoke-tested by replicating the loader+executor in a standalone Node script (`test-load-hooks.mjs`) AND by running real non-interactive `copilot -p` sessions in a `git init`'d directory containing the hook file.

The schema is **definitively** the runtime contract — not docs guesswork.

## CRITICAL EMPIRICAL FINDING — hooks DO NOT fire in v1.0.40 CLI mode

**As of v1.0.40, file-based hooks under `<gitRoot>/.github/hooks/*.json` are loaded by the runtime but DO NOT fire when the CLI is invoked normally (`copilot -p ... --allow-all-tools` or interactive `copilot`).**

Evidence:
1. The runtime contains complete code paths (`Gvt` loader, `Avt` executor, `ZTl` registrar, `qse` runner) and wires them through `SessionManager.createSession` → `loadHooks` → `Session.runAgenticLoop` → `K_(this.hooks?.preToolUse, ...)`. The processors registry shows `PreToolUseHooksProcessor` in `processors.preToolsExecution` per session.
2. A standalone script that performs the same load + spawn (with the runtime's exact zod schema and exact `Avt` shell-dispatch logic) **successfully fires** the hook end-to-end and writes the expected stdin payload to a marker file.
3. The same hook file installed at `<gitRoot>/.github/hooks/test.json` of a freshly-`git init`'d directory **does not** fire when `copilot -p "Run echo hello-from-copilot" --allow-all-tools` is executed in that directory. Three separate runs (resumed-session, new-session via `-n`, new-session via session-listing fallback) all produce the same negative result. No hook log file is created. Copilot's debug log at `~/.copilot/logs/process-*.log` shows the `PreToolUseHooksProcessor` registered in `processors.preToolsExecution` but contains zero `loadHooks` / `hookInvocation` / `Hook command` log entries.

**Hypothesis (unverified):** the `preToolsExecution` processor registered in the production CLI binary appears to be a different `PreToolUseHooksProcessor` than the one consuming `this.hooks?.preToolUse` from `Session.runAgenticLoop`. The `loadHooks` call in `SessionManager.createSession` does run and would populate `Session.hooks`, but the production binary's tool-execution path is reached through `tq.runCompletionWithTools` → `createCompletionWithToolsProcessors` → `[s].filter(...)`, where `s` is constructed independently of `session.hooks`. As of v1.0.40, the bridge from `session.hooks` to the `preToolsExecution` processor list is incomplete in the bundled CLI binary, even though the SDK type definitions promise it. (Evidence: `PreToolUseHooksProcessor` as a string literal does not appear anywhere in the bundled `index.js` — it surfaces only in stringified `JSON.stringify(processors)` log output, suggesting the class is constructed via a constructor whose `name` property is `PreToolUseHooksProcessor`, but its body is not wired to file-loaded hooks in this build.)

**Implication for M2:**
- **OMGHC cannot ship a working hook implementation against Copilot CLI v1.0.40.** Writing `.github/hooks/oh-my-ghcopilot.json` is a no-op until GitHub ships a CLI version that completes this wiring.
- **The Plan B from `.omc/plans/2026-05-05-port-omx-to-copilot.md` ("HTTP-POST hooks fallback") is also impossible** — the schema rejects anything that's not `type: "command"`.
- **Recommended M2 pivot:** Defer all hook-dependent features (keyword-detector, agents-overlay, session lifecycle, Stop/continuation) to a later milestone gated on a Copilot CLI release that surfaces working file-based hooks. M2 should instead concentrate on the MCP-server surfaces (`omghc_state`, `omghc_memory`, `omghc_trace`, `omghc_wiki`) and the `omghc setup` CLI plumbing that **writes** `.github/hooks/oh-my-ghcopilot.json` in a forward-compatible way (so when the wiring lands, OMGHC works automatically) but does not depend on hooks running today. The `dist/scripts/copilot-native-hook.js` adapter should be implemented per-spec (so the hook file we ship is correct) but its absence-of-fire should be expected and not block M2 acceptance.
- **Validation gating:** before claiming hook integration works, OMGHC must run an automated smoke test (`omghc doctor --probe-hooks`) that writes a marker hook, fires a tool call, and asserts the marker fired. As long as v1.0.40 is the locked version, this probe is expected to FAIL — that's the reproducible signal that hooks aren't yet shipping in production CLI.

**Watch list:** monitor `@github/copilot` release notes for keywords "hooks", "PreToolUseHooksProcessor", or `.github/hooks` to know when the wiring lands. The schema below is forward-compatible and should not need changes.

## TL;DR — what's true

- **Hook discovery directory is fixed**: `<gitRoot>/.github/hooks/**/*.json`. Plugins do **not** register hooks via `plugin.json` or via their installed-plugins folder. Only `.github/hooks/**/*.json` is scanned (recursive glob, all `.json` files merged).
- **`copilot plugin install` does not accept local paths.** Sources must be `owner/repo`, `owner/repo:path`, `https://...`, or `plugin@marketplace`. Plugins for hook delivery would need to write into `.github/hooks/` themselves (e.g., via a `postinstall` step in the plugin's `package.json`).
- **No HTTP / URL hook variant exists.** Each hook entry is a literal `"type": "command"` with a `bash` and/or `powershell` shell string. The Plan B in `.omc/plans/2026-05-05-port-omx-to-copilot.md` (HTTP-POST hook fallback) is **not needed and not possible** in v1.0.40.
- **6 supported hook events**: `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`.
- **No `Stop` hook.** Codex / Claude Code's `Stop` continuation pattern has no native equivalent here. `sessionEnd` exists but fires after the session is finalized — it cannot block or continue.
- **Schema version is `1` (literal).** Anything else is rejected at load time.
- **Stdin → JSON; stdout → JSON.** Hook commands receive a JSON object on stdin and may print a JSON object to stdout. Empty stdout means "no decision". Non-JSON stdout is treated as no decision (silent).
- **Non-zero exit code throws.** The runtime treats it as a hook failure and surfaces it with the captured stderr.
- **Default timeout: 30 seconds.** Configurable per-hook via `timeoutSec`.

## Hook events supported

| Event | Triggers when | Stdin fields | Output fields the runtime acts on |
|-------|---------------|--------------|-----------------------------------|
| `sessionStart` | New session is created (also `resume` / `new` / `startup`) | `timestamp`, `cwd`, `source`, `initialPrompt` | none — `additionalContext` and `modifiedConfig` exist on the in-process SDK type but the JSON output mapper in v1.0.40 returns nothing for the `sessionStart` adapter (output ignored) |
| `sessionEnd` | Session ends (`complete` / `error` / `abort` / `timeout` / `user_exit`) | `timestamp`, `cwd`, `reason` | none (output ignored by JSON adapter) |
| `userPromptSubmitted` | User submits a prompt | `timestamp`, `cwd`, `prompt` | none (output ignored by JSON adapter) — `modifiedPrompt` and `additionalContext` exist on the SDK type but the runtime's stdout→object adapter does not surface them in v1.0.40 |
| `preToolUse` | Just before a tool call executes | `timestamp`, `cwd`, `toolName`, `toolArgs` | `permissionDecision` (`"allow"` / `"deny"` / `"ask"`), `permissionDecisionReason` |
| `postToolUse` | Just after a tool call returns | `timestamp`, `cwd`, `toolName`, `toolArgs`, `toolResult: { resultType, textResultForLlm }` | none (output ignored by JSON adapter) |
| `errorOccurred` | Recoverable / unrecoverable runtime error | `timestamp`, `cwd`, `error: { message, name, stack }` | none (output ignored by JSON adapter) |

**Important caveat about output fields**: the SDK type definitions in `@github/copilot/sdk/index.d.ts` declare richer output shapes (e.g., `additionalContext`, `modifiedPrompt`, `suppressOutput`, `modifiedArgs`, `modifiedResult`, `errorHandling`). However, the **out-of-process** hook executor in v1.0.40 (function `qse(t, e, n, r)` registered by `ZTl` at `<gitRoot>/.github/hooks/`) only feeds the listed input fields into the hook's stdin, and only the `preToolUse` output adapter forwards anything (`{permissionDecision, permissionDecisionReason}`) back to the agent loop — every other event's output is discarded by the adapter even if the hook prints it. Only the in-process `QueryHooks` API (i.e., when consuming `@github/copilot` as an SDK) sees the full output. **OMGHC's `copilot-native-hook.js` running as an external process should treat `preToolUse` as the only event that can affect the model's behavior, and use `postToolUse` / `userPromptSubmitted` / etc. for telemetry/state side-effects only.**

## hooks.json schema (canonical zod, v1.0.40)

The runtime schema (verbatim from the bundled `index.js`):

```js
const HookEntry = z.object({
  type: z.literal("command"),
  bash: z.string().optional(),
  powershell: z.string().optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutSec: z.number().positive().optional(),
}).refine(
  (t) => t.bash !== undefined || t.powershell !== undefined,
  { message: "At least one of 'bash' or 'powershell' must be specified" }
);

const HooksConfig = z.object({
  version: z.literal(1),
  hooks: z.object({
    sessionStart:        z.array(HookEntry).optional(),
    sessionEnd:          z.array(HookEntry).optional(),
    userPromptSubmitted: z.array(HookEntry).optional(),
    preToolUse:          z.array(HookEntry).optional(),
    postToolUse:         z.array(HookEntry).optional(),
    errorOccurred:       z.array(HookEntry).optional(),
  }),
});
```

Example minimal `hooks.json` (validated against the runtime schema):

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": "node /path/to/copilot-native-hook.js preToolUse",
        "powershell": "node 'C:/path/to/copilot-native-hook.js' preToolUse",
        "timeoutSec": 15
      }
    ],
    "postToolUse": [
      {
        "type": "command",
        "bash": "node /path/to/copilot-native-hook.js postToolUse",
        "powershell": "node 'C:/path/to/copilot-native-hook.js' postToolUse",
        "timeoutSec": 15
      }
    ]
  }
}
```

When both `bash` and `powershell` are set, the runtime picks one based on `process.platform === "win32"` (powershell on Windows; bash elsewhere). When only one is set, that one is used unconditionally — meaning a powershell-only hook will fail on macOS/Linux runners, and a bash-only hook will fail on Windows runners. **OMGHC must always set both.**

### Negative cases (verified)

| Input | Result |
|-------|--------|
| `{ "version": 2, "hooks": {} }` | Rejected: `Invalid literal value, expected 1` |
| `{ "version": 1, "hooks": { "preToolUse": [{ "type": "command" }] } }` | Rejected: `At least one of 'bash' or 'powershell' must be specified` |
| `{ "version": 1, "hooks": { "preToolUse": [{ "type": "webhook", "url": "..." }] } }` | Rejected: `Invalid literal value, expected "command"` |

A parse failure causes the runtime to **log an error and skip that file** — other valid `.json` files in `.github/hooks/` continue to load. Logger calls: `Invalid hook configuration in <path>: <zod errors>` for zod failures, `Invalid JSON in <path>: <msg>` for syntax errors.

## Stdin contract (per event)

Stdin is a single JSON object terminated by EOF (no newline guarantee). Field set is exactly what the runtime maps in `ZTl`:

```jsonc
// sessionStart
{ "timestamp": <ms>, "cwd": "<path>", "source": "startup" | "resume" | "new", "initialPrompt": "<string?>" }

// sessionEnd
{ "timestamp": <ms>, "cwd": "<path>", "reason": "complete" | "error" | "abort" | "timeout" | "user_exit" }

// userPromptSubmitted
{ "timestamp": <ms>, "cwd": "<path>", "prompt": "<string>" }

// preToolUse
{ "timestamp": <ms>, "cwd": "<path>", "toolName": "<string>", "toolArgs": <unknown> }

// postToolUse
{
  "timestamp": <ms>,
  "cwd": "<path>",
  "toolName": "<string>",
  "toolArgs": <unknown>,
  "toolResult": { "resultType": "<string>", "textResultForLlm": "<string>" }
}

// errorOccurred
{
  "timestamp": <ms>,
  "cwd": "<path>",
  "error": { "message": "<string>", "name": "<string>", "stack": "<string>" }
}
```

`timestamp` is `Number` ms (Unix epoch). `cwd` is the runtime's working directory at hook fire time (NOT the hook config's `cwd` field). Notably **there is no `sessionId`, no `event_name`, no `tool_call_id` field on stdin** — OMGHC's adapter must derive any session identity it needs from the cwd or environment, or capture it during `sessionStart`.

## Stdout / exit-code contract

- The runtime captures all stdout, calls `JSON.parse(stdout.trim())`, and feeds the parsed object into the per-event output adapter.
- **Empty stdout** → adapter sees `undefined` (no-op).
- **Non-JSON stdout** → adapter sees `undefined` (no-op, no error logged).
- **Non-zero exit** → throws `Hook command failed with code <N>\nStderr: <captured stderr>`. The error propagates up the agent runtime and aborts the current operation (the tool call doesn't proceed). Use exit code 0 + JSON `{}` for a "no decision, no error" path.
- **Stderr** is captured but only surfaced if exit code ≠ 0.
- **Timeout** (`timeoutSec`, default 30s) → `m.kill()` then throws `Hook command timed out after <s> seconds`.
- Output adapters by event:
  - `preToolUse`: `{ permissionDecision: "allow"|"deny"|"ask", permissionDecisionReason: "<string>" }` — both fields optional, runtime forwards them to the permission system.
  - `sessionStart` / `sessionEnd` / `userPromptSubmitted` / `postToolUse` / `errorOccurred`: output mapper returns `{}` regardless of stdout. **The hook's stdout is parsed but ignored.** Use these strictly for side effects (state writes, logging, telemetry).

## HTTP-POST variant

**Does not exist** in Copilot CLI v1.0.40. The `HookEntry` schema only accepts `"type": "command"`. There is no `url`, `method`, `headers`, or other HTTP field. Plan B in `.omc/plans/2026-05-05-port-omx-to-copilot.md` is therefore obsolete and should be dropped from the plan — the only fallback is an external command that itself makes an HTTP call to a local OMGHC server (e.g., `omghc mcp-serve`), but the hook entry itself is always a shell command.

## Subprocess invocation details

Implementation reference (from runtime function `Avt`):

- Command shell selection:
  - Both `bash` and `powershell` set + `process.platform === "win32"` → uses `powershell`.
  - Both set + non-Windows → uses `bash`.
  - Only one set → that one is used unconditionally (no platform check; will fail on the wrong OS).
  - Neither set → schema rejects at load time (refine).
- Shell invocation:
  - bash: `spawn("bash", ["-c", <cmd>], { cwd, env, timeout })`
  - powershell: `spawn("powershell", ["-nol", "-c", <cmd>], { cwd, env, timeout })`
  - `cwd`: hook's `cwd` field if set (resolved against gitRoot), else `process.cwd()`.
  - `env`: `{ ...process.env, ...hook.env }`. Powershell additionally gets `POWERSHELL_UPDATECHECK=Off`.
  - The runtime resolves `bash` / `powershell` via `ETl(name)` (which performs Windows-style executable lookup including `.exe` suffixes); the binary must be on PATH.
- The hook subprocess receives the JSON payload by `m.stdin.write(payload)` followed by `m.stdin.end()`. Hooks must read all of stdin before responding.
- The runtime accumulates stdout into a single string before parsing — multi-line JSON is fine; partial / streamed JSON is not.

## Where hooks are loaded from

Function `loadHooks(options)` (method on the session manager class):

```js
async loadHooks(opts) {
  const cwd = opts?.workingDirectory || process.cwd();
  const gitInfo = await vZ(cwd);                          // runs `git rev-parse --show-toplevel`
  const root = gitInfo.found ? gitInfo.gitRoot : cwd;     // falls back to cwd if no git repo
  const hookDir = path.join(root, ".github", "hooks");
  return Gvt(hookDir, (cmd, stdin) => Avt(cmd, stdin, root), opts?.hooks, logger);
}
```

- Loader `Gvt` does `Glob("**/*.json")` under `hookDir` and parses every match.
- Multiple files are allowed; their hook arrays are concatenated per event.
- Files outside `<gitRoot>/.github/hooks/` are not loaded.
- There is no per-plugin / per-marketplace overlay. Plugins that want to register hooks must write into `<gitRoot>/.github/hooks/`. (No mechanism exists for this in `copilot plugin install`; it's the user's / OMGHC `setup` job to do it.)
- The session manager passes `opts?.hooks` (in-process `QueryHooks` registered via SDK) as the base; file-loaded hooks are appended on top. **OMGHC running as an external CLI cannot use the in-process route — it must write hook files.**

## Plugin-install plumbing (out of scope for hooks but adjacent)

For reference, while `copilot plugin install` does not deliver hooks, it does deliver MCP servers. Locations checked in order (function `VLo`):

1. `<plugin-root>/.mcp.json`
2. `<plugin-root>/.github/mcp.json`
3. `<plugin-root>/.github/plugin/plugin.json` (if present, its `mcpServers` field is honored — either inline or as a `./relative/path/.mcp.json` reference)
4. `<plugin-root>/plugin.json` (same shape as #3)

The `plugin.json` schema accepts at minimum:

```jsonc
{
  "name": "<string>",
  "description": "<string?>",
  "version": "<string?>",
  "skills": "<dir or array of dirs?>",
  "mcpServers": "<path-string or inline object?>"
  // hooks: NOT a recognized field — hooks must live in .github/hooks/
}
```

OMGHC's `plugins/oh-my-ghcopilot/plugin.json` should set `mcpServers: "./.mcp.json"` (or co-locate the MCP servers under `.github/mcp.json` if it wants to use the GitHub-namespaced layout). It should not set a `hooks` field.

## Practical implications for OMGHC's `src/scripts/copilot-native-hook.ts` adapter

1. **Hook installation strategy** — `omghc setup` must idempotently write `<gitRoot>/.github/hooks/oh-my-ghcopilot.json` (a single OMGHC-owned file). Generated content references `dist/scripts/copilot-native-hook.js` from the OMGHC install location. Write-only-once + diff-on-refresh, exactly mirroring OMX's `omx setup` write of `.codex/hooks.json`.
2. **One adapter binary, dispatched by argv** — the hook file invokes `node <path>/copilot-native-hook.js <event>` for each event. The adapter reads `process.argv[2]` (`preToolUse` / `postToolUse` / etc.), reads stdin to EOF, parses as JSON, and dispatches to the OMGHC plugin runtime. This matches OMX's structure: same `dist/scripts/codex-native-hook.js` shape; only the input/output schemas differ.
3. **Both `bash` and `powershell` always provided** — for cross-platform install, every hook entry must include both. The same script path appears twice with platform-correct quoting.
4. **Output is event-conditional** — only `preToolUse` should print non-empty JSON (decisions of `allow`/`deny`/`ask`). All other events should print `{}` and rely on side effects (state writes, log lines, MCP server calls). Printing extra output is harmless (parsed and ignored) but wastes work.
5. **Always exit 0 unless a hook truly wants to abort** — non-zero exit aborts the agent's tool call. OMGHC's adapter must wrap its plugin dispatch in try/catch and only exit non-zero when its `preToolUse` deny logic explicitly wants to block (and prefers `permissionDecision: "deny"` over crashing).
6. **No `sessionId` on stdin** — OMGHC's adapter must construct a per-session key from the captured `cwd` plus the runtime PID (or a uuid written by `sessionStart`). Without persistent identity from the hook payload, OMGHC owns the session-id contract.
7. **No `Stop` event** — features that depend on Codex's `Stop` continuation contract (`ralph` / `ultrawork` / `team` continuation, auto-nudge, ralplan/deep-interview persistence) cannot be implemented through hooks. Either: (a) keep them on a separate runtime fallback path (timer / wrapper script), or (b) hook into `sessionEnd` and use the MCP server to persist re-invocation hints, then have a thin `omghc continue` wrapper detect them on next `copilot` invocation. **This is the single biggest divergence from OMX's hook architecture and must be reflected in `.omc/plans/2026-05-05-port-omx-to-copilot.md` Section M2/M3.**
8. **No `userPromptSubmitted` mutation in v1.0.40** — `keyword-detector` semantics that rewrite the prompt or inject context cannot be implemented through this hook in the external-command form (output is discarded). Workaround: emit advisory state via the OMGHC MCP server and have the LLM instruction layer (skills / agents.md) read it. Re-evaluate when v1.x of Copilot CLI exposes the in-process `QueryHooks` adapter to externally-installed hooks.
9. **`postToolUse` output is also discarded** — but the side effect is still useful (writing `.omghc/logs/postuse.jsonl` directly from the hook works fine).
10. **Hook subprocess gets only what's on stdin** — no env vars beyond what `process.env` plus the hook's own `env` field provide. If OMGHC needs the active model name, plan name, or other agent state, it must capture it from `sessionStart` (`initialPrompt` only; no model field) or fetch via its own MCP server.

## Verification guidance

When validating an OMGHC hook install, keep the proof boundary explicit:

1. **Schema proof** — hook file under `<gitRoot>/.github/hooks/` parses cleanly against the runtime zod schema (use `validate-spike.mjs` pattern; do not rely on docs).
2. **Discovery proof** — `git rev-parse --show-toplevel` from the user's project resolves to the same directory whose `.github/hooks/` we wrote into. Hooks under the wrong git root will silently not load.
3. **Runtime invocation proof** — Copilot's debug logs at `~/.copilot/logs/process-*.log` mention `PreToolUseHooksProcessor` in the `processors.preToolsExecution` list. (Note: this is the registration point, not proof of fire.)
4. **Side-effect proof** — the hook itself writes a known marker file or appends to a known log on every fire. OMGHC's adapter should always log to `.omghc/logs/hooks-<event>.jsonl` so install correctness can be audited per session.
5. **Negative test** — drop a syntactically valid but logically wrong file in `.github/hooks/` (e.g., wrong version), and confirm Copilot logs `Invalid hook configuration` in its debug log without crashing the session.

## Open questions / follow-ups

- **Does the bundled SDK's `QueryHooks` API ever surface to external hook commands?** As of v1.0.40, no — the JSON-line adapter strips most output fields. If a future Copilot CLI release surfaces them (`additionalContext`, `modifiedPrompt`, etc.), revisit OMGHC's adapter to forward those.
- **Can hooks observe MCP tool calls?** `toolName` for an MCP-routed tool is the namespaced name (e.g., `omghc_state.read`). Confirmed indirectly via the SDK type but not yet smoke-tested with a real MCP server.
- **Plugin-install hook delivery.** `copilot plugin install` does not currently propagate plugin-bundled hook files into `.github/hooks/`. If OMGHC ships its hook config as part of a plugin published to `awesome-copilot`, the plugin's `postinstall` script (Node `package.json`) must do the copy explicitly. For local-dev / `omghc setup`, write directly to `<gitRoot>/.github/hooks/oh-my-ghcopilot.json` — this is the supported path.
