# Copilot CLI --prompt Mode (M3 day-0 spike)

This is the M3 day-0 spike result resolving R10 from the OMGHC port plan: does
GitHub Copilot CLI support a non-interactive (TTY-free) headless mode suitable
for use as a tmux team-worker process? **Yes.** This document records the exact
flag set, observed behavior, and the resulting design decision for `omghc team`
worker processes.

## Spike date / version

- Date: **2026-05-06**
- Copilot CLI version: **GitHub Copilot CLI 1.0.41** (`copilot --version`)
  - The plan still pins to v1.0.40; v1.0.41 was the version actually present
    on the spike machine after auto-update. Behavior described here applies to
    both because the `-p/--prompt` surface is identical between them per the
    `--help` output.
- OS: Windows 11 Enterprise 10.0.26200, Git Bash environment.
- Auth: persisted login under `~/.copilot/` (no `GH_TOKEN`/`GITHUB_TOKEN`/
  `COPILOT_GITHUB_TOKEN` set in this shell — the cached login was sufficient,
  consistent with `docs/auth.md` precedence rules).

## Non-interactive flag

The flag for non-interactive use is **`-p`** (long form **`--prompt`**),
documented as:

> `-p, --prompt <text>  Execute a prompt in non-interactive mode (exits after completion)`

Recommended full invocation for headless / scripted use:

```
copilot -p "<task>" --allow-all-tools --no-color [-s | --output-format json]
```

Mandatory companion flags for headless mode (per the help text and the spike):

- `--allow-all-tools` (or env `COPILOT_ALLOW_ALL=true`) — without this the agent
  would attempt to prompt for tool-use confirmation, which has no input source
  in non-interactive mode. The help string explicitly states it is *"required
  for non-interactive mode"*. There are also broader equivalents `--allow-all`
  and `--yolo` (allow tools + paths + URLs).
- `--no-color` — disables ANSI color codes so captured stdout is plain text and
  safe to pipe / log / parse.

Optional:

- `-s, --silent` — emit only the agent's final response to stdout, no stats.
  Use this when the leader treats the worker as a function call.
- `--output-format json` — emit JSONL events (one JSON object per line) to
  stdout. Use this when the leader needs structured streaming (turn boundaries,
  tool calls, usage stats).
- `--no-ask-user` — disables the `ask_user` tool entirely so the agent cannot
  even attempt to ask clarifying questions. Recommended for autonomous workers.
- `--add-dir <directory>` (repeatable) — extends the file-access allow-list
  beyond the worker's cwd. Pair with `--allow-all-paths` if you want to skip
  path verification entirely.
- `-n/--name <name>` — sets a session name so the worker shows up under a
  recognizable label in the session store.
- `--share`/`--share-gist` — persists a markdown transcript on completion.
  **Do NOT enable by default for OMGHC team workers** (writes a file per
  invocation, possibly large; uploads to a GitHub gist with `--share-gist`).
- `--log-dir <directory>` — redirects the per-session log file off the default
  `~/.copilot/logs/` location. Useful so worker logs land inside `.omghc/logs/`.
- `--no-auto-update` — skip CLI auto-update on launch (the help text says
  auto-update is already disabled when `CI=true` or other CI env vars are set,
  but make this explicit for OMGHC workers).

## TTY requirement

- **Without a TTY (stdout/stderr redirected to files, stdin piped):** ✅ works.
  Exact command run:

  ```
  copilot -p "Reply with exactly the literal text: OMGHC-PROBE-OK" \
      --allow-all-tools --no-color -s 2>stderr.txt 1>stdout.txt
  ```

  Result: exit code `0`, `stdout.txt` contained exactly `OMGHC-PROBE-OK\n`
  (16 bytes), `stderr.txt` empty (0 bytes). Wall time ~42 s for cold-start
  (MCP server connect, plugin load, model latency); subsequent JSON-mode probe
  was ~35 s.

- **JSON mode in the same redirected setup:** ✅ works. Exit `0`, ~20 JSONL
  events on stdout, empty stderr. Final `result` event includes
  `exitCode`, `usage.premiumRequests`, `usage.totalApiDurationMs`,
  `usage.sessionDurationMs`, and a `codeChanges` summary
  (`linesAdded`/`linesRemoved`/`filesModified`).

- **Through a tmux pane:** Not separately probed under spike-quota constraints,
  but the non-TTY behavior already proves a TTY is not required, so a tmux
  pane is unnecessary for *headless* workers. `tmux send-keys` *does* still
  work as an escape hatch (Copilot CLI supports interactive mode), but it is
  not the recommended path for OMGHC.

