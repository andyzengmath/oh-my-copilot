---
name: doctor
description: Diagnose and fix oh-my-ghcopilot installation issues
---

# Doctor Skill

Note: All `~/.copilot/...` paths in this guide respect `COPILOT_HOME` when that environment variable is set.

## Canonical skill root

OMGHC installs skills to `${COPILOT_HOME:-~/.copilot}/skills/` — this is the path current Copilot CLI natively loads as its skill root.

`~/.agents/skills/` is a **historical legacy path** from an older Copilot CLI release, before Copilot settled on `~/.copilot` as its home directory. Current Copilot CLI and OMGHC no longer write there.

**In a mixed OMGHC + plain Copilot environment:**
- **Use**: `${COPILOT_HOME:-~/.copilot}/skills/` (user scope) or `.copilot/skills/` (project scope)
- **Clean up if present**: `~/.agents/skills/` — if this still exists alongside the canonical root, Copilot's Enable/Disable Skills UI will show duplicate entries for any skill present in both trees
- **Interop rule**: OMGHC writes only to the canonical path; archive or remove `~/.agents/skills/` once you have confirmed `${COPILOT_HOME:-~/.copilot}/skills/` is your active root

## Task: Run Installation Diagnostics

You are the OMGHC Doctor - diagnose and fix installation issues.

### Step 1: Check Plugin Version

Official Copilot plugin caches are marketplace- and version-scoped, for example `${COPILOT_HOME:-~/.copilot}/plugins/cache/$MARKETPLACE_NAME/oh-my-ghcopilot/$VERSION/`. Local installs may use `local` as the version identifier.

```bash
# Get installed plugin cache versions across marketplaces.
# Cache shape: $PLUGIN_CACHE_ROOT/$MARKETPLACE_NAME/oh-my-ghcopilot/$PLUGIN_VERSION/
PLUGIN_CACHE_ROOT="${COPILOT_HOME:-$HOME/.copilot}/plugins/cache"
CACHE_ENTRIES=$(find "$PLUGIN_CACHE_ROOT" -path "*/oh-my-ghcopilot/*" -mindepth 3 -maxdepth 3 -type d 2>/dev/null)

if [[ -z "$CACHE_ENTRIES" ]]; then
  echo "Installed plugin cache: none"
else
  while IFS= read -r VERSION_DIR; do
    MARKETPLACE_NAME=$(basename "$(dirname "$(dirname "$VERSION_DIR")")")
    PLUGIN_VERSION=$(basename "$VERSION_DIR")
    printf 'Installed plugin cache: marketplace=%s version=%s path=%s\n' "$MARKETPLACE_NAME" "$PLUGIN_VERSION" "$VERSION_DIR"
  done <<< "$CACHE_ENTRIES"
fi

# Get latest from npm
LATEST=$(npm view oh-my-ghcopilot version 2>/dev/null)
echo "Latest npm: $LATEST"
```

**Diagnosis**:
- If no cache entry exists: INFO - plugin marketplace artifact not cached; this may be normal when OMGHC was installed only through npm/setup
- Compare each printed `PLUGIN_VERSION` with `LATEST`; if it differs and is not `local`: WARN - outdated plugin cache
- If one marketplace has multiple version directories: WARN - stale cache for that marketplace/plugin pair
- Remember: plugin install/discovery is not a replacement for `npm install -g oh-my-ghcopilot` plus `omghc setup`; the packaged plugin now carries plugin-scoped companion metadata for MCP servers and apps, while native/runtime hooks and the rest of OMGHC runtime wiring stay setup-owned

### Step 2: Check Hook Configuration (settings.json + legacy settings.json)

Check `~/.copilot/settings.json` first (current Copilot config), then check legacy `~/.copilot/settings.json` only if it exists.

Look for hook entries pointing to removed scripts like:
- `bash $HOME/.copilot/hooks/keyword-detector.sh`
- `bash $HOME/.copilot/hooks/persistent-mode.sh`
- `bash $HOME/.copilot/hooks/session-start.sh`

**Diagnosis**:
- If found: CRITICAL - legacy hooks causing duplicates

### Step 3: Check for Legacy Bash Hook Scripts

```bash
ls -la ~/.copilot/hooks/*.sh 2>/dev/null
```

**Diagnosis**:
- If `keyword-detector.sh`, `persistent-mode.sh`, `session-start.sh`, or `stop-continuation.sh` exist: WARN - legacy scripts (can cause confusion)

