# Integrations

OMGHC ships a small notification surface for routing status messages to chat platforms and CI systems, plus environment-variable knobs for headless / CI usage. This doc covers the v0.1.0 integration points.

See [getting-started.md](./getting-started.md) for install and [skills.md](./skills.md) for the skill surface.

## `omghc notify`

`omghc notify` is the unified notification entrypoint. It routes a message to a configured target (Slack, Discord, or future webhooks) using webhook URLs read from the environment.

```bash
omghc notify --target slack --message "ralph completed: PR #142 merged"
omghc notify --target discord --message "team shutdown: 3 tasks completed, 0 failed"
```

Flags:

- `--target slack | discord` — destination (required)
- `--message "<text>"` — message body (required)
- `--title "<text>"` — optional headline; rendered as bold prefix on Slack, embed title on Discord
- `--level info | warn | error` — controls color/emoji decoration
- `--json` — emit a structured result `{ ok, target, status_code, ... }`

Exit codes:

- `0` — delivered
- `1` — webhook configured but request failed (network or non-2xx response)
- `2` — webhook URL not configured

## Slack

`--target slack` posts to a Slack incoming webhook.

### Configure

Create an incoming webhook in your Slack workspace (`Apps → Incoming Webhooks → Add to Slack → pick channel`). Copy the URL.

```bash
export OMGHC_SLACK_WEBHOOK_URL="https://hooks.slack.com/services/T.../B.../..."
```

Persist it in your shell rc, `.env`, or CI secrets store. Never commit it.

### Send

```bash
omghc notify --target slack \
  --title "autopilot complete" \
  --message "Spec, plan, code, tests, and validation all green" \
  --level info
```

Slack receives a formatted message with the title bolded and the level emoji prefixed.

## Discord

`--target discord` posts to a Discord webhook.

### Configure

Server settings → Integrations → Webhooks → New Webhook → copy URL.

```bash
export OMGHC_DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/.../..."
```

### Send

```bash
omghc notify --target discord \
  --title "team failed" \
  --message "worker-2 failed verification: see .omghc/state/team/<name>" \
  --level error
```

Discord receives an embed with the title, message, and a color derived from `--level`.

## CI integration

OMGHC is safe to run in CI as long as Copilot CLI is authenticated and tmux-dependent surfaces are skipped.

### Required env vars

```bash
GH_TOKEN=<personal-access-token>     # or GITHUB_TOKEN
COPILOT_HOME=/tmp/copilot            # optional; isolates per-job state
OMGHC_SLACK_WEBHOOK_URL=...          # optional notify target
OMGHC_DISCORD_WEBHOOK_URL=...        # optional notify target
```

### Pre-job check

Run `omghc doctor` early in the pipeline to fail fast on auth / install issues:

```yaml
- name: OMGHC pre-job check
  run: omghc doctor
```

`omghc doctor` exits non-zero on `CRITICAL` findings (missing auth, missing AGENTS.md, broken plugin cache).

### Skipping team mode in CI

`$team` and `omghc team` require tmux. CI runners without tmux should not invoke team mode. Tests that depend on tmux gate themselves (`t.skip` when tmux is missing); your own jobs should follow the same pattern:

```bash
if command -v tmux >/dev/null 2>&1; then
  omghc team 2:executor "ci-side validation"
else
  echo "tmux not available; skipping team mode"
fi
```

### Notify on success / failure

```yaml
- name: Notify Slack on failure
  if: failure()
  run: |
    omghc notify --target slack \
      --title "CI failed: ${{ github.workflow }}" \
      --message "${{ github.event.head_commit.message }}" \
      --level error
```

## Webhook configuration reference

All webhook URLs are read from the environment. There is no on-disk webhook config in v0.1.0 — this keeps secrets out of the repo and out of `~/.copilot/`.

| Variable                    | Purpose                          |
| --------------------------- | -------------------------------- |
| `OMGHC_SLACK_WEBHOOK_URL`   | Slack incoming webhook           |
| `OMGHC_DISCORD_WEBHOOK_URL` | Discord webhook                  |
| `GH_TOKEN` / `GITHUB_TOKEN` | Headless Copilot CLI auth        |
| `COPILOT_HOME`              | Override Copilot config root     |

If a webhook variable is unset and you target it via `omghc notify`, the command exits with code `2` and a clear `webhook URL not configured` message — no silent drops.

## Future integrations

Planned for post-v0.1.0:

- **GitHub Actions**: A first-party action wrapping `omghc setup` + `omghc doctor` + `omghc notify`, plus a reusable workflow for plugin-mirror parity verification.
- **Status pages**: Periodic state digest published from the HUD-readable team/mode state files.
- **Webhook fan-out**: Support multiple `OMGHC_*_WEBHOOK_URL` per target for routing severity to different channels.
- **Email / SMS**: Direct routes for on-call escalation paths.

These are not in v0.1.0; track them in the project's roadmap once issue tracking is wired up.

## Related docs

- [getting-started.md](./getting-started.md) — install and first-run
- [skills.md](./skills.md) — skill catalogue
- [auth.md](./auth.md) — Copilot CLI authentication
- [copilot-native-hooks.md](./copilot-native-hooks.md) — hook lifecycle
- [copilot-prompt-mode.md](./copilot-prompt-mode.md) — non-interactive prompt mode