## Auth

- **`GH_TOKEN`/`GITHUB_TOKEN`/`COPILOT_GITHUB_TOKEN` are sufficient when set**,
  per `docs/auth.md` and `copilot help environment`. Precedence:
  `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`, all of which beat any
  cached login.
- **Cached login alone is also sufficient** — the spike ran with all three env
  vars unset (verified via `${#GH_TOKEN}`, `${#GITHUB_TOKEN}` reporting `0` —
  `COPILOT_GITHUB_TOKEN` was not exported either) and `copilot -p` completed
  successfully using the persisted credential under `~/.copilot/`.
- **No interactive login was triggered.** The probe never blocked waiting for
  input nor printed an OAuth device-code prompt.
- **No token contents were ever printed during the spike.** All probes used
  literal-echo prompts (`Reply with exactly the literal text: ...`) and
  redirected stdout/stderr to files which were inspected for size and head
  only.

Implication for `omghc team`: leader-side auth (env-var or cached login) is
inherited by workers via normal child-process env propagation. The leader does
**not** need to perform any per-worker auth handshake; it MUST forward the
auth env vars (already covered by the worker-bootstrap design — task #8 will
implement the propagation).

## Output behavior

- **stdout is the agent's response channel.** With `-s`, it is exactly the
  final assistant message text. Without `-s`, additional usage / stats may be
  appended.
- **stderr is empty under `--no-color -s`** for a successful run. The CLI
  appears to keep stderr reserved for genuine error / diagnostic output. This
  makes the standard "stdout = result, stderr = errors" UNIX contract honored
  and safe to use directly in shell pipelines.
- **Exit code `0` on success.** A non-zero exit is not yet observed in the
  spike (nothing was forced to fail) but the JSON-mode `result` event includes
  an explicit `exitCode` field, so the CLI clearly distinguishes success from
  failure.
- **Output is buffered, not streamed, in `text` mode (`-s`).** The spike
  observed the entire response arrive after the wall-clock completion of the
  agent turn. There is a `--stream <on|off>` flag that exists per `--help`,
  but turning it on for `-s` mode is unnecessary for OMGHC's leader/worker
  exchange (the leader treats each worker invocation as a single
  request/response).
- **JSON mode (`--output-format json`) is JSONL streaming.** Events observed
  during the probe (in the order they appear):

  | event `type` | meaning (inferred from data shape) |
  |---|---|
  | `session.mcp_server_status_changed` | per-MCP-server connect/disconnect transitions |
  | `session.mcp_servers_loaded` | snapshot of all MCP servers and their status |
  | `session.skills_loaded` | snapshot of available skills |
  | `session.tools_updated` | tool registry mutations (during MCP connect) |
  | `user.message` | the prompt text echoed back |
  | `assistant.turn_start` | start-of-turn marker, carries `turnId` |
  | `assistant.message_start` | start of an assistant message, carries `messageId` |
  | `assistant.message_delta` | streaming text chunks (`deltaContent`) |
  | `assistant.message` | finalized assistant message (`content`, `toolRequests`, `interactionId`, `turnId`, opaque `reasoningOpaque` blob) |
  | `assistant.reasoning` | reasoning artifact (opaque content) |
  | `assistant.turn_end` | end-of-turn marker |
  | `result` | terminal event with `sessionId`, `exitCode`, `usage` (`premiumRequests`, `totalApiDurationMs`, `sessionDurationMs`, `codeChanges`) |

  The `result` event is always last in the stream. Leader code treating the
  JSON stream as a state machine should commit on `result` and verify
  `exitCode === 0`.

## Tool execution

- **`--allow-all-tools` is the supported flag** to bypass interactive
  permission prompts. It is **required** for non-interactive mode per the
  CLI's own help text.
- The broader **`--allow-all` / `--yolo`** flags are equivalent to
  `--allow-all-tools --allow-all-paths --allow-all-urls` together. For OMGHC
  workers operating in a worktree we recommend just `--allow-all-tools` plus
  explicit `--add-dir` for any directories outside the worktree the worker
  must touch — this is more conservative than `--yolo`. Operators can opt in
  to `--yolo`/`--allow-all` via leader config if they want.
- `--allow-tool[=tools...]` / `--deny-tool[=tools...]` give per-tool
  granularity; `--allow-url[=urls...]` / `--deny-url[=urls...]` constrain
  network reach. None of these are needed for the M3 worker baseline; they
  remain available for fine-grained policy in later milestones.
