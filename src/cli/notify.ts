/**
 * `omghc notify` — Slack/Discord webhook notification routing.
 *
 * Posts a message to one or more notification targets configured via
 * environment variables. Used by long-running workflows (team, ralph,
 * ultrawork) to surface completion/error events outside the terminal.
 *
 * Webhook URLs are read from env (never printed in non-dry-run mode):
 *   OMGHC_NOTIFY_SLACK_WEBHOOK
 *   OMGHC_NOTIFY_DISCORD_WEBHOOK
 *
 * Usage:
 *   omghc notify --message <text> [--target slack|discord|all]
 *                                 [--title <text>]
 *                                 [--severity info|warn|error]
 *                                 [--dry-run] [--help]
 */

export type NotifyTarget = "slack" | "discord" | "all";
export type NotifySeverity = "info" | "warn" | "error";

interface ParsedArgs {
  message: string | null;
  target: NotifyTarget;
  title: string | null;
  severity: NotifySeverity;
  dryRun: boolean;
  help: boolean;
}

const HELP = `Usage: omghc notify --message <text> [options]

Post a notification to Slack and/or Discord webhooks.

Required:
  --message <text>          Message body (required unless --help).

Options:
  --target <slack|discord|all>
                            Which target(s) to notify (default: all).
  --title <text>            Optional title prefixed to the message.
  --severity <info|warn|error>
                            Severity (default: info). Adds an emoji prefix.
  --dry-run                 Print payloads (with redacted webhook URLs)
                            instead of POSTing.
  --help, -h                Show this help.

Environment:
  OMGHC_NOTIFY_SLACK_WEBHOOK     Slack incoming-webhook URL.
  OMGHC_NOTIFY_DISCORD_WEBHOOK   Discord webhook URL.

Targets without configured webhooks are skipped with a warning;
the command exits 0 even if no webhooks are configured.

Examples:
  omghc notify --message "team finished" --target slack
  omghc notify --message "build failed" --severity error --title "CI"
  omghc notify --message "test" --dry-run
`;

const SEVERITY_EMOJI: Record<NotifySeverity, string> = {
  info: ":information_source:",
  warn: ":warning:",
  error: ":rotating_light:",
};

const POST_TIMEOUT_MS = 5000;

function parseTarget(raw: string): NotifyTarget {
  if (raw === "slack" || raw === "discord" || raw === "all") return raw;
  throw new Error(`--target must be slack|discord|all (got '${raw}')`);
}

function parseSeverity(raw: string): NotifySeverity {
  if (raw === "info" || raw === "warn" || raw === "error") return raw;
  throw new Error(`--severity must be info|warn|error (got '${raw}')`);
}

function takeValue(args: string[], i: number, flag: string): string {
  const next = args[i + 1];
  if (typeof next !== "string") throw new Error(`${flag} requires a value`);
  return next;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = {
    message: null,
    target: "all",
    title: null,
    severity: "info",
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i]!;
    if (token === "--help" || token === "-h" || token === "help") {
      out.help = true;
      continue;
    }
    if (token === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (token === "--message") {
      out.message = takeValue(args, i, "--message");
      i += 1;
      continue;
    }
    if (token.startsWith("--message=")) {
      out.message = token.slice("--message=".length);
      continue;
    }
    if (token === "--target") {
      out.target = parseTarget(takeValue(args, i, "--target"));
      i += 1;
      continue;
    }
    if (token.startsWith("--target=")) {
      out.target = parseTarget(token.slice("--target=".length));
      continue;
    }
    if (token === "--title") {
      out.title = takeValue(args, i, "--title");
      i += 1;
      continue;
    }
    if (token.startsWith("--title=")) {
      out.title = token.slice("--title=".length);
      continue;
    }
    if (token === "--severity") {
      out.severity = parseSeverity(takeValue(args, i, "--severity"));
      i += 1;
      continue;
    }
    if (token.startsWith("--severity=")) {
      out.severity = parseSeverity(token.slice("--severity=".length));
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }

  return out;
}

function buildText(parsed: ParsedArgs): string {
  const emoji = SEVERITY_EMOJI[parsed.severity];
  const titlePart = parsed.title ? `${parsed.title}: ` : "";
  return `${emoji} ${titlePart}${parsed.message ?? ""}`;
}

function buildSlackPayload(parsed: ParsedArgs): Record<string, unknown> {
  return { text: buildText(parsed) };
}

function buildDiscordPayload(parsed: ParsedArgs): Record<string, unknown> {
  return { content: buildText(parsed) };
}

function redactWebhook(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/<redacted>`;
  } catch {
    return "<redacted>";
  }
}

interface PostResult {
  target: "slack" | "discord";
  ok: boolean;
  status?: number;
  error?: string;
}

async function postWebhook(
  target: "slack" | "discord",
  url: string,
  payload: Record<string, unknown>,
): Promise<PostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { target, ok: false, status: res.status };
    }
    return { target, ok: true, status: res.status };
  } catch (err) {
    const e = err as Error & { name?: string };
    const msg = e.name === "AbortError" ? `timeout after ${POST_TIMEOUT_MS}ms` : e.message;
    return { target, ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

interface ResolvedTarget {
  target: "slack" | "discord";
  url: string | null;
  envVar: string;
}

function resolveTargets(parsed: ParsedArgs): ResolvedTarget[] {
  const want: ("slack" | "discord")[] =
    parsed.target === "all" ? ["slack", "discord"] : [parsed.target];
  return want.map((target) => {
    const envVar =
      target === "slack"
        ? "OMGHC_NOTIFY_SLACK_WEBHOOK"
        : "OMGHC_NOTIFY_DISCORD_WEBHOOK";
    const url = process.env[envVar] ?? null;
    return { target, url: url && url.length > 0 ? url : null, envVar };
  });
}

export async function runNotify(args: string[]): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    process.stderr.write(`omghc notify: ${(err as Error).message}\n${HELP}`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (!parsed.message) {
    process.stderr.write(`omghc notify: --message <text> is required\n${HELP}`);
    return 2;
  }

  const targets = resolveTargets(parsed);
  const configured = targets.filter((t) => t.url !== null);
  const missing = targets.filter((t) => t.url === null);

  for (const t of missing) {
    process.stdout.write(
      `omghc notify: ${t.target} webhook not configured (set ${t.envVar})\n`,
    );
  }

  if (configured.length === 0) {
    process.stdout.write("no notification target\n");
    return 0;
  }

  if (parsed.dryRun) {
    for (const t of configured) {
      const payload =
        t.target === "slack"
          ? buildSlackPayload(parsed)
          : buildDiscordPayload(parsed);
      process.stdout.write(
        `[dry-run] ${t.target} -> ${redactWebhook(t.url!)}\n` +
          `[dry-run] payload: ${JSON.stringify(payload)}\n`,
      );
    }
    return 0;
  }

  const results = await Promise.all(
    configured.map((t) => {
      const payload =
        t.target === "slack"
          ? buildSlackPayload(parsed)
          : buildDiscordPayload(parsed);
      return postWebhook(t.target, t.url!, payload);
    }),
  );

  let exit = 0;
  for (const r of results) {
    if (r.ok) {
      process.stdout.write(`omghc notify: ${r.target} ok\n`);
    } else {
      exit = 1;
      const detail = r.error ?? `HTTP ${r.status ?? "?"}`;
      process.stderr.write(`omghc notify: ${r.target} failed (${detail})\n`);
    }
  }
  return exit;
}

export const _internals = {
  parseArgs,
  buildText,
  buildSlackPayload,
  buildDiscordPayload,
  redactWebhook,
  resolveTargets,
};
