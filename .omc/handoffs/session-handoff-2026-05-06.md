# Session handoff — 2026-05-06

**For:** Future Claude sessions resuming this project
**Status:** v0.1.0 RELEASE-READY; CI pending verification after line-ending fix; npm publish not yet done

---

## TL;DR

`oh-my-ghcopilot` is a TypeScript port of `oh-my-codex` (OMX) targeting GitHub Copilot CLI. Six milestones (M0–M4) shipped over a single multi-hour autonomous session. **166/166 tests pass.** v0.1.0 is ready; CI just got a line-ending fix that needs verification.

## Cumulative state

| | |
|---|---|
| Working dir | `C:\Users\andyzeng\OneDrive - Microsoft\Documents\GitHub\oh-my-copilot` |
| Git remote | `https://github.com/andyzengmath/oh-my-copilot` (main pushed) |
| Commits | 12 |
| Tests | 166/166 passing locally |
| Plan | `.omc/plans/2026-05-05-port-omx-to-copilot.md` (v2.6, RELEASE-READY status) |
| npm package | `oh-my-ghcopilot@0.1.0` — NOT yet published (registry 404) |
| Open cron | Job `6d5c1090` (`/loop` 10-min monitoring) |

## Commit history

```
f379edd Add .gitattributes to force LF on text files (fix Windows CI sync:plugin drift)  ← latest
857e53b v0.1.x: coverage supplement (15 new tests for tasks/workers/mailbox/dispatch); 166/166 cumulative tests pass
e754073 v0.1.0: bump version + plan v2.6 (M4 shipped, release-ready)
b68aff5 M4: plugin packaging + notify + README + DEMO + 3 docs + RELEASE_BODY + CI tighten + final verification
dde4d9a M3b: orchestrator + runtime + omghc team CLI + hud + omghc continue (Stop-event redesign) + 40 new tests
b6770d3 M3a: team runtime foundation — copilot --prompt spike + state ops + worktree + tmux-session + worker-bootstrap + api
af06fa2 plan: v2.3 (M2 fully shipped) + M2b verify-end handoff + M3a kickoff handoff
4f8aa47 M2b: hooks + native-hook adapter + plugin manifests + setup hook-write + finalize-mcp + probe-hooks
a20e6af plan: v2.2 — M2a spike corrections + execution status sync
065626a M2a: 4 MCP servers + bootstrap + CLI parity + hooks.json spike
41c9ae6 plan: §A.2 corrected to match M1a auth spike findings
6dbcb2e M1 (a+b): skills/prompts port + setup/doctor/uninstall/list/update + auth spike + tests
f397693 M0 scaffold for oh-my-ghcopilot
```

## Open ship blockers

1. **CI verification** — last push (`f379edd`) added `.gitattributes` to fix Windows CI failure (CRLF/LF drift in `sync:plugin:check`). The earlier run showed Linux + macOS green, Windows failed. Verify the new run goes green:
   ```
   gh run list --limit 3
   gh run view <id>
   ```

2. **npm publish** — package is built and `npm publish --dry-run` produces a valid 403 KB tarball. To ship:
   ```
   npm login                      # one-time browser/2FA; user did not complete this earlier
   npm publish --access public    # uploads to public registry
   ```

3. **Tag v0.1.0** — after CI green:
   ```
   git tag v0.1.0
   git push origin v0.1.0
   gh release create v0.1.0 -F RELEASE_BODY.md
   ```

## Three load-bearing architectural findings

### 1. Hooks DO NOT FIRE in Copilot CLI v1.0.40 production binary

M2a spike (worker-1) reverse-engineered the hook contract:
- Schema validates fully (zod-checked)
- Hook loader runs (the file at `<gitRoot>/.github/hooks/oh-my-ghcopilot.json` is parsed)
- Processor registers (`PreToolUseHooksProcessor` shows up in stringified processor list)
- **But `Session.hooks` is NOT wired to `preToolsExecution`** — the bridge is incomplete.

OMGHC builds for **forward-compat**: when a future Copilot release wires this up, OMGHC's hooks activate automatically with no code change. See `docs/copilot-native-hooks.md`.

Probe the wiring with `omghc doctor --probe-hooks` — drops a marker hook, fires `copilot --prompt`, asserts marker fired. Today: FAIL. When wiring lands: PASS.

### 2. No `Stop` event → `omghc continue` redesign

Copilot's hook schema has 6 events: `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `errorOccurred`. OMX uses a `Stop` event for Ralph continuation.

