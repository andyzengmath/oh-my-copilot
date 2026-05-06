---
name: help
description: Guide on using oh-my-ghcopilot plugin
---

# How OMGHC Works

Plain English works as best-effort guidance — OMGHC inspects each prompt and may add advisory routing context to steer the model toward a suitable lane. This is **advisory prompt-routing context**: it does not activate a skill or workflow by itself. Explicit keywords remain the deterministic control surface when you want exact, guaranteed routing.

**Triage lanes** (when no keyword matches): complex/multi-step prompts may receive HEAVY guidance (autopilot-shaped); repo-local read-only lookups receive LIGHT/explore guidance; implementation work receives LIGHT/executor guidance; UI work receives LIGHT/designer guidance; external official-doc/reference/source-backed lookup receives LIGHT/researcher guidance; simple conversational prompts receive no injection (PASS). To opt out per prompt, include a phrase such as `no workflow`, `just chat`, or `plain answer`.

## What Happens Automatically

| When You... | I Automatically... |
|-------------|-------------------|
| Give me a complex task | Parallelize and delegate to specialist agents |
| Ask me to plan something | Start a planning interview |
| Need something done completely | Persist until verified complete |
| Work on UI/frontend | Activate design sensibility |
| Say "stop" or "cancel" | Intelligently stop current operation |

## Magic Keywords (Optional Shortcuts)

You can include these words naturally in your request for explicit control:

| Keyword | Effect | Example |
|---------|--------|---------|
| **ralph** | Persistence mode | "ralph: fix all the bugs" |
| **ralplan** | Iterative planning | "ralplan this feature" |
| **ulw** | Max parallelism | "ulw refactor the API" |
| **plan** | Planning interview | "plan the new endpoints" |

**ralph includes ultrawork:** When you activate ralph mode, it automatically includes ultrawork's parallel execution. No need to combine keywords.

## Stopping Things

Just say:
- "stop"
- "cancel"
- "abort"

I'll figure out what to stop based on context.

## First Time Setup

If you haven't configured OMGHC yet:

```
/omghc-setup
```

This is the primary setup command for full OMGHC runtime wiring. Copilot CLI plugin install/discovery can expose packaged skills/workflows plus plugin-scoped companion metadata for MCP servers and apps, while native/runtime hooks remain setup-owned; it is not a replacement for `npm install -g oh-my-ghcopilot` plus `omghc setup`. Legacy setup mode installs native agents/prompts; plugin setup mode archives stale legacy prompt/native-agent files and keeps config/hooks/optional AGENTS.md/HUD/runtime wiring current, including native `.copilot/hooks.json` coverage. Plugin caches may appear under `${COPILOT_HOME:-~/.copilot}/plugins/cache/$MARKETPLACE_NAME/oh-my-ghcopilot/$VERSION/` (or `local` for local installs).

If you only need lightweight directory guidance scaffolding for `AGENTS.md` files, use:

```bash
omghc agents-init .
```

That command is intentionally narrower than full setup: it only bootstraps `AGENTS.md` files for the target directory and its immediate child directories.

## For 2.x Users

Your old commands still work! `/ralph`, `/ultrawork`, `/plan`, etc. all function exactly as before.

But now you don't NEED them - everything is automatic.

---

## Usage Analysis

Analyze your oh-my-ghcopilot usage and get tailored recommendations to improve your workflow.

> Note: This replaces the former `/learn-about-omc` skill.

### What It Does

1. Reads token tracking from `~/.omghc/state/token-tracking.jsonl`
2. Reads session history from `.omghc/state/session-history.json`
3. Analyzes agent usage patterns
4. Identifies underutilized features
5. Recommends configuration changes

### Step 1: Gather Data

```bash
# Check for token tracking data
TOKEN_FILE="$HOME/.omghc/state/token-tracking.jsonl"
SESSION_FILE=".omghc/state/session-history.json"
CONFIG_FILE="$HOME/.copilot/.omghc-config.json"

echo "Analyzing OMGHC Usage..."
echo ""

# Check what data is available
HAS_TOKENS=false
HAS_SESSIONS=false
HAS_CONFIG=false

if [[ -f "$TOKEN_FILE" ]]; then
  HAS_TOKENS=true
  TOKEN_COUNT=$(wc -l < "$TOKEN_FILE")
  echo "Token records found: $TOKEN_COUNT"
fi

if [[ -f "$SESSION_FILE" ]]; then
  HAS_SESSIONS=true
  SESSION_COUNT=$(cat "$SESSION_FILE" | jq '.sessions | length' 2>/dev/null || echo "0")
  echo "Sessions found: $SESSION_COUNT"
fi

if [[ -f "$CONFIG_FILE" ]]; then
  HAS_CONFIG=true
  DEFAULT_MODE=$(cat "$CONFIG_FILE" | jq -r '.defaultExecutionMode // "not set"')
  echo "Default execution mode: $DEFAULT_MODE"
fi
```

### Step 2: Analyze Agent Usage (if token data exists)

```bash
if [[ "$HAS_TOKENS" == "true" ]]; then
  echo ""
  echo "TOP AGENTS BY USAGE:"
  cat "$TOKEN_FILE" | jq -r '.agentName // "main"' | sort | uniq -c | sort -rn | head -10

  echo ""
  echo "MODEL DISTRIBUTION:"
  cat "$TOKEN_FILE" | jq -r '.modelName' | sort | uniq -c | sort -rn
fi
```

### Step 3: Generate Recommendations

Based on patterns found, output recommendations:

**If high Opus usage (>40%) and no ecomode:**
- "Consider using ecomode for routine tasks to save tokens"

**If no team usage:**
- "Try /team for coordinated review workflows"

**If no security-reviewer usage:**
- "Use security-reviewer after auth/API changes"

**If defaultExecutionMode not set:**
- "Set defaultExecutionMode in /omghc-setup for consistent behavior"

### Step 4: Output Report

Format a summary with:
- Token summary (total, by model)
- Top agents used
- Underutilized features
- Personalized recommendations

### Example Output

```
📊 Your OMGHC Usage Analysis

TOKEN SUMMARY:
- Total records: 1,234
- By Reasoning Effort: high 45%, medium 40%, low 15%

TOP AGENTS:
1. executor (234 uses)
2. architect (89 uses)
3. explore (67 uses)

UNDERUTILIZED FEATURES:
- ecomode: 0 uses (could save ~30% on routine tasks)
- team: 0 uses (great for coordinated workflows)

RECOMMENDATIONS:
1. Set defaultExecutionMode: "ecomode" to save tokens
2. Try /team for PR review workflows
3. Use explore agent before architect to save context
```

### Graceful Degradation

If no data found:

```
📊 Limited Usage Data Available

No token tracking found. To enable tracking:
1. Ensure ~/.omghc/state/ directory exists
2. Run any OMGHC command to start tracking

Tip: Run /omghc-setup to configure OMGHC properly.
```

## Need More Help?

- **README**: https://github.com/Yeachan-Heo/oh-my-codex
- **Issues**: https://github.com/Yeachan-Heo/oh-my-codex/issues

---

*Version: 4.2.3*

<!-- Ported from oh-my-codex (OMX) v0.15.1 by oh-my-ghcopilot. Original by Yeachan Heo et al., MIT. -->