- `--no-ask-user` stops the agent from invoking the `ask_user` tool. Combine
  with `--allow-all-tools` for fully autonomous workers that cannot request
  human input mid-task.
- `--secret-env-vars=KEY1,KEY2` strips listed env-var values from shell tools
  and MCP servers and redacts them from output. This is the right place to
  list `COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN` so worker logs and
  redirected output cannot leak the token even by accident.

## Recommendation for M3 worker model

**OPTION A — subprocess workers (RECOMMENDED).**

`omghc team` should spawn each `'copilot'` worker as a direct **child process**
running `copilot -p "<initial-prompt>" --allow-all-tools --no-color
--no-ask-user --no-auto-update --secret-env-vars=GH_TOKEN,GITHUB_TOKEN,COPILOT_GITHUB_TOKEN
[--output-format json]`, with stdout/stderr captured to per-worker log files
and exit code consumed for completion / retry signalling.

Justification (concrete observations from this spike):

1. **TTY is not required** for `copilot -p`. Output redirection works,
   exit-code semantics work, and stderr behaves correctly. There is no need
   to wrap the worker in a tmux pane purely to satisfy a TTY constraint —
   unlike Codex, where `src/team/runtime.ts:1347-1361` documents
   `PROMPT_MODE_CODEX_UNSUPPORTED_REASON = 'prompt_mode_codex_requires_tty'`
   and forbids prompt-mode workers from being Codex.
2. **Auth propagation is already solved** by the leader's env (env-var
   precedence or cached login under `~/.copilot/`). Subprocess inheritance
   gets us this for free.
3. **JSON-mode streaming gives us a clean state machine** for leader-side
   monitoring (turn boundaries, usage telemetry, terminal `result` event with
   explicit `exitCode`). This maps cleanly to how OMX's `state/workers.ts`
   tracks worker heartbeats and outcomes.
4. **Cost (engineering effort)**: Lower than the interactive-tmux variant. We
   reuse Node's `child_process.spawn`, set up env, and stream stdout. No
   `send-keys` choreography, no terminal-readiness polling, no Korean-IME or
   pane-stability quirks to inherit from OMX's tmux workers (those were
   genuine OMX pain — see `src/team/tmux-session.ts` for the polling
   constants and stability gating logic).
5. **HUD compatibility**: the OMX HUD reads from `.omx/state/`, not from tmux
   pane contents per se. As long as the subprocess worker writes its
   heartbeat / status into `.omghc/state/` via the worker-bootstrap shim
   (task #8), the HUD continues to work without a pane to render against.

**OPTION B — interactive tmux pane workers (NOT RECOMMENDED for `'copilot'`).**

Open a tmux pane, launch `copilot` (interactive), and drive it via
`send-keys`. This is what OMX does for Codex. **Don't do this for the Copilot
worker variant** because it imports the entire OMX tmux complexity (pane
stability polling, IME drift, Windows shell quirks, stale-pane cleanup) for
*zero* benefit when the CLI exposes a working `-p` mode. The cost is real:
~700 LOC of OMX tmux glue (`src/team/tmux-session.ts:1-700+`) we'd otherwise
have to keep in sync.

The interactive-tmux path may *still* be worth keeping as an escape hatch for
debugging or for environments where someone wants to watch the worker live,
but it should NOT be the default and it does NOT need to be implemented for
M3.

## Implications for `src/team/tmux-session.ts` (worker-4's #7)

The OMX file in question is `oh-my-codex/src/team/tmux-session.ts`. Concrete
guidance for the OMGHC port:

1. **Extend the `TeamWorkerCli` type** at `src/team/tmux-session.ts:88`:
   ```ts
   export type TeamWorkerCli = 'codex' | 'claude' | 'gemini' | 'copilot';
   ```
   Update every `if (workerCli === 'codex' || …)` / equivalent narrowing in
   the file to include `'copilot'`. The OMX-side scan already shows the hot
   spots: `tmux-session.ts:637, 678, 745, 912, 929, 932, 943, 1416, 1418,
   1419` plus `runtime.ts:1347-1361, 1416-1419, 1462, 1473, 1927, 1977,
   1992, 2130, 2242, 2394, 3783, 4037`.

2. **Add a `'copilot'` branch in `translateWorkerLaunchArgsForCli`** (around
   `tmux-session.ts:739`). Pattern, modeled on the existing Gemini branch:
   ```ts
   if (workerCli === 'copilot') {
     const translated: string[] = [
       '--allow-all-tools',
       '--no-color',
       '--no-ask-user',
       '--no-auto-update',
       '--secret-env-vars=GH_TOKEN,GITHUB_TOKEN,COPILOT_GITHUB_TOKEN',
     ];
     // model override, if any (analogous to the Gemini branch picking up MODEL_FLAG)
     const model = extractModelOverride(args);
     if (model) translated.push('--model', model);
     // initial prompt is passed via -p, not via stdin
     const trimmedPrompt = initialPrompt?.trim();
     if (trimmedPrompt) translated.push('-p', trimmedPrompt);
     // role-based execution bypass: only role-elevated workers get --allow-all-paths
     if (shouldGrantExecutionBypassForRole(workerRole)) {
       translated.push('--allow-all-paths');
     }
     return translated;
   }
   ```
   Drop OMX's Codex-only flags (`--ask-for-approval`, `--config`,
   `--bypass-permissions`, etc.) — Copilot does not understand them.