### Step 4: Check AGENTS.md

```bash
# Check if AGENTS.md exists
ls -la ~/.copilot/AGENTS.md 2>/dev/null

# Check for OMGHC marker
grep -q "oh-my-ghcopilot Multi-Agent System" ~/.copilot/AGENTS.md 2>/dev/null && echo "Has OMGHC config" || echo "Missing OMGHC config"
```

**Diagnosis**:
- If missing: CRITICAL - AGENTS.md not configured
- If missing OMGHC marker: WARN - outdated AGENTS.md

### Step 5: Check Authentication

```bash
# Verify Copilot CLI is authenticated
copilot login --status

# Check for GH_TOKEN / GITHUB_TOKEN environment variables (for headless / CI usage)
if [[ -n "$GH_TOKEN" ]]; then
  echo "GH_TOKEN is set"
elif [[ -n "$GITHUB_TOKEN" ]]; then
  echo "GITHUB_TOKEN is set"
else
  echo "No GH_TOKEN/GITHUB_TOKEN set in environment"
fi
```

**Diagnosis**:
- If `copilot login --status` reports not signed in and no `GH_TOKEN`/`GITHUB_TOKEN` is set: CRITICAL - Copilot CLI not authenticated
- If both interactive login and a token env var are present: OK (token wins for non-interactive flows)
- If `copilot` binary is not on `PATH`: CRITICAL - Copilot CLI not installed

### Step 6: Check for Stale Plugin Cache

```bash
# List marketplace/version cache entries for this plugin
PLUGIN_CACHE_ROOT="${COPILOT_HOME:-$HOME/.copilot}/plugins/cache"
find "$PLUGIN_CACHE_ROOT" -path "*/oh-my-ghcopilot/*" -mindepth 3 -maxdepth 3 -type d 2>/dev/null \
  | while IFS= read -r VERSION_DIR; do
      MARKETPLACE_NAME=$(basename "$(dirname "$(dirname "$VERSION_DIR")")")
      PLUGIN_VERSION=$(basename "$VERSION_DIR")
      printf '%s\t%s\n' "$MARKETPLACE_NAME" "$PLUGIN_VERSION"
    done
```

**Diagnosis**:
- If a single marketplace lists multiple versions: WARN - multiple cached versions for that marketplace/plugin pair (cleanup recommended)

### Step 7: Check for Legacy Curl-Installed Content

Check for legacy agents, commands, and historical legacy skill roots from older installs/migrations:

```bash
# Check for legacy agents directory
ls -la ~/.copilot/agents/ 2>/dev/null

# Check for legacy commands directory
ls -la ~/.copilot/commands/ 2>/dev/null

# Check canonical current skills directory
ls -la ${COPILOT_HOME:-~/.copilot}/skills/ 2>/dev/null

# Check historical legacy skill directory
ls -la ~/.agents/skills/ 2>/dev/null
```

**Diagnosis**:
- If `~/.copilot/agents/` exists with oh-my-ghcopilot-related files: WARN - legacy generated agents or hand-installed role files. The Copilot plugin can package reusable workflows plus plugin-scoped companion metadata for MCP/apps; legacy setup installs native agents, while plugin setup archives stale legacy native-agent files and keeps config/hooks current.
- If `~/.copilot/commands/` exists with oh-my-ghcopilot-related files: WARN - legacy command files from older installs. Current OMGHC uses skills/workflows plus setup-managed native surfaces.
- If `${COPILOT_HOME:-~/.copilot}/skills/` exists with OMGHC skills: OK - canonical current user skill root
- If `~/.agents/skills/` exists: WARN - historical legacy skill root that can overlap with `${COPILOT_HOME:-~/.copilot}/skills/` and cause duplicate Enable/Disable Skills entries

Look for files like:
- `architect.md`, `researcher.md`, `explore.md`, `executor.md`, etc. in agents/
- `ultrawork.md`, `deepsearch.md`, etc. in commands/
- Any oh-my-ghcopilot-related `.md` files in skills/

---

## Report Format

After running all checks, output a report:

