# OMGHC Authentication

OMGHC requires GitHub Copilot CLI auth. This document captures the exact commands and env vars discovered during the M1a auth spike.

## Spike date

2026-05-05 on Windows 11, Copilot CLI v1.0.40 (`@github/copilot v0.0.395`).

## Auth model

GitHub Copilot CLI is **token-based**, with two persistence paths:

1. **Persistent login cache** — `copilot login` runs an OAuth device flow. After completion, the token is stored in the OS credential store when one is available; otherwise it falls back to a plain text config file under `~/.copilot/`. Per-host login state is recorded as a structured user list inside `~/.copilot/config.json` (e.g., `loggedInUsers: [{ host, login }]`).
2. **Environment-variable token** — for headless / CI use. The CLI checks env vars in this order of precedence and uses the first one set: `COPILOT_GITHUB_TOKEN`, then `GH_TOKEN`, then `GITHUB_TOKEN`. An env-var token **takes precedence over** any previously stored credential.

Supported token types include fine-grained personal access tokens (v2 PATs) with the "Copilot Requests" permission, OAuth tokens from the GitHub Copilot CLI app, and OAuth tokens from the GitHub CLI (`gh`) app. Classic personal access tokens (`ghp_`) are **not** supported.

## Status check command

| Command | Behavior |
|---------|----------|
| `copilot login --status` | [did not exist on v1.0.40] — `copilot login --help` lists only `--host` and `-h/--help`. No `--status` flag. |
| `copilot user` | [did not exist on v1.0.40] — not in the command list (`completion`, `help`, `init`, `login`, `mcp`, `plugin`, `update`, `version`). |
| `copilot whoami` | [did not exist on v1.0.40] — not in the command list. |
| `copilot login` (no args) | Starts the OAuth device flow. **Not safe to call from `omghc doctor`** — it would prompt the user. Do not invoke for status. |
| Read `~/.copilot/config.json` `lastLoggedInUser` / `loggedInUsers` | **Works** — config file is JSON with `{ lastLoggedInUser: { host, login }, loggedInUsers: [...] }` populated when a user is logged in. Empty / missing fields imply no cached login. |
| Check `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` env | **Works** — if any of these are set, the CLI will use them regardless of cache state. |

The recommended invocation for `omghc doctor` is therefore a **two-pronged check** (no native single-shot status command exists in v1.0.40):

1. If `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN` is set in the env → report "auth: env-token" and exit OK.
2. Else if `${COPILOT_HOME:-$HOME/.copilot}/config.json` exists and parses to JSON with a non-empty `loggedInUsers` array → report "auth: cached login as `<login>@<host>`" and exit OK.
3. Else → report HIGH severity, instruct the user to run `copilot login`.

## Env var precedence

Confirmed from `copilot help environment` and `copilot login --help`:

```
COPILOT_GITHUB_TOKEN  >  GH_TOKEN  >  GITHUB_TOKEN
```

An env-var token takes precedence over a stored credential. `COPILOT_GH_HOST` (Copilot-only) overrides `GH_HOST` (shared with `gh`) for host selection.

## Artifacts on disk

Observed files under `~/.copilot/` on this Windows machine when logged in:

- `config.json` — non-secret JSON containing `lastLoggedInUser`, `loggedInUsers`, `firstLaunchAt`. Safe to read for status detection.
- `settings.json` — user settings.
- `command-history-state.json` — REPL history state.
- `embedding-cache.db` (+ `.db-shm`, `.db-wal`) — SQLite embedding cache.
- `session-store.db` — SQLite session store.
- `ide/`, `installed-plugins/`, `logs/`, `pkg/`, `plugin-data/`, `session-state/`, `skills/` — directories for various subsystems.

When `COPILOT_HOME` is set, the directory above is overridden. There is **no** dedicated `auth.json` or `token` file — credentials live in the OS credential store (when available), not the filesystem. Do not parse for a token file.

## Caveats

- This spike was run on Windows 11. Behavior on Linux/macOS may differ (e.g., the OS credential store is platform-specific; the fallback path under `~/.copilot/` is the same shape).
- Copilot CLI is evolving rapidly; pin against version 1.0.40 in our CI.
- Re-run this spike whenever Copilot CLI minor-version-bumps. A future release may add a real `copilot login --status` flag — prefer it once available.
- **Do not** print or log the contents of any token file or env-var token from `omghc doctor`. Surface presence/absence and the masked login name only.
- BYOK mode bypasses GitHub auth entirely: when `COPILOT_PROVIDER_BASE_URL` is set, no GitHub token is required. `omghc doctor` should detect this and skip the auth check (or report it separately).

## Implications for OMGHC

- `omghc doctor` performs the env-var-then-config-json check described above; it does **not** invoke `copilot login` or any non-existent `--status` flag.
- `omghc team` worker bootstrap inherits `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` from the leader env so workers don't re-prompt for auth.
- If neither env var is set AND no `loggedInUsers` cache, doctor reports HIGH severity with the remediation command `copilot login`.
- BYOK detection: if `COPILOT_PROVIDER_BASE_URL` is set, doctor reports auth as "BYOK (provider override)" and skips the GitHub-auth requirement.
- Honor `COPILOT_HOME` when locating `config.json`.
