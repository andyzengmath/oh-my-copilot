---
name: omghc-setup
description: Setup and configure oh-my-ghcopilot using current CLI behavior
---

# OMGHC Setup

Use this skill when users want to install or refresh oh-my-ghcopilot for the **current project plus user-level OMGHC directories**.

## Command

```bash
omghc setup [--force] [--merge-agents] [--dry-run] [--verbose] [--scope <user|project>] [--plugin|--legacy|--install-mode <legacy|plugin>]
```

If you only want lightweight `AGENTS.md` scaffolding for an existing repo or subtree, use `omghc agents-init [path]` instead of full setup.

Supported setup flags (current implementation):
- `--force`: overwrite/reinstall managed artifacts where applicable
- `--merge-agents`: when `AGENTS.md` already exists, preserve user-authored content and insert/refresh OMGHC-managed generated sections between explicit `<!-- OMGHC:AGENTS:START -->` / `<!-- OMGHC:AGENTS:END -->` markers
- `--dry-run`: print actions without mutating files
- `--verbose`: print per-file/per-step details
- `--scope`: choose install scope (`user`, `project`)
- `--plugin`: use Copilot plugin delivery for bundled skills while archiving/removing legacy OMGHC-managed prompts/native agents and keeping setup-owned runtime hooks
- `--legacy`: use legacy setup delivery, overriding any persisted plugin install mode
- `--install-mode`: explicitly choose setup delivery mode (`legacy` or `plugin`); canonical form for scripted setup

## What this setup actually does

`omghc setup` performs these steps:

1. Resolve setup scope:
   - `--scope` explicit value
   - else persisted `./.omghc/setup-scope.json` (with automatic migration of legacy values)
   - if a TTY user has persisted setup preferences, `omghc setup` first summarizes the recorded choices and asks whether to **keep**, **review/change**, or **reset** them
   - else interactive prompt on TTY (default `user`)
   - else default `user` (safe for CI/tests)
2. If scope is `user`, resolve user skill delivery mode:
   - explicit `--plugin`, `--legacy`, or `--install-mode legacy|plugin`, if present
   - persisted install mode in `./.omghc/setup-scope.json`, if present and the TTY review decision is `keep`
   - else discovered installed plugin cache under `${COPILOT_HOME:-~/.copilot}/plugins/cache/**/.copilot-plugin/plugin.json` with `name: oh-my-ghcopilot` makes `plugin` the default
   - else interactive prompt on TTY (`legacy` by default, or `plugin` when a plugin cache is discovered)
   - else default `legacy` unless a plugin cache is discovered
3. Create directories and persist effective scope/install mode
4. In legacy mode, install prompts/native agents/skills and merge full settings.json. In plugin mode, archive/remove legacy OMGHC-managed prompts/native agents/skills but keep native Copilot hooks installed.
5. Verify Team CLI API interop markers exist in built `dist/cli/team.js`
6. Generate AGENTS.md defaults only when selected/allowed (or legacy behavior outside plugin mode)
7. Configure notify hook references outside plugin mode and write `./.omghc/hud-config.json`

## Important behavior notes

- `omghc setup` prompts for scope when no scope is provided and stdin/stdout are TTY. If `./.omghc/setup-scope.json` already exists, setup now summarizes the saved choices first and asks whether to keep them, review/change them, or reset and behave like a fresh setup run.
- Non-interactive setup never blocks for this review prompt: it keeps deterministic CLI/persisted/default behavior for CI and scripted installs.
- In `user` scope, `omghc setup` also prompts for skill delivery mode when no prior install mode is kept; installed plugin cache discovery makes plugin mode the default prompt/non-interactive choice.
- Local project orchestration file is `./AGENTS.md` (project root).
- If `AGENTS.md` exists and neither `--force` nor `--merge-agents` is used, interactive TTY runs ask whether to overwrite. Non-interactive runs preserve the file.
- Use `--merge-agents` to keep existing project guidance while allowing setup to refresh OMGHC-managed AGENTS sections and the generated model capability table idempotently.
- Scope targets:
  - `user`: user directories (`~/.copilot`, `~/.copilot/skills`, `~/.omghc/agents`)
  - `project`: local directories (`./.copilot`, `./.copilot/skills`, `./.omghc/agents`)
- User-scope skill delivery targets:
  - `legacy`: keep installing/updating OMGHC skills in the resolved user skill root
  - `plugin`: rely on Copilot plugin discovery for bundled skills and archive/remove legacy OMGHC-managed prompts/skills/native agents; setup still installs native Copilot hooks and `copilot_hooks = true` because plugins do not carry hooks.
