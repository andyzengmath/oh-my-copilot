---
name: configure-notifications
description: Configure OMGHC notifications - Slack/Discord webhooks for omghc notify
---

# Configure OMGHC Notifications

Walk the user through setting up Slack and/or Discord webhooks for `omghc notify`. OMGHC's notification system reads webhook URLs from environment variables — no config file edits required.

## Triggers

- "configure notifications"
- "setup notifications"
- "notification settings"
- "configure slack"
- "configure discord"
- "slack webhook"
- "discord webhook"

## Configuration model

OMGHC notification routing is environment-variable driven:

| Env var | Purpose |
|---|---|
| `OMGHC_NOTIFY_SLACK_WEBHOOK` | Slack incoming-webhook URL |
| `OMGHC_NOTIFY_DISCORD_WEBHOOK` | Discord webhook URL |

Set either or both. `omghc notify --target all` posts to every configured target. Targets without env vars are skipped with an exit-0 warning (graceful no-op for unconfigured users).

## Step 1: Inspect current state

```bash
echo "Slack:   ${OMGHC_NOTIFY_SLACK_WEBHOOK:+(configured)}${OMGHC_NOTIFY_SLACK_WEBHOOK:-(unset)}"
echo "Discord: ${OMGHC_NOTIFY_DISCORD_WEBHOOK:+(configured)}${OMGHC_NOTIFY_DISCORD_WEBHOOK:-(unset)}"
```

(Never print the webhook URL itself — `omghc notify` redacts URLs in dry-run output for the same reason.)

## Step 2: Ask the user what to configure

Offer:

1. **Slack** — incoming webhook (https://api.slack.com/messaging/webhooks)
2. **Discord** — channel webhook (Server Settings → Integrations → Webhooks → New Webhook → Copy URL)
3. **Both**
4. **Disable** — unset env vars

## Step 3: Help the user obtain the URL

### Slack
1. Visit https://api.slack.com/apps → Create New App → "From scratch"
2. Add the **Incoming Webhooks** feature, toggle Activate.
3. Click "Add New Webhook to Workspace", choose a channel, copy the URL.

### Discord
1. Open the target server → Server Settings → Integrations → Webhooks → New Webhook.
2. Pick a channel, copy the webhook URL.

## Step 4: Set the env var

Recommend adding to the user's shell profile so it persists across sessions.

### bash / zsh

```bash
echo 'export OMGHC_NOTIFY_SLACK_WEBHOOK="https://hooks.slack.com/services/..."' >> ~/.zshrc
echo 'export OMGHC_NOTIFY_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."' >> ~/.zshrc
source ~/.zshrc
```

### PowerShell (Windows, current user)

```powershell
[Environment]::SetEnvironmentVariable("OMGHC_NOTIFY_SLACK_WEBHOOK",   "https://hooks.slack.com/services/...", "User")
[Environment]::SetEnvironmentVariable("OMGHC_NOTIFY_DISCORD_WEBHOOK", "https://discord.com/api/webhooks/...",   "User")
```

(User must restart the shell to pick up the change.)

### Session-only (any shell, no persistence)

```bash
export OMGHC_NOTIFY_SLACK_WEBHOOK="https://hooks.slack.com/services/..."
```

## Step 5: Verify with a dry-run

```bash
omghc notify --message "config check" --dry-run --target all
```

Expected output (URL redacted):

```
[dry-run] slack -> https://hooks.slack.com/<redacted>
[dry-run] payload: {"text":":information_source: config check"}
[dry-run] discord -> https://discord.com/<redacted>
[dry-run] payload: {"content":":information_source: config check"}
```

## Step 6 (optional): Real send

```bash
omghc notify --message "hello from omghc" --target slack --severity info
omghc notify --message "build failed" --target discord --severity error --title "CI"
```

`omghc notify` exits 0 on success or graceful no-op (no targets configured), 1 on POST failure, 2 on argument errors.

## Disabling

Unset the env vars (or comment out the export line in your shell profile, then `source` it / restart shell). OMGHC's notify command treats absence as a no-op — no other state to clear.
