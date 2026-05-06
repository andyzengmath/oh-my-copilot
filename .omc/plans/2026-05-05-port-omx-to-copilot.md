# Plan: Port oh-my-codex (OMX) → oh-my-ghcopilot (OMGHC)

**Author:** AndyZ
**Date:** 2026-05-06
**Status:** IN EXECUTION (M0 + M1a + M1b + M2a + M2b SHIPPED; M3, M4, M5 pending)
**Source:** `C:\Users\andyzeng\OneDrive - Microsoft\Documents\GitHub\oh-my-codex` @ v0.15.1
**Target:** `C:\Users\andyzeng\OneDrive - Microsoft\Documents\GitHub\oh-my-copilot` (active; `oh-my-ghcopilot` on npm)

**Revision history:**
- v1 (2026-05-05 13:06) — initial draft. Used names `oh-my-copilot` (npm) / `omc` (binary) / `.omc/` (state).
- v2 (2026-05-05 13:30) — post-Architect review. Renamed to `oh-my-ghcopilot` / `omghc` / `.omghc/` (CRITICAL: original names taken on npm); added Auth section (HIGH); elevated R10 with M3 day-0 spike (HIGH); fixed factual claims (LOC counts); fixed M1/M2 MCP ordering; added HTTP-hooks Plan B; updated D8 to acknowledge real M3 cost; added formal ADR.
- v2.1 (2026-05-05 15:35) — post-M1a auth spike. §A.2 doctor section corrected: env precedence is `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`; login cache lives in `config.json` `loggedInUsers` array (NOT `login-cache`); `copilot login --status` does not exist. `docs/auth.md` is authoritative.
- v2.2 (2026-05-06) — post-M2a hooks.json spike. Five corrections: (1) §9 R-new HTTP-POST fallback DELETED — schema only allows `type: "command"`; (2) added 4 confirmed risks: R-hooks-not-wired (CRITICAL — file-based hooks don't fire in v1.0.40 production), R-no-stop-event (HIGH — no Stop event; Ralph continuation needs redesign), R-plugin-install-no-local (MEDIUM), R-cross-platform-hooks (LOW — bash+powershell required); (3) §M2 hooks register at `<projectRoot>/.github/hooks/oh-my-ghcopilot.json`, NOT plugin manifest; (4) §M2 added `omghc doctor --probe-hooks` requirement; (5) `docs/copilot-native-hooks.md` is now authoritative hook reference.

---

## 0. RALPLAN-DR Summary (consensus mode, short)

### Principles (5)
1. **Substitution over redesign** — Copilot CLI's plugin shape (`plugin.json` with `agents/`, `skills/`, `hooks.json`, `.mcp.json`) closely mirrors Codex CLI's. Preserve OMX's proven architecture; rename surfaces only.
2. **TS-first, defer Rust to v1.x** — minimize MVP distribution complexity. Rust adds value only when local IO becomes the bottleneck; LLM latency dominates Copilot workflows.
3. **Plugin-mode default, legacy as escape hatch** — align with Copilot's first-class plugin delivery path; mirror OMX's 0.15.0 direction.
4. **Verbatim port + rename pass** — inherit OMX 0.15.1's 297 tests and validated invariants (claim-safe task lifecycle, Korean IME drift, BusyBox/Windows psmux fixes). Rewriting discards that hard-won knowledge.
5. **Cross-CLI optionality preserved** — keep OMX's mixed-worker capability so OMGHC can also drive Codex/Claude/Gemini workers in a single team. Avoids vendor lock-in.

### Decision Drivers (top 3)
1. **Maintainability vs. upstream drift** — port must stay close enough to OMX to absorb future improvements without rewriting. Drives verbatim copy + sync tooling.
2. **Time-to-MVP** — 5–6 week MVP via autonomous loop is the budget. Anything risking that budget gets deferred to v1.x.
3. **Risk surface** — three real unknowns: (a) Copilot's `hooks.json` JSON schema, (b) `copilot --prompt` headless behavior, (c) auth propagation under team workers. Everything else has documented equivalents.

### Viable Options (3, with invalidation)

**Option A — Verbatim port + rename pass + TS-only MVP (RECOMMENDED, the plan below)**
- *Pros:* fastest path to MVP; inherits OMX bug fixes and 297 tests; easy upstream sync; low cognitive load.
- *Cons:* inherits OMX architectural debt (`runtime.ts` at 4,752 LOC); Rust deferred risks ~5–10× sparkshell performance gap on large monorepos.

**Option B — Rewrite from scratch using OMX as reference architecture**
- *Pros:* clean codebase; opportunity to fix OMX patterns; native-Copilot ergonomics.
- *Cons:* 3–5× longer (15–30 weeks); loses upstream sync; loses 297 tests of validated invariants; forces re-discovery of edge cases OMX has solved.
- **REJECTED** — OMX's architecture is mature (v0.15.1, multiple production deployments). Rewriting discards the moat. Cost-to-quality unfavorable until OMX shows fundamental flaws (it does not).

**Option C — Verbatim port with full Rust crate parity from M0**
- *Pros:* matches OMX 1:1; no v1.x migration debt.
- *Cons:* doubles distribution complexity (cross-platform binaries); most users LLM-bound not local-IO-bound; slows M0–M4 by ~30%.
- **REJECTED for v0.x** — perf gap hypothetical for MVP; defer to v1.x. TS shim seams in the new `src/compat/` directory keep this reversible.

### Pre-mortem (deferred; this is short mode)
Greenfield, fully reversible, no production system at risk. If user requests `--deliberate`, expand with 3 failure scenarios (hooks.json schema breaks mid-port, GitHub deprecates plugin format, OMX maintainers refuse coordination) and unit/integration/e2e/observability test plan per phase.

---

## 1. Goal

Build `oh-my-ghcopilot` (OMGHC) — a comprehensive harness-engineering plugin and runtime layer for **GitHub Copilot CLI** (`@github/copilot`), structurally analogous to `oh-my-codex` (OMX) for OpenAI Codex CLI.

OMGHC must expose the same workflow primitives — `$deep-interview`, `$ralplan`, `$team`, `$ralph` — plus skills, prompts, hooks, MCP servers, and a coordinated parallel team runtime, but targeting Copilot CLI's plugin/extension model and configuration surface (`~/.copilot/`).

Success means: a Copilot user can run `npm install -g oh-my-ghcopilot && omghc setup` and immediately enjoy the same `$ralph` / `$team` / `$ralplan` workflow, plus parallel tmux team execution, plus durable `.omghc/` state.

---

## 2. Source & Target Summary

### Source: oh-my-codex (OMX) v0.15.1

- **Stack:** TypeScript (`src/`) + 5 Rust crates in `crates/` (omx-explore, omx-mux, omx-runtime-core, omx-runtime, omx-sparkshell).
- **Verified file sizes (corrected from v1):**
  - `src/cli/setup.ts`: **3,094 LOC** (v1 incorrectly said 5,155)
  - `src/hooks/agents-overlay.ts`: **686 lines / ~21 KB**
  - `src/team/runtime.ts`: **4,752 lines** (the largest single file and primary tech-debt liability)
  - `src/cli/index.ts` dispatcher: **~3,900 LOC**
- **Surface:** 39 skills (`skills/*/SKILL.md`), 33 role prompts (`prompts/*.md`), 5 MCP servers (state, memory, code-intel, trace, wiki), 79 team-runtime files in `src/team/`, 297 test files.
- **Plugin layout:** `plugins/oh-my-codex/{plugin.json, .mcp.json, skills/, .codex-plugin/}` mirrored from canonical `skills/`+`prompts/`. Legacy mode also supported.
- **Distribution:** `npm install -g oh-my-codex` → `omx` binary; postinstall hooks bootstrap setup; Rust binaries shipped under `dist/bin/`.
- **State model:** `.omx/{state,plans,drafts,hooks,wiki,logs,memory}/` per-project.
- **Hooks:** native `.codex/hooks.json` registrations + OMX-managed `.mjs` plugins. Events: SessionStart, PreToolUse, PostToolUse, Stop.
- **`src/compat/` directory:** does NOT exist in OMX as production code (only test fixtures). Will be a NET-NEW directory in OMGHC.
- **Worker CLI support:** `src/team/tmux-session.ts:88` defines `TeamWorkerCli = 'codex' | 'claude' | 'gemini'`. **No `copilot` variant exists today.** Adding it is part of M3.
- **Codex prompt-mode rejection:** `src/team/runtime.ts:1347-1361` (`PROMPT_MODE_CODEX_UNSUPPORTED_REASON`) explicitly rejects Codex as a prompt-mode worker because Codex requires a TTY. Only Claude and Gemini run in non-interactive prompt mode in OMX. **This is a critical precedent for R10 below.**

### Target: GitHub Copilot CLI (GA Feb 2026)

- **Stack:** Node.js CLI; `@github/copilot` npm package → `copilot` binary.
- **Home:** `~/.copilot/`.
- **Auth:** `GH_TOKEN` or `GITHUB_TOKEN` env var (OAuth via `copilot login` populates them). `GH_TOKEN` takes precedence per `github/copilot-cli` README.
- **Configuration files:**
  - `~/.copilot/settings.json` — top-level settings; cascading user → repo → local scope.
  - `~/.copilot/mcp-config.json` — MCP servers `{ "mcpServers": { "<name>": { type: "local"|"stdio"|"http"|"sse", command, args, url, tools, env, headers, timeout, cwd, oidc } } }`.
  - `~/.copilot/agents/*.agent.md` (or `*.md`) — custom agent markdown with frontmatter `description, model, system, tools, skills`.
  - `~/.copilot/instructions.md` — custom instructions (set via `copilot init` / `/init`).
- **Plugin model:** `plugin.json` at plugin root. Required: `name, description, version`. Optional: `author, license, keywords, agents (dir), skills (array|string of dirs), hooks (path to hooks.json), mcpServers (path to .mcp.json)`. Install via `copilot plugin install ./path`. Default marketplaces: `copilot-plugins`, `awesome-copilot`.
- **Subcommands:** `copilot` (interactive), `copilot mcp {list|get|add|remove}`, `copilot plugin`, `copilot init`, `copilot login`, `copilot update`, `copilot version`, `copilot completion`, `copilot help`.
- **Slash commands** (relevant): `/agent, /skills, /plan, /plugin, /mcp, /instructions, /init, /delegate, /fleet, /research, /ask, /review, /diff, /undo, /rewind, /session, /resume, /clear, /new, /reset, /compact, /chronicle, /tasks, /share, /export, /yolo, /allow-all, /add-dir, /list-dirs, /reset-allowed-tools, /copy, /changelog, /login, /logout, /user, /pr, /remote, /connect, /feedback, /lsp, /model, /experimental, /theme, /help, /version`.
- **Hooks (per M2a spike, see `docs/copilot-native-hooks.md`):** 6 events — `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`. **No `Stop` event.** Hooks discovered at `<gitRoot>/.github/hooks/**/*.json` only (NOT registered via plugin manifest). Schema: `{ version: 1, hooks: { <event>: HookEntry[] } }` where `HookEntry = { type: "command", bash?, powershell?, cwd?, env?, timeoutSec? }` — at least one of `bash`/`powershell` required. **No HTTP variant exists.** **CRITICAL:** file-based hooks DO NOT FIRE in Copilot CLI v1.0.40 production binary; schema validates and processor registers but the bridge from `Session.hooks` to `preToolsExecution` is incomplete. M2b must build for forward-compat.

### Architectural compatibility verdict

Copilot CLI's plugin shape is close to Codex's, but **three known mismatches require explicit handling, not rename-only substitution:**

| OMX / Codex | OMGHC / Copilot | Compatibility |
|-------------|------------------|---------------|
| `~/.codex/` | `~/.copilot/` | direct rename |
| Codex `config.toml` | Copilot `settings.json` | format change (TOML → JSON); **non-trivial in setup.ts** |
| `.mcp.json` `{servers: {...}}` | `mcp-config.json` `{mcpServers: {...}}` | rename top-level key |
| Codex `agents/*.toml` (TOML, see `src/agents/native-config.ts:53` `generateAgentToml`) | `agents/*.agent.md` (Markdown + YAML frontmatter) | **format rewrite, not rename** |
| `skills/<name>/SKILL.md` | `skills/<name>/SKILL.md` | identical |
| Codex `hooks.json` | Copilot `hooks.json` | **schema CONFIRM in M2 day-1 spike** |
| Codex plugin manifest | Copilot `plugin.json` | matching field set |
| OMX keyword `$ralph` | Copilot keyword `$ralph` (via OMGHC keyword-detector hook) | direct |
| OMX worker via `codex exec` (TTY-required, see runtime.ts:1347) | OMGHC worker via `copilot --prompt` (TTY-status UNVERIFIED) | **R10: spike at M3 day-0** |
| Auth: `OPENAI_API_KEY` | Auth: `GH_TOKEN`/`GITHUB_TOKEN` | **non-trivial worker env propagation, see §A** |

---

## 3. Naming & Conventions

| Concept | OMX | OMGHC (proposed; verified-available 2026-05-05) |
|---------|-----|--------------------------------------------------|
| npm package | `oh-my-codex` | **`oh-my-ghcopilot`** (verified E404) |
| binary name | `omx` | **`omghc`** (must verify nothing else on user PATH; npm itself doesn't enforce bin uniqueness) |
| state directory | `.omx/` | **`.omghc/`** |
| keyword prefix | `$ralph`, `$team`, ... | preserved verbatim |
| MCP server prefix | `omx_state`, ... | **`omghc_state`, `omghc_memory`, `omghc_trace`, `omghc_wiki`, `omghc_code_intel`** |
| target CLI home | `~/.codex/` | `~/.copilot/` |
| plugin dir (in repo) | `plugins/oh-my-codex/` | `plugins/oh-my-ghcopilot/` |
| env policy var | `OMX_LAUNCH_POLICY` | `OMGHC_LAUNCH_POLICY` |
| AGENTS markers | `<!-- OMX:AGENTS:START --> ... <!-- OMX:AGENTS:END -->` | `<!-- OMGHC:AGENTS:START --> ... <!-- OMGHC:AGENTS:END -->` |

**Names verified taken on npm (must NOT use):** `oh-my-copilot@4.13.45`, `oh-my-pilot@1.2.8`, `oh-my-githubcopilot@1.5.7`, `omc@1.0.1`.

**Names verified available (E404):** `oh-my-ghcopilot`, `oh-my-ghc`, `oh-my-cp`, `oh-my-ghcp`, `oh-my-ghpilot`, `ohcopilot`, `copilot-harness`, `pilothouse-cli`, `ghpilot-harness`. Recommend `oh-my-ghcopilot` to most preserve the OMX→OMGHC parallel.

**Decision D1 status:** PROPOSED, awaiting user confirmation. If user prefers a different finalist (e.g., `copilot-harness`, `pilothouse-cli`), substitute throughout before M0.

---

## 4. Architecture Mapping

| OMX Surface | LOC / Files | OMGHC Equivalent | Effort |
|-------------|-------------|-------------------|--------|
| `src/cli/index.ts` (dispatcher) | ~3,900 LOC | `src/cli/index.ts` — same router, renamed subcommands | M |
| `src/cli/setup.ts` | **3,094 LOC** (corrected) | `src/cli/setup.ts` — writes `settings.json`, `mcp-config.json`, `agents/*.agent.md`, `instructions.md`. Includes TOML→JSON config translator. | L |
| `src/cli/doctor.ts` | ~500 LOC | direct port; **plus `copilot login` status check (§A)** | S |
| `skills/{39 dirs}` | 39 SKILL.md | direct copy with rename pass | S |
| `prompts/{33 .md}` | 33 prompts | direct copy | S |
| `src/agents/native-config.ts:53 generateAgentToml` | TOML generator | **rewrite as `generateAgentMarkdown`** (YAML frontmatter + body) | S |
| `src/mcp/state-server.ts` | ~210 LOC | direct port; rename `omx_state`→`omghc_state` | S |
| `src/mcp/memory-server.ts` | ~200 LOC | direct port | S |
| `src/mcp/trace-server.ts` | ~200 LOC | direct port | S |
| `src/mcp/wiki-server.ts` | ~250 LOC | direct port | S |
| `src/mcp/code-intel-server.ts` | LSP parity | direct port (defer to M3) | S |
| `src/hooks/extensibility/*` | ~93 files | port; adapt to Copilot hook contract (see §9 R1, R-new) | M |
| `src/hooks/keyword-detector.ts` | 1,195 LOC | direct port — `$ralph`/`$team`/etc detection unchanged | S |
| `src/hooks/agents-overlay.ts` | **686 lines / ~21 KB** (corrected) | port; output compatible with `~/.copilot/agents/` and `~/.copilot/instructions.md` | S |
| `src/hooks/session.ts` | 13,181 B | port | S |
| `src/hooks/prompt-guidance-contract.ts` | 11,339 B | direct port | S |
| `src/hooks/triage-heuristic.ts` | 13,978 B | direct port | S |
| `src/team/runtime.ts` | **4,752 lines** (corrected — largest single file; PRIMARY TECH-DEBT TARGET for v1.x refactor) | port; **add `'copilot'` worker CLI variant in `tmux-session.ts:88` `TeamWorkerCli`** | M |
| `src/team/tmux-session.ts:739 translateWorkerLaunchArgsForCli` | per-CLI flag translation | **add Copilot branch** (~20–30 LOC) | S |
| `src/team/{rest of 79 files}` | runtime + state + policies | direct port | M |
| `src/hud/*` | tmux pane HUD | direct port (CLI-agnostic) | S |
| `templates/AGENTS.md` | 23,811 B | port (also wire to `~/.copilot/instructions.md`) | S |
| **NEW: `src/compat/` directory** | DOES NOT exist in OMX as production code | **net-new directory** holding: `copilot-hook-adapter.ts`, `worker-cli-adapter.ts`, `sparkshell-shim.ts`, `auth-adapter.ts` | S |
| `crates/{5 Rust}` | 5 crates | DEFERRED to v1.x | — |
| `plugins/oh-my-codex/` | mirrored plugin | `plugins/oh-my-ghcopilot/` with Copilot `plugin.json` schema | S |

Effort labels: S = ≤2 days, M = 1 week, L = >1 week.

---

## 5. Repo Layout (target)

```
oh-my-copilot/                          (Git repo dir; npm pkg name = oh-my-ghcopilot)
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE                             # MIT
├── package.json                        # name=oh-my-ghcopilot, bin.omghc=dist/cli/omghc.js
├── tsconfig.json
├── biome.json
├── .gitignore
├── .github/workflows/ci.yml
├── src/
│   ├── cli/{omghc.ts, index.ts, setup.ts, doctor.ts, exec.ts, team.ts, hud.ts,
│   │       wiki.ts, explore.ts, question.ts, state.ts, trace.ts, mcp-serve.ts,
│   │       uninstall.ts, update.ts, version.ts, status.ts, cancel.ts, list.ts,
│   │       notify.ts, reasoning.ts, hooks.ts, tmux-hook.ts, agents-init.ts}
│   ├── mcp/                            # 5 stdio MCP servers + bootstrap
│   ├── hooks/                          # extensibility, keyword-detector, agents-overlay, session, triage
│   ├── team/                           # tmux/psmux runtime, workers, worktrees, mailbox, dispatch
│   ├── state/                          # mode state operations
│   ├── catalog/                        # skill/prompt/agent registry reader
│   ├── question/                       # blocking-question UI
│   ├── runtime/                        # run-outcome contract
│   ├── hud/
│   ├── agents/                         # generateAgentMarkdown (Markdown frontmatter format)
│   ├── compat/                         # NET-NEW shim layer
│   │   ├── copilot-hook-adapter.ts     # JSON schema bridge for hooks.json
│   │   ├── worker-cli-adapter.ts       # per-CLI flag translation, includes Copilot branch
│   │   ├── sparkshell-shim.ts          # TS subprocess fallback for Rust sparkshell
│   │   └── auth-adapter.ts             # GH_TOKEN/GITHUB_TOKEN propagation
│   └── scripts/
├── skills/                             # 21+ SKILL.md folders (M1) → 39 (M5)
├── prompts/                            # 30+ role prompts
├── agents/                             # *.agent.md sources
├── templates/                          # AGENTS.md, instructions.md.tmpl, settings.seed.json
├── plugins/oh-my-ghcopilot/            # plugin.json, hooks.json, .mcp.json, agents/, skills/
├── docs/
└── crates/                             # placeholder, no contents until v1.x (DEFERRED)
```

(The current `oh-my-copilot/.omc/plans/` is the Claude-Code planner's workspace, not OMGHC's runtime state. OMGHC's project state lives under `.omghc/` in user projects.)

---

## 6. Stack Decision

**TypeScript-only for v0.x. Defer Rust crates to v1.x.** Trade-off: ~5–10× slower sparkshell on hot paths, acceptable because LLM dominates session latency.

---

## 7. MVP Scope (M0–M4)

### IN MVP
- `omghc` CLI binary with subcommands: `setup, doctor, exec, team, hud, state, mcp-serve, version, help, cancel, status, wiki, explore, question, update, uninstall, list, agents-init, reasoning, tmux-hook, hooks, notify`
- Skills (~21 of 39): `ralph, ralplan, team, deep-interview, autopilot, plan, code-review, tdd, doctor, omghc-setup, worker, pipeline, hud, wiki, cancel, help, note, git-master, analyze, build-fix, ai-slop-cleaner`
- Prompts: 30+ role prompts ported verbatim
- MCP servers: `omghc_state, omghc_memory, omghc_trace, omghc_wiki` (defer `omghc_code_intel` to M3)
- Hooks: keyword-detector, agents-overlay, session lifecycle
- Plugin packaging
- Team runtime (Linux/macOS first)
- AGENTS.md / `instructions.md` generation
- **Auth integration: §A**

### OUT (deferred)
- Rust crates
- Visual-Ralph, Ralph persistence, ultra*, swarm, autoresearch
- Adapt for OpenClaw/Hermes
- Sparkshell native binary
- i18n (15 README languages)
- Skills: `ultrawork, ultraqa, swarm, autoresearch, frontend-ui-ux, web-clone, visual-ralph, visual-verdict, deepsearch, ecomode, configure-notifications, ask-claude, ask-gemini, security-review, skill, trace, review`

---

## 8. Phased Roadmap

### M0 — Scaffold (1–2 days) — **SHIPPED 2026-05-05, commit `f397693`**
**Acceptance:**
- [ ] `package.json` with `name=oh-my-ghcopilot`, `bin.omghc=dist/cli/omghc.js`, `engines.node>=20`, `type=module`
- [ ] `tsconfig.json` strict, `target=es2022`, `module=node20`, `outDir=dist`
- [ ] `biome.json` lint config
- [ ] `src/cli/omghc.ts` boots; `omghc version` prints `oh-my-ghcopilot v0.0.1`
- [ ] CI workflow runs lint + build + node tests on Linux + macOS + Windows
- [ ] `README.md`, `LICENSE` (MIT), `.gitignore` (excludes `.omghc/`, `dist/`, `node_modules/`, `coverage/`)
- [ ] Initial commit on `main`

**Verification:** `npm install && npm run build && node dist/cli/omghc.js version` prints expected version. CI green on three platforms.

---

### M1 — Core skills, prompts, setup, doctor (1 week) — **SHIPPED 2026-05-05, commits `6dbcb2e` (M1a+M1b) + `41c9ae6` (plan correction)**
**Acceptance:**
- [ ] 21 skills copied to `skills/` with rename pass (Codex→Copilot, omx→omghc text refs)
- [ ] 30+ prompts copied
- [ ] `agents/*.agent.md` synthesized from prompts via NEW `src/agents/generateAgentMarkdown.ts` (YAML frontmatter `description, model, system, tools, skills` + body)
- [ ] `templates/AGENTS.md` ported with `<!-- OMGHC:AGENTS:START -->` markers
- [ ] `templates/instructions.md.tmpl`, `templates/settings.seed.json`
- [ ] `omghc setup` writes:
  - `~/.copilot/settings.json` (creates if missing, merges between markers if exists)
  - `~/.copilot/agents/*.agent.md`
  - `~/.copilot/skills/*/SKILL.md` (legacy mode) OR registers plugin (plugin mode, default)
  - `~/.copilot/instructions.md`
  - `.copilot/.omghc-setup-stamp` (timestamp + scope + version)
  - **DOES NOT yet write `mcp-config.json` references to OMGHC servers** — deferred to M2 to avoid the M1/M2 ordering bug. Setup prints "MCP server registration pending — run `omghc setup --finalize-mcp` after M2 build."
- [ ] `omghc setup --plugin` (default) vs `omghc setup --legacy` flag
- [ ] `omghc setup --merge-agents` preserves user content between markers
- [ ] `omghc doctor` checks:
  - Copilot CLI installed + version
  - **`copilot login` status (§A)**: invoke `copilot --version` AND check that `GH_TOKEN` or `GITHUB_TOKEN` is set OR that `copilot login` has produced a session (via `copilot login --status` or equivalent — confirm in M0 spike)
  - Node 20+
  - `~/.copilot/settings.json` has OMGHC entries
  - skills installed; agents registered
  - Project `.omghc/` writable
- [ ] `omghc uninstall` removes managed assets, preserves user content
- [ ] `omghc list --json` lists installed skills + prompts + agents

**Verification:** Clean machine: `npm install -g . && omghc setup && omghc doctor` exits 0 with no warnings. `cat ~/.copilot/settings.json` shows OMGHC entries. `cat ~/.copilot/agents/ralph.agent.md` shows valid frontmatter. Run a Copilot session; `/skills` lists OMGHC skills.

---

### M2 — Hooks + State + MCP servers (1 week) — **SHIPPED 2026-05-06: M2a commit `065626a` (4 MCP servers + bootstrap + CLI parity + hooks.json spike); M2b commit `4f8aa47` (5 hook ports + native-hook adapter + plugin manifests + setup hook-write + finalize-mcp functional + doctor --probe-hooks). 26 new tests, 94 cumulative tests pass.**

**Day-1 spike (BLOCKS rest of M2):**
- Install Copilot CLI on a test machine. Register a no-op preToolUse hook in a sample plugin's `hooks.json`. Capture stdin event JSON to file. Confirm exact event shape, exit-code semantics, JSON output contract. Document in `docs/copilot-native-hooks.md`. Lock Copilot CLI version in CI.
- **Plan B if Copilot only supports HTTP-POST hooks (R-new):** add a lightweight Express/Fastify server inside `omghc mcp-serve` (~100 LOC) that hosts the hook endpoint at `http://127.0.0.1:<port>/hook/{event}`. Registers in `hooks.json` as URL-based hook.

**Acceptance:**
- [ ] `src/mcp/state-server.ts` exposes `state_read|write|clear|list_active|get_status`. Modes: `autopilot, autoresearch, team, ralph, ultrawork, ultraqa, ralplan, deep-interview, skill-active`.
- [ ] `src/mcp/memory-server.ts`, `src/mcp/trace-server.ts`, `src/mcp/wiki-server.ts` ported.
- [ ] `omghc mcp-serve <name>` launches stdio MCP target.
- [ ] `omghc state {read|write|clear|list}`, `omghc wiki {list|query|lint|refresh}`, `omghc trace {summary|timeline}` CLI parity.
- [ ] `src/hooks/keyword-detector.ts`, `src/hooks/agents-overlay.ts`, `src/hooks/session.ts` ported.
- [ ] **Per M2a spike correction:** hooks live at `<projectRoot>/.github/hooks/oh-my-ghcopilot.json`, NOT in `plugins/oh-my-ghcopilot/`. (Copilot only discovers hooks under `<gitRoot>/.github/hooks/**/*.json`; plugin manifest does NOT support a `hooks` field.) `omghc setup` writes this file directly to the active project. M2b hook ports build for forward-compat; expect no-op behavior against v1.0.40 (R-hooks-not-wired).
- [ ] `omghc doctor --probe-hooks`: drops a marker hook into `<projectRoot>/.github/hooks/`, fires `copilot --prompt "list files"`, asserts the marker fired. PASS = Copilot wiring shipped; FAIL = expected today (canonical detection mechanism per R-hooks-not-wired).
- [ ] `dist/scripts/copilot-native-hook.js` reads stdin JSON, dispatches to OMGHC plugin runtime, writes stdout JSON. **Note:** preToolUse output mapper only forwards `{permissionDecision, permissionDecisionReason}` — other events' outputs are parsed and discarded by Copilot CLI v1.0.40.
- [ ] **NEW from M1 deferral**: `omghc setup --finalize-mcp` registers OMGHC MCP servers in `~/.copilot/mcp-config.json` with `"command": "omghc"` (which is now globally installed; doctor verifies).
- [ ] **Plugin chicken-and-egg fix:** plugin's `.mcp.json` must use either (a) `"command": "omghc"` and rely on global install (simplest), OR (b) `"command": "node"` with `args: ["${PLUGIN_ROOT}/dist/scripts/mcp-serve.js", "<server-name>"]` to be self-contained. Pick (a) for v0.x; doctor enforces global install.

**Verification:**
- `omghc mcp-serve omghc_state` answers JSON-RPC `tools/list` with 5 expected state tools.
- Real Copilot session, type `$ralph foo` → keyword-detector activates ralph state (verify via `omghc state list`).
- preToolUse hook denies a configured-blocked tool name.
- postToolUse hook writes `.omghc/logs/postuse.jsonl`.

---

### M3 — Team runtime (2 weeks)

**Day-0 spike (BLOCKS rest of M3) — R10 mitigation:**
- Validate `copilot --prompt "<task>"` as headless subprocess (no TTY, piped stdin/stdout, exits on completion).
- Specifically test: (1) does it require TTY? (2) does it stream tokens or buffer? (3) what is the exit-code contract? (4) does it inherit `GH_TOKEN` from env or require `copilot login` per worker?
- **Fallback if `copilot --prompt` requires TTY (matching the Codex precedent at `runtime.ts:1347-1361`):** treat Copilot like Codex in OMX — interactive tmux pane workers, not subprocess workers. Worker bootstrap launches `copilot` interactively in the pane and feeds the prompt via tmux send-keys. This is the OMX-proven pattern; it costs ~3 extra days of M3 vs the subprocess-worker happy path but is well-trodden.

**Acceptance:**
- [ ] `omghc team N:role "task"` spawns N tmux/psmux panes; each runs a Copilot worker (subprocess if spike confirms; tmux interactive if not).
- [ ] Shared task state in `.omghc/state/team-{name}/tasks.json` with claim-safe lifecycle.
- [ ] Mailbox in `.omghc/state/team-{name}/mailbox/`.
- [ ] Heartbeat every 30s; leader detects stale workers.
- [ ] Git worktree per worker (optional `--worktree` flag).
- [ ] `omghc team {status|resume|shutdown}` lifecycle commands.
- [ ] `omghc team api` JSON envelope CLI matching OMX shape.
- [ ] `omghc hud --watch` shows team status.
- [ ] **Cross-CLI worker support (D8): NOT free, costs ~3–5 days.** Add `'copilot'` to `TeamWorkerCli` enum at `src/team/tmux-session.ts:88`. Add Copilot branch to `translateWorkerLaunchArgsForCli` at `tmux-session.ts:739` (~20–30 LOC). Add Copilot to `resolveTeamWorkerCli` defaults. Update `OMGHC_TEAM_WORKER_CLI_MAP` parser. Update worker model defaults (Copilot model defaults to `claude-sonnet-4.5` per CLI docs).
- [ ] Worker auth (§A): each worker pane inherits `GH_TOKEN` (or `GITHUB_TOKEN`) from the leader's env. Bootstrap script asserts auth-env presence before launching `copilot`. If unset and no `~/.copilot/login-cache`, fail closed with actionable error.
- [ ] Coverage: ≥78% lines on `src/team/` and `src/state/`.

**Verification:**
- `omghc team 3:executor "noop"` creates tmux session, distributes tasks, completes, shuts down cleanly.
- `omghc team api create-task --json` returns valid envelope.
- Ported tests pass: `cross-rebase-smoke.test.ts`, `worker-runtime-identity.test.ts`, `hardening-e2e.test.ts`.

---

### M4 — Plugin packaging + polish (1 week)

**Acceptance:**
- [ ] `plugins/oh-my-ghcopilot/plugin.json` with required Copilot fields + contributions.
- [ ] `npm run sync:plugin` mirrors `skills/`, `prompts/` (as agents), `agents/` into plugin dir.
- [ ] `npm run verify:plugin-bundle` parity test.
- [ ] `copilot plugin install ./plugins/oh-my-ghcopilot` works on clean Copilot install.
- [ ] `npm prepack` runs `build → verify:native-agents → sync:plugin → verify:plugin-bundle`.
- [ ] Slack/Discord notification routing via `omghc notify`.
- [ ] `omghc cancel`, `omghc status`, `omghc reasoning {low|medium|high|xhigh}` ported.
- [ ] Documentation: `README.md, DEMO.md, docs/getting-started.md, docs/skills.md, docs/agents.md, docs/copilot-native-hooks.md, docs/auth.md, CHANGELOG.md` (v0.1.0 entry).
- [ ] CI green on Linux + macOS + Windows; coverage thresholds met.

---

### M5 (deferred) — Rust crates, Visual-Ralph, Ralph persistence, advanced skills, i18n

---

## §A. Auth (NEW SECTION)

Copilot CLI uses `GH_TOKEN` or `GITHUB_TOKEN` for auth (OAuth-based via `copilot login`); OMX uses `OPENAI_API_KEY`. Auth touches three OMGHC surfaces:

### A.1 — `omghc setup`
- Detects whether `copilot login` is required (no token, no `~/.copilot/login-cache`).
- Does NOT run `copilot login` interactively (avoids stdin hijack); prints actionable instructions.
- Does NOT persist tokens. Auth state lives entirely in `~/.copilot/` per Copilot CLI's contract.

### A.2 — `omghc doctor`
- Verifies Copilot CLI binary and version.
- Verifies auth via one of:
  1. **Env var precedence (per M1a auth spike):** `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`. First non-empty wins. (Original plan text said "`GH_TOKEN` or `GITHUB_TOKEN`" — the M1a spike found `COPILOT_GITHUB_TOKEN` is the highest-precedence variant.)
  2. **Login cache:** parse `${COPILOT_HOME:-~/.copilot}/config.json` for a non-empty `loggedInUsers` array (each entry has `host`, `login` fields). (Original plan text speculated `~/.copilot/login-cache` — the M1a spike confirmed `config.json` is the actual location.)
- **`copilot login --status` does NOT exist** on Copilot CLI v1.0.40 (spike-confirmed). Doctor MUST NOT invoke `copilot login` — that starts an interactive OAuth device flow and would prompt the user.
- **BYOK mode:** if `COPILOT_PROVIDER_BASE_URL` is set, doctor notes BYOK mode active but does NOT fail; the user is using their own LLM endpoint with separate auth.
- If neither env var nor login cache: reports HIGH severity with advice `copilot login`.
- **MUST NEVER print token contents** to stdout/stderr/logs (security).
- See `docs/auth.md` for the authoritative auth model and supported token types (fine-grained PAT with "Copilot Requests" permission, OAuth tokens from Copilot CLI app or `gh` CLI app; classic PATs `ghp_*` not supported).

### A.3 — Team worker auth (`omghc team`)
- Each tmux pane inherits the leader's env, propagating `GH_TOKEN`.
- Worker bootstrap script (in `src/team/worker-bootstrap.ts`) asserts auth-env presence before `copilot` launch. Fails closed with actionable error if missing.
- Mixed-CLI workers (D8): Codex workers still need `OPENAI_API_KEY`; Claude workers need `ANTHROPIC_API_KEY`; Gemini workers need `GEMINI_API_KEY`. Bootstrap script branches per-CLI and validates only the relevant env vars.

### A.4 — Sparkshell shim
- TS sparkshell shim (`src/compat/sparkshell-shim.ts`) calls `copilot --prompt` for summarization. Inherits same auth as workers.

### A.5 — Documentation
- `docs/auth.md` documents env var cascade, `copilot login` flow, mixed-CLI worker auth, and CI auth (pin `GH_TOKEN` to a fine-grained PAT).

---

## 9. Risks & Mitigations

| # | Risk | Severity | Likelihood | Mitigation |
|---|------|----------|------------|------------|
| R1 | Copilot CLI hooks JSON schema differs materially from Codex's | HIGH | MEDIUM | M2 day-1 spike captures exact event JSON. Adapter behind `src/compat/copilot-hook-adapter.ts`. Lock Copilot CLI version in CI. |
| ~~R-new~~ | ~~Copilot only supports HTTP-POST hooks~~ | — | — | **DELETED — disproven by M2a spike.** `hooks.json` schema only allows `type: "command"`; no URL/HTTP variant exists. See `docs/copilot-native-hooks.md`. |
| R-hooks-not-wired | File-based hooks DO NOT FIRE in Copilot CLI v1.0.40 production binary (schema validates, processor registers, but `preToolsExecution` invocation path is not wired to `Session.hooks`). | CRITICAL | CONFIRMED | M2b hook ports build for forward-compat; no-op behavior expected against v1.0.40. New `omghc doctor --probe-hooks` is the canonical detection mechanism — drops a marker hook, fires a tool call, asserts firing. PASS = wiring landed; FAIL = expected today. |
| R-no-stop-event | Copilot hooks have NO `Stop` event (6 events: sessionStart, sessionEnd, userPromptSubmitted, preToolUse, postToolUse, errorOccurred). | HIGH | CONFIRMED | Ralph/ultrawork/team continuation cannot port verbatim from OMX. M3 design must use `sessionEnd` hook + persisted re-invocation hint + `omghc continue` wrapper. |
| R-plugin-install-no-local | `copilot plugin install` does NOT accept local paths (only `owner/repo`, marketplace, archive URLs). | MEDIUM | CONFIRMED | OMGHC's `plugins/oh-my-ghcopilot/` is internal mirror only; plugin distribution requires a marketplace strategy or direct file delivery via `omghc setup`. M4 decision. |
| R-cross-platform-hooks | Every hook entry must set BOTH `bash` AND `powershell` fields (runtime picks via `process.platform === "win32"`). | LOW | CONFIRMED | `omghc setup` must emit dual-script entries when writing `.github/hooks/oh-my-ghcopilot.json`. Dispatcher script is identical (`node dist/scripts/copilot-native-hook.js <event>`); only invocation prefix differs. |
| R2 | Plugin manifest fields drift over time | MEDIUM | HIGH | Pin `@github/copilot@<x.y.z>` in CI; track Copilot changelog; `npm run verify:plugin-bundle` as release-gate. |
| R3 | Custom agent frontmatter doesn't carry all OMX prompt info | MEDIUM | MEDIUM | Use `system` for prompt body; `x-omghc:` namespace for richer metadata; fallback to `~/.omghc/agents-meta/<name>.json`. |
| R10 (was MEDIUM, now **HIGH/HIGH**) | `copilot --prompt` requires TTY (matching Codex precedent at `runtime.ts:1347-1361`) | HIGH | HIGH | M3 day-0 spike validates. **Fallback path is OMX's interactive tmux pattern; well-trodden, costs ~3 extra days of M3 vs subprocess-worker.** Do NOT commit M3's 2 weeks before this is confirmed. |
| R5 | Windows psmux compatibility issues (OMX pain point) | MEDIUM | HIGH | Treat Windows as secondary; recommend WSL2; `winget install psmux` smoke-test in CI. |
| R6 | settings.json merge conflicts with user existing config | LOW | HIGH | OMX `--merge-agents` pattern: marker comments + idempotent insert. Backup before write; emit diff. |
| R7 | MCP servers may need OIDC token | LOW | LOW | Copilot mcp-config supports `oidc`; OMGHC bundled servers run locally via stdio, no OIDC needed. |
| R8 | Skill/prompt content has OMX-specific language needing rename | LOW | HIGH | `npm run rename:port` Markdown-AST rewrite; snapshot diff review. |
| R9 | TS-only sparkshell underperforms Rust on large repos | LOW | MEDIUM | Benchmark in M3; if blocking, move sparkshell to Rust early in M5. |
| R-auth | Auth env vars not propagated to team workers (§A) | HIGH | MEDIUM | Worker bootstrap script asserts auth-env presence; doctor verifies; `docs/auth.md` documents cascade. |
| R-mcp-egg | Plugin's `.mcp.json` references `omghc` binary not yet globally installed | MEDIUM | MEDIUM | Doctor enforces global install; setup printout instructs `npm install -g oh-my-ghcopilot` before plugin install. |
| R11 | Trademark / brand: GitHub may object to "ghcopilot" naming | LOW | LOW | If GitHub objects, rename is mechanical: §3 demonstrates a clean rename surface, and `npm run rename:port` (R8) makes the rewrite a one-shot operation. README disclaimer ("Independent project, not affiliated with GitHub") signals intent. (License is unrelated; OMX uses the same posture toward OpenAI without issue.) |
| R12 | Synchronizing future OMX changes back into OMGHC drift | MEDIUM | HIGH | `scripts/sync-from-omx.ts` proposes patches with rename rules; periodic upstream rebase; documented in CONTRIBUTING.md. |

---

## 10. Verification Steps

| Phase | Verification |
|-------|--------------|
| M0 | `npm install && npm run build && node dist/cli/omghc.js version` ; CI green on Linux + macOS + Windows |
| M1 | Clean machine: `npm install -g . && omghc setup && omghc doctor` exits 0; `~/.copilot/settings.json` and `~/.copilot/agents/*.agent.md` present and valid; `copilot --version` returns; `copilot login` status verified |
| M2 | `omghc mcp-serve omghc_state` answers JSON-RPC `tools/list`; `omghc state read --mode team` works; preToolUse hook smoke test denies a blocked tool; `omghc setup --finalize-mcp` registers servers in `mcp-config.json` |
| M3 | `omghc team 3:executor "noop"` spins 3 workers, distributes tasks, completes, shuts down; `omghc team api get-summary --json` returns valid envelope; ported team tests pass; coverage ≥78% lines on team/state |
| M4 | `copilot plugin install ./plugins/oh-my-ghcopilot` succeeds; CI matrix green on three platforms; `npm publish --dry-run` shows expected file list |

---

## 11. Open Decision Points

| # | Decision | Recommendation | Rationale |
|---|----------|----------------|-----------|
| D1 | Naming | `oh-my-ghcopilot` npm + `omghc` binary + `.omghc/` state | All verified available 2026-05-05. Original (`oh-my-copilot`/`omc`) blocked by existing packages. |
| D2 | M1 skill scope | 21 of 39 (~54%) | Covers core workflow; defer ultra*, swarm, autoresearch, visual-* to M5 |
| D3 | Stack | TS-only first; Rust deferred to v1.x | LLM is the bottleneck, not local IO |
| D4 | Plugin model | Plugin-mode default, `--legacy` supported | Matches OMX 0.15.0 direction |
| D5 | Repo location | `oh-my-copilot/` next to `oh-my-codex/` | Already where user is working; npm pkg name differs from dir name |
| D6 | Source policy | Verbatim port + rename pass | Faster, easier sync, inherits bug fixes |
| D7 | License | MIT, attribute OMX in CONTRIBUTING.md and README | Matches OMX |
| D8 | Cross-CLI dual mode | YES, but **costs 3–5 days of M3** (NOT free as v1 claimed) | Real cost: enum extension + flag-translation branch + auth branch + worker model defaults |
| D9 | Plugin `.mcp.json` `"command"` | `"omghc"` (relies on global install) | Simpler than self-contained `node ${PLUGIN_ROOT}/...` paths; doctor enforces global install |
| D10 | Auth defaults | `GH_TOKEN` preferred; `GITHUB_TOKEN` fallback; require `copilot login` if neither | Matches Copilot CLI's documented precedence |

---

## 12. Total Effort Estimate (revised + observed pace as of v2.2)

**Observed pace through M2a (2026-05-06):** M0 + M1a + M1b + M2a delivered in **~6 hours of agent wall-clock time** across 4 team sessions. Original estimate was 7 weeks of "autonomous loop" time — actual pace is 10–20× faster. Two interpretations:

- **Estimate was conservative:** the autonomous-loop multiplier from the v2 plan assumed slower iteration; the team-skill-based parallel execution outpaced that.
- **Hard parts are still ahead:** M3 team runtime (4,752-LOC `runtime.ts` to port) and M2b hook adapter (Stop-event redesign) may slow significantly. The R-hooks-not-wired finding shifts M2b's character from "build and verify" to "build for forward-compat with no live testing path."

**Recalibrated remaining estimate:** M2b ~2–4h, M3 ~1–2 days (mostly the team runtime port), M4 ~3–6h. Total remaining: **~2–4 days** of agent time to v0.1.0 (vs. original ~3.5 weeks remaining). Caveat: any blocked spike (M3 day-0 `copilot --prompt` headless verification) could push this materially.

### Original v2 estimate (preserved for reference)

| Phase | Estimate | Cumulative |
|-------|----------|------------|
| M0 Scaffold | 1–2 days | 2 days |
| M1 Skills + Setup + Doctor (+ §A auth integration) | 1.5 weeks (was 1w; +0.5w for auth + agent-md generator) | ~2 weeks |
| M2 Hooks + State + MCP (+ HTTP fallback contingent) | 1–1.5 weeks | ~3.5 weeks |
| M3 Team runtime (+ R10 spike + cross-CLI extension + auth branch) | 2.5 weeks (was 2w; +3 days for spike contingencies + D8 cost) | ~6 weeks |
| M4 Plugin packaging + polish | 1 week | **~7 weeks** for MVP via autonomous loop |
| M5 Rust + advanced (deferred) | 4–6 weeks | ~11–13 weeks |

**Note on autonomous-loop multiplier:** OMX itself took ~7 months (v0.8 → v0.15.1) of multi-maintainer human work to mature. The 7-week MVP estimate assumes (a) we are PORTING not INVENTING (most logic is settled), (b) autonomous loops handle ~70% of mechanical port work, (c) human time is concentrated on the three named spikes (M2 hook schema, M3 day-0 `copilot --prompt`, §A auth) and integration testing. If any spike fails, add 1–2 weeks per failure. **Honest range: 7–12 weeks for MVP.**

---

## 13. Acceptance criteria (overall)

- [x] 90%+ of acceptance items in M0–M4 are concrete and testable
- [x] 80%+ of plan claims cite a file path, command, or LOC measurement (corrected in v2)
- [x] All risks have a named mitigation
- [x] Phased roadmap can be executed by an autonomous loop once approved
- [x] No vague terms without metrics

---

## 14. ADR (Architecture Decision Record)

### Decision
Build OMGHC as a TypeScript-only verbatim port of OMX with a rename pass and three Copilot-specific adapters (`copilot-hook-adapter`, `worker-cli-adapter`, `auth-adapter`) under a new `src/compat/` directory. Defer all 5 Rust crates and 18 advanced skills to v1.x.

### Drivers (top 3)
1. Maintainability vs. upstream drift — enables OMX→OMGHC sync tooling and inherits 297 tests.
2. Time-to-MVP — 7-week budget with autonomous loop; rewrite would be 15–30 weeks.
3. Risk surface — three known unknowns (hooks schema, `copilot --prompt`, auth) get explicit spikes; everything else has documented Copilot equivalents.

### Alternatives considered
- **Option B (rewrite):** rejected — discards OMX's mature architecture, 297 tests, and edge-case fixes (Korean IME, BusyBox, Windows psmux, MCP duplicate cleanup) that took OMX ~7 months to solve.
- **Option C (Rust from M0):** rejected for v0.x — doubles distribution complexity (cross-platform binaries) without addressing the LLM-bound bottleneck Copilot users actually face.

### Why chosen
- Fastest path to functional MVP that delivers OMX's full UX to Copilot users.
- Preserves cross-CLI optionality (D8) so OMGHC users aren't locked into Copilot.
- Three explicit spikes (M2 day-1, M3 day-0, M0 auth) front-load the unknowns; if any fails, the plan has named fallbacks.
- Naming `oh-my-ghcopilot`/`omghc`/`.omghc/` resolves the npm collision while preserving the OMX→OMGHC parallel.

### Consequences
- **Positive:** ~7-week MVP; 2-way sync with OMX upstream feasible; users get familiar `$ralph`/`$team` workflow on day one; Rust path stays open via `src/compat/` shims.
- **Negative:** inherits OMX architectural debt (notably `runtime.ts` at 4,752 LOC) — must be flagged for v1.x refactor. TS sparkshell ~5–10× slower than Rust on hot paths. Naming is awkward (`omghc` is hard to say) but unique on npm.

### Follow-ups
1. **Pre-M0 (this week):** user confirms naming D1 finalist (`oh-my-ghcopilot` vs `copilot-harness` vs `pilothouse-cli`).
2. **M0 day-1:** spike `copilot login --status` exact command; lock Copilot CLI version.
3. **M2 day-1:** hooks.json schema spike (R1 + R-new).
4. **M3 day-0:** `copilot --prompt` headless spike (R10).
5. **v1.x kickoff:** refactor `runtime.ts`; lift sparkshell/explore to Rust; add ultra*, swarm, autoresearch skills; i18n.

---

## Changelog

- 2026-05-06 (v2.3) — M2b shipped (commit `4f8aa47`). 5 hook ports for forward-compat, native-hook adapter (6-event dispatcher), plugin manifests (no `hooks` field — confirmed correct), setup writes `<gitRoot>/.github/hooks/oh-my-ghcopilot.json`, `omghc setup --finalize-mcp` functional, `omghc doctor --probe-hooks` (PASS/FAIL/INCONCLUSIVE — gates on auth availability). 26 new tests + 94 cumulative pass. M2 now fully shipped. M3 (team runtime) is next.
- 2026-05-06 (v2.2) — post-M2a spike corrections. **Five plan changes**: (1) §9 R-new HTTP-POST fallback DELETED — impossible per schema (only `type: "command"` exists); (2) §9 added 4 new confirmed risks: R-hooks-not-wired (CRITICAL — file-based hooks don't fire in v1.0.40 production binary), R-no-stop-event (HIGH — no Stop event in Copilot schema; Ralph continuation needs redesign), R-plugin-install-no-local (MEDIUM — `copilot plugin install` rejects local paths), R-cross-platform-hooks (LOW — bash+powershell required per hook entry); (3) §M2 hooks register at `<projectRoot>/.github/hooks/oh-my-ghcopilot.json`, NOT plugin manifest; (4) §M2 added `omghc doctor --probe-hooks` as canonical wiring-detection mechanism; (5) `docs/copilot-native-hooks.md` is now the authoritative hook reference. M2a shipped: 4 MCP servers + bootstrap + CLI parity + 24 new tests, 68/68 total tests pass.
- 2026-05-05 15:35 (v2.1) — post-M1a spike correction. §A.2 doctor section updated to reflect actual Copilot CLI v1.0.40 auth model: `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` env precedence; `config.json` `loggedInUsers` array (NOT `login-cache`); `copilot login --status` does NOT exist. `docs/auth.md` is the authoritative reference. M1 (a+b) shipped: 21 skills, 33 prompts, 4 templates, 6 CLI subcommands, 6 src modules, 6 test files, 44/44 tests pass.
- 2026-05-05 13:30 (v2) — post-Architect revision. Renamed `oh-my-copilot`/`omc`/`.omc/` → `oh-my-ghcopilot`/`omghc`/`.omghc/` (CRITICAL npm name collision). Added §A Auth section. Elevated R10 to HIGH/HIGH with M3 day-0 spike. Fixed factual claims (setup.ts: 3,094 LOC; agents-overlay.ts: 686 lines; runtime.ts: 4,752 lines). Fixed M1/M2 MCP ordering (deferred MCP config to M2). Added R-new HTTP-hooks Plan B. Updated D8 cross-CLI cost (3–5 days, not free). Added explicit `src/compat/` net-new directory. Revised effort estimate to 7 weeks. Added §14 ADR.
- 2026-05-05 13:06 (v1) — initial draft.