**OMGHC's solution:** on `sessionEnd`, the native-hook adapter writes a hint file at `<wd>/.omghc/state/<mode>-resume-hint.json` for each active non-terminal mode. `omghc continue` reads the hint and re-launches the recorded `resume_command`.

See `src/cli/continue.ts` and the `handleSessionEnd` block in `src/scripts/copilot-native-hook.ts`.

### 3. Subprocess-mode workers (no TTY)

M3a spike (worker-1): `copilot -p "<task>" --allow-all-tools --no-color --no-ask-user --no-auto-update` works headless — no TTY required. Auth via cached `~/.copilot/config.json` `loggedInUsers` array OR env-var precedence (`COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`).

**This is the inverse of OMX's Codex constraint** (`runtime.ts:1347-1361` `PROMPT_MODE_CODEX_UNSUPPORTED_REASON`). OMGHC's tmux-session.ts has a `'copilot'` worker variant that uses subprocess mode — `'codex'` continues to use interactive panes.

See `docs/copilot-prompt-mode.md`.

## Known v0.1.x defects (captured but not blocking v0.1.0)

1. **Coverage on `src/team/state/`** — 51.78% lines (target was ≥78%). M4 handoff notes adding ~10-15 more tests per state file would close this. The coverage supplement (commit `857e53b`) added 15 tests; more are mechanical follow-ups.
2. **`README.md` was lead-written** when worker-1 stalled — accurate but not battle-tested with a real user walkthrough yet.
3. **CI test-glob may differ** between local and CI count (worker-5 reported 138 with one glob shape vs my 151 with another). Prefer the explicit-globs form in CI: `dist/cli/__tests__/*.test.js dist/agents/__tests__/*.test.js dist/catalog/__tests__/*.test.js dist/mcp/__tests__/*.test.js dist/hooks/__tests__/*.test.js dist/scripts/__tests__/*.test.js dist/team/__tests__/*.test.js dist/team/state/__tests__/*.test.js`.

## What's deferred (M5 / v1.x)

- Rust crates port (`crates/omghc-{explore,mux,runtime-core,runtime,sparkshell}`)
- 18 advanced skills (`ultrawork`, `ultraqa`, `swarm`, `autoresearch`, `frontend-ui-ux`, `visual-ralph`, `visual-verdict`, `deepsearch`, `ecomode`, `web-clone`, `configure-notifications`, `ask-claude`, `ask-gemini`, `security-review`, `skill`, `trace`, `review`, `ralph-init`)
- i18n (15 README languages)
- OpenClaw / Hermes adapt
- Sparkshell native binary
- OMX→OMGHC sync tooling (rename-aware patch generator)

## Where to look for context

| Question | File |
|----------|------|
| What's the project plan? | `.omc/plans/2026-05-05-port-omx-to-copilot.md` (v2.6) |
| What was each milestone's outcome? | `.omc/handoffs/team-verify-to-end-{m0,m1a,m1b,m2a,m2b,m3a,m3b,m4}.md` |
| How does auth work? | `docs/auth.md` |
| Hook schema? | `docs/copilot-native-hooks.md` |
| `copilot --prompt` flags? | `docs/copilot-prompt-mode.md` |
| User-facing intro? | `README.md` |
| Demos? | `DEMO.md` |
| v0.1.0 release notes? | `RELEASE_BODY.md` |

## Reference: OMX source

`C:\Users\andyzeng\OneDrive - Microsoft\Documents\GitHub\oh-my-codex` @ v0.15.1 — read-only canonical reference. Use for:
- Comparing OMGHC's port to original behavior
- Picking up upstream improvements via rename pass
- Sourcing additional skills for v1.x

## Conversation context lost across the boundary

This session ran for many hours and accumulated context that won't carry across. Future sessions should:
- Start by reading this handoff doc + the plan
- Check `git log --oneline -20` for the recent commit shape
- Run `npm run build && node --test dist/cli/__tests__/*.test.js dist/agents/__tests__/*.test.js dist/catalog/__tests__/*.test.js dist/mcp/__tests__/*.test.js dist/hooks/__tests__/*.test.js dist/scripts/__tests__/*.test.js dist/team/__tests__/*.test.js dist/team/state/__tests__/*.test.js` to confirm 166/166 still passes
- Check `gh run list --limit 5` for CI status
- Check `npm view oh-my-ghcopilot version` for publish status