- Migration hint: in `user` scope, if historical `~/.agents/skills` still exists alongside `${COPILOT_HOME:-~/.copilot}/skills`, current setup prints a cleanup hint. **Why the paths differ**: `${COPILOT_HOME:-~/.copilot}/skills/` is the path current Copilot CLI natively loads as its skill root; `~/.agents/skills/` was the skill root in an older Copilot CLI release before `~/.copilot` became the standard home directory. OMGHC writes only to the canonical `${COPILOT_HOME:-~/.copilot}/skills/` path. When both directories exist simultaneously, Copilot discovers skills from both trees and may show duplicate entries in Enable/Disable Skills. Archive or remove `~/.agents/skills/` to resolve this.
- If persisted scope is `project`, `omghc` launch automatically uses `COPILOT_HOME=./.copilot` unless user explicitly overrides `COPILOT_HOME`.
- Plugin mode prompts separately for optional AGENTS.md defaults and optional `developer_instructions` defaults. If `developer_instructions` already exists, setup asks before overwriting it; non-interactive runs preserve it.
- With `--force` or `--merge-agents`, AGENTS updates may still be skipped if an active OMGHC session is detected (safety guard).
- Legacy persisted scope values (`project-local`) are automatically migrated to `project` with a one-time warning.

## Setup-owned configuration surfaces

Use this map when reconciling setup behavior or debugging a confusing install:

| Surface | Owner | Notes |
| --- | --- | --- |
| `./.omghc/setup-scope.json` | `omghc setup` | Persists setup scope and user-scope skill delivery mode. TTY reruns summarize it and offer keep/review/reset. |
| `~/.copilot/settings.json` / `./.copilot/settings.json` | `omghc setup` generated blocks + user edits | Setup refreshes OMGHC-managed blocks while preserving supported manual content. |
| `~/.copilot/hooks.json` / `./.copilot/hooks.json` | `omghc setup` shared ownership | Setup owns OMGHC native hook wrappers and preserves user-owned hooks. |
| prompts, skills, native agents | `omghc setup` or Copilot plugin delivery | Legacy mode installs local files; plugin mode relies on plugin discovery for bundled skills and archives/removes legacy OMGHC-managed prompt/native-agent copies. |
| `AGENTS.md` | `omghc setup` with overwrite safety | Generated defaults or managed refreshes are guarded by force/session checks. |
| `./.omghc/hud-config.json` | `omghc setup` / `$hud` | Setup creates the focused default; `$hud` can adjust it later. |
| notification hooks | `omghc setup` / `$configure-notifications` | Setup wires defaults outside plugin skill delivery; notification skill owns deeper provider configuration. |

## If `$omghc-setup` is missing or stale

The source repo ships `skills/omghc-setup/SKILL.md` and the catalog marks it active. If Copilot does not show `$omghc-setup`, treat it as an installation/discovery issue rather than a missing source skill:

1. Run `omghc setup --verbose` in the intended scope.
2. Run `omghc doctor` and check the reported setup scope, Copilot home, skill root, and hook/config status.
3. If using project scope, confirm `./.copilot/skills/omghc-setup/SKILL.md` exists.
4. If using user scope, confirm `${COPILOT_HOME:-~/.copilot}/skills/omghc-setup/SKILL.md` exists in legacy mode, or that the oh-my-ghcopilot plugin is installed/discovered in plugin mode.
5. If duplicate/stale skills appear, check for legacy `~/.agents/skills` overlap and follow the cleanup hint printed by setup/doctor.

## Recommended workflow

1. Run setup:

```bash
omghc setup --force --verbose
```

2. Verify installation:

```bash
omghc doctor
```

3. Start Copilot with OMGHC in the target project directory.

## Expected verification indicators

From `omghc doctor`, expect:
- Prompts installed (scope-dependent: user or project)
- Skills installed (scope-dependent: user or project)
- AGENTS.md found in project root
- `.omghc/state` exists
- OMGHC MCP servers configured in scope target `settings.json` (`~/.copilot/settings.json` or `./.copilot/settings.json`)

## Troubleshooting

- If using local source changes, run build first:

```bash
npm run build
```

- If your global `omghc` points to another install, run local entrypoint:

```bash
node bin/omghc.js setup --force --verbose
node bin/omghc.js doctor
```

- If AGENTS.md was not overwritten during `--force`, stop active OMGHC session and rerun setup.
- If AGENTS.md was not merged during `--merge-agents`, stop active OMGHC session and rerun setup.

<!-- Ported from oh-my-codex (OMX) v0.15.1 by oh-my-ghcopilot. Original by Yeachan Heo et al., MIT. -->