```
## OMGHC Doctor Report

### Summary
[HEALTHY / ISSUES FOUND]

### Checks

| Check | Status | Details |
|-------|--------|---------|
| Plugin Version | OK/WARN/CRITICAL | ... |
| Hook Config (settings.json / legacy settings.json) | OK/CRITICAL | ... |
| Legacy Scripts (~/.copilot/hooks/) | OK/WARN | ... |
| AGENTS.md | OK/WARN/CRITICAL | ... |
| Authentication (copilot login --status / GH_TOKEN) | OK/CRITICAL | ... |
| Plugin Cache | OK/WARN | ... |
| Legacy Agents (~/.copilot/agents/) | OK/WARN | ... |
| Legacy Commands (~/.copilot/commands/) | OK/WARN | ... |
| Skills (${COPILOT_HOME:-~/.copilot}/skills) | OK/WARN | ... |
| Legacy Skill Root (~/.agents/skills) | OK/WARN | ... |

### Issues Found
1. [Issue description]
2. [Issue description]

### Recommended Fixes
[List fixes based on issues]
```

---

## Auto-Fix (if user confirms)

If issues found, ask user: "Would you like me to fix these issues automatically?"

If yes, apply fixes:

### Fix: Legacy Hooks in legacy settings.json
If `~/.copilot/settings.json` exists, remove the legacy `"hooks"` section (keep other settings intact).

### Fix: Legacy Bash Scripts
```bash
rm -f ~/.copilot/hooks/keyword-detector.sh
rm -f ~/.copilot/hooks/persistent-mode.sh
rm -f ~/.copilot/hooks/session-start.sh
rm -f ~/.copilot/hooks/stop-continuation.sh
```

### Fix: Outdated Plugin
```bash
# Global cache reset across all marketplaces for this plugin.
# If you only want one marketplace, set MARKETPLACE_NAME and remove just that subtree instead.
PLUGIN_CACHE_ROOT="${COPILOT_HOME:-$HOME/.copilot}/plugins/cache"
find "$PLUGIN_CACHE_ROOT" -path "*/oh-my-ghcopilot" -type d -prune -exec rm -rf {} +
echo "Plugin cache cleared across all marketplaces. Restart Copilot CLI to fetch the latest marketplace entry."
```

### Fix: Stale Cache (multiple versions)
```bash
# Keep only the newest version inside the selected marketplace/plugin cache.
# Set MARKETPLACE_NAME to the exact marketplace printed in Step 1.
PLUGIN_CACHE_ROOT="${COPILOT_HOME:-$HOME/.copilot}/plugins/cache"
PLUGIN_CACHE_DIR="$PLUGIN_CACHE_ROOT/$MARKETPLACE_NAME/oh-my-ghcopilot"
KEEP_VERSION=$(for dir in "$PLUGIN_CACHE_DIR"/*; do [[ -d "$dir" ]] && basename "$dir"; done | sort -V | tail -1)
if [[ -n "$KEEP_VERSION" ]]; then
  find "$PLUGIN_CACHE_DIR" -mindepth 1 -maxdepth 1 -type d ! -name "$KEEP_VERSION" -exec rm -rf {} +
fi
```

### Fix: Missing/Outdated AGENTS.md
Fetch latest from GitHub and write to `~/.copilot/AGENTS.md`:
```
WebFetch(url: "https://raw.githubusercontent.com/Yeachan-Heo/oh-my-codex/main/docs/AGENTS.md", prompt: "Return the complete raw markdown content exactly as-is")
```

### Fix: Authentication Failure
If `copilot login --status` reports not signed in, run interactive login:
```bash
copilot login
```
For headless / CI environments, set a personal-access token instead:
```bash
export GH_TOKEN="<your-token>"
# or
export GITHUB_TOKEN="<your-token>"
```

### Fix: Legacy Curl-Installed Content

Remove legacy agents/commands plus the historical `~/.agents/skills` tree if it overlaps with the canonical `${COPILOT_HOME:-~/.copilot}/skills` install:

```bash
# Backup first (optional - ask user)
# mv ~/.copilot/agents ~/.copilot/agents.bak
# mv ~/.copilot/commands ~/.copilot/commands.bak
# mv ~/.agents/skills ~/.agents/skills.bak

# Or remove directly
rm -rf ~/.copilot/agents
rm -rf ~/.copilot/commands
rm -rf ~/.agents/skills
```

**Note**: Only remove if these contain oh-my-ghcopilot-related files. If user has custom agents/commands/skills, warn them and ask before removing.

---

## Post-Fix

After applying fixes, inform user:
> Fixes applied. **Restart Copilot CLI** for changes to take effect.

<!-- Ported from oh-my-codex (OMX) v0.15.1 by oh-my-ghcopilot. Original by Yeachan Heo et al., MIT. -->