3. **For `'copilot'`, prefer the subprocess path, not the tmux pane path.**
   The cleanest split is to add a new function next to
   `buildWorkerProcessLaunchSpec` (around `tmux-session.ts:898`) called e.g.
   `buildCopilotSubprocessSpec` that returns `WorkerProcessLaunchSpec` *but*
   the caller (`runtime.ts`) treats `'copilot'` as taking the same path
   already used for `'claude'` / `'gemini'` prompt-mode workers in
   `runtime.ts:assertPromptModeWorkerCliSupported` (line 1355). That is, do
   the inverse of the Codex prohibition — **add `'copilot'` to the allowed
   prompt-mode CLIs**. No new constant analogous to
   `PROMPT_MODE_CODEX_UNSUPPORTED_REASON` is needed.

4. **`launchMode` defaulting**: the OMX env var `OMX_TEAM_WORKER_LAUNCH_MODE`
   accepts `'interactive' | 'prompt'` (line 90:
   `export type TeamWorkerLaunchMode = 'interactive' | 'prompt';`). Rename
   to `OMGHC_TEAM_WORKER_LAUNCH_MODE` and have `'copilot'` default to
   `'prompt'`. Operators who want pane-visible Copilot workers can set
   `'interactive'` explicitly.

5. **`WorkerSubmitPlan` adjustments**: the `submitKeyPressesPerRound` field
   (`tmux-session.ts:1418`) and `queueFirstRound`/`allowAdaptiveRetry`
   (`tmux-session.ts:1416, 1419`) are tmux-specific (number of `Enter`
   presses to flush a queued prompt). For prompt-mode `'copilot'` workers
   these should be no-ops because the prompt is delivered via the `-p`
   argument at launch, never via `send-keys`. Either guard at the call site
   or set `submitKeyPressesPerRound: 0, queueFirstRound: false,
   allowAdaptiveRetry: false` for `workerCli === 'copilot'`.

6. **Binary-availability check**: `assertTeamWorkerCliBinaryAvailable`
   (`tmux-session.ts:796`) already tries `<binary> --version`. `copilot
   --version` works (we used it in this spike), so no special-casing
   required — it'll just naturally accept `'copilot'` once the type is
   widened.

7. **Logging**: pass `--log-dir` pointing at `.omghc/logs/copilot/<worker-id>/`
   so worker logs are co-located with team state, easy to tail, and don't
   pollute the user's `~/.copilot/logs/` directory across many concurrent
   workers.

8. **Auth env**: pass through `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`,
   `GITHUB_TOKEN` (whichever are set) plus `COPILOT_HOME` (if set) and
   `COPILOT_GH_HOST` (if set) to the worker subprocess. List them in
   `--secret-env-vars` so they cannot leak through tool output. This belongs
   in `worker-bootstrap.ts` (task #8), not in `tmux-session.ts` — the latter
   only needs to *not strip* them from the spec it produces.

## Open follow-ups (NOT blocking M3)

- Run a real ~10s+ tool-using prompt in JSON mode to harvest the full event
  catalog (tool-call request/result events, error events). Today's spike used
  trivial echo prompts to stay within auth quota.
- Verify graceful shutdown on `SIGTERM`/`SIGINT` from leader. We expect
  Node's `child_process.kill()` to suffice but it has not been measured.
- Verify behavior under `COPILOT_OFFLINE=true` and BYOK
  (`COPILOT_PROVIDER_BASE_URL` set). Both should work — they're orthogonal
  to `-p` — but it would be good to confirm before claiming "OMGHC supports
  BYOK workers" in marketing.
- Decide whether to surface streaming `assistant.message_delta` events to the
  HUD for live worker output. Not required for M3; can be layered in later.
