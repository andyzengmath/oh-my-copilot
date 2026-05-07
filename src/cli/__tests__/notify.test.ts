import { test } from "node:test";
import assert from "node:assert/strict";
import { runNotify, _internals } from "../notify.js";

const { parseArgs, buildText, buildSlackPayload, buildDiscordPayload, redactWebhook, resolveTargets } = _internals;

function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = vars[k]!;
    }
  }
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = prev[k]!;
      }
    }
  });
}

// --- parseArgs (direct unit tests) -----------------------------------------

test("parseArgs default: no flags = target=all, severity=info, no message", () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.target, "all");
  assert.equal(parsed.severity, "info");
  assert.equal(parsed.message, null);
  assert.equal(parsed.title, null);
  assert.equal(parsed.dryRun, false);
  assert.equal(parsed.help, false);
});

test("parseArgs accepts --message inline + spaced forms", () => {
  const a = parseArgs(["--message", "hello"]);
  const b = parseArgs(["--message=hello"]);
  assert.equal(a.message, "hello");
  assert.equal(b.message, "hello");
});

test("parseArgs accepts --target slack/discord/all", () => {
  assert.equal(parseArgs(["--target", "slack"]).target, "slack");
  assert.equal(parseArgs(["--target=discord"]).target, "discord");
  assert.equal(parseArgs(["--target", "all"]).target, "all");
});

test("parseArgs rejects invalid --target", () => {
  assert.throws(() => parseArgs(["--target", "telegram"]), /must be slack/);
});

test("parseArgs accepts --severity info/warn/error", () => {
  assert.equal(parseArgs(["--severity", "info"]).severity, "info");
  assert.equal(parseArgs(["--severity=warn"]).severity, "warn");
  assert.equal(parseArgs(["--severity", "error"]).severity, "error");
});

test("parseArgs rejects invalid --severity", () => {
  assert.throws(() => parseArgs(["--severity", "fatal"]), /must be info/);
});

test("parseArgs accepts --title spaced + inline", () => {
  assert.equal(parseArgs(["--title", "CI"]).title, "CI");
  assert.equal(parseArgs(["--title=Build"]).title, "Build");
});

test("parseArgs --dry-run sets flag", () => {
  assert.equal(parseArgs(["--dry-run"]).dryRun, true);
});

test("parseArgs --help / -h / help all set help flag", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
  assert.equal(parseArgs(["help"]).help, true);
});

test("parseArgs throws on missing value for --message/--target/--title/--severity", () => {
  assert.throws(() => parseArgs(["--message"]), /requires a value/);
  assert.throws(() => parseArgs(["--target"]), /requires a value/);
  assert.throws(() => parseArgs(["--title"]), /requires a value/);
  assert.throws(() => parseArgs(["--severity"]), /requires a value/);
});

test("parseArgs throws on unknown flag", () => {
  assert.throws(() => parseArgs(["--flux"]), /unknown argument/);
});

// --- buildText -------------------------------------------------------------

test("buildText composes severity emoji + optional title + message", () => {
  const text1 = buildText({
    message: "hello",
    target: "all",
    title: null,
    severity: "info",
    dryRun: false,
    help: false,
  });
  assert.match(text1, /:information_source:/);
  assert.match(text1, /hello/);

  const text2 = buildText({
    message: "build failed",
    target: "slack",
    title: "CI",
    severity: "error",
    dryRun: false,
    help: false,
  });
  assert.match(text2, /:rotating_light:/);
  assert.match(text2, /CI: build failed/);

  const text3 = buildText({
    message: "msg",
    target: "discord",
    title: null,
    severity: "warn",
    dryRun: false,
    help: false,
  });
  assert.match(text3, /:warning:/);
});

test("buildText handles null message gracefully", () => {
  const text = buildText({
    message: null,
    target: "all",
    title: null,
    severity: "info",
    dryRun: false,
    help: false,
  });
  // null message becomes empty string in the output.
  assert.match(text, /:information_source: $/);
});

// --- buildSlackPayload / buildDiscordPayload -------------------------------

test("buildSlackPayload returns {text}", () => {
  const payload = buildSlackPayload({
    message: "hello",
    target: "all",
    title: null,
    severity: "info",
    dryRun: false,
    help: false,
  });
  assert.ok(typeof payload.text === "string");
});

test("buildDiscordPayload returns {content}", () => {
  const payload = buildDiscordPayload({
    message: "hello",
    target: "all",
    title: null,
    severity: "info",
    dryRun: false,
    help: false,
  });
  assert.ok(typeof payload.content === "string");
});

// --- redactWebhook ---------------------------------------------------------

test("redactWebhook keeps protocol+host, hides path", () => {
  const r = redactWebhook("https://hooks.slack.com/services/T0/B0/abc123");
  assert.equal(r, "https://hooks.slack.com/<redacted>");
});

test("redactWebhook on invalid URL returns <redacted>", () => {
  const r = redactWebhook("not-a-url");
  assert.equal(r, "<redacted>");
});

// --- resolveTargets --------------------------------------------------------

test("resolveTargets target=all returns slack + discord with current env", async () => {
  await withEnv(
    {
      OMGHC_NOTIFY_SLACK_WEBHOOK: "https://hooks.slack.com/x",
      OMGHC_NOTIFY_DISCORD_WEBHOOK: undefined,
    },
    () => {
      const targets = resolveTargets({
        message: "x",
        target: "all",
        title: null,
        severity: "info",
        dryRun: false,
        help: false,
      });
      assert.equal(targets.length, 2);
      const slack = targets.find((t) => t.target === "slack");
      const discord = targets.find((t) => t.target === "discord");
      assert.equal(slack?.url, "https://hooks.slack.com/x");
      assert.equal(discord?.url, null);
    },
  );
});

test("resolveTargets target=slack only returns slack entry", async () => {
  await withEnv(
    { OMGHC_NOTIFY_SLACK_WEBHOOK: "https://hooks.slack.com/y" },
    () => {
      const targets = resolveTargets({
        message: "x",
        target: "slack",
        title: null,
        severity: "info",
        dryRun: false,
        help: false,
      });
      assert.equal(targets.length, 1);
      assert.equal(targets[0]!.target, "slack");
    },
  );
});

// --- runNotify (CLI integration via process.env) ---------------------------

test("runNotify --help exits 0", async () => {
  const code = await runNotify(["--help"]);
  assert.equal(code, 0);
});

test("runNotify with no --message exits 2", async () => {
  await withEnv(
    {
      OMGHC_NOTIFY_SLACK_WEBHOOK: undefined,
      OMGHC_NOTIFY_DISCORD_WEBHOOK: undefined,
    },
    async () => {
      const code = await runNotify(["--target", "slack"]);
      assert.equal(code, 2);
    },
  );
});

test("runNotify with bad --target exits 2", async () => {
  const code = await runNotify(["--message", "x", "--target", "fax"]);
  assert.equal(code, 2);
});

test("runNotify with bad --severity exits 2", async () => {
  const code = await runNotify([
    "--message",
    "x",
    "--severity",
    "doom",
  ]);
  assert.equal(code, 2);
});

test("runNotify with no env vars and --message succeeds (no-op, exit 0)", async () => {
  await withEnv(
    {
      OMGHC_NOTIFY_SLACK_WEBHOOK: undefined,
      OMGHC_NOTIFY_DISCORD_WEBHOOK: undefined,
    },
    async () => {
      const code = await runNotify(["--message", "test"]);
      assert.equal(code, 0);
    },
  );
});

test("runNotify --dry-run with slack env succeeds and does not POST", async () => {
  await withEnv(
    {
      OMGHC_NOTIFY_SLACK_WEBHOOK: "https://hooks.slack.com/services/x/y/z",
      OMGHC_NOTIFY_DISCORD_WEBHOOK: undefined,
    },
    async () => {
      const code = await runNotify([
        "--message",
        "dry test",
        "--target",
        "slack",
        "--dry-run",
      ]);
      assert.equal(code, 0);
    },
  );
});

test("runNotify --dry-run with both env vars and target=all succeeds", async () => {
  await withEnv(
    {
      OMGHC_NOTIFY_SLACK_WEBHOOK: "https://hooks.slack.com/services/x/y/z",
      OMGHC_NOTIFY_DISCORD_WEBHOOK: "https://discord.com/api/webhooks/1/abc",
    },
    async () => {
      const code = await runNotify([
        "--message",
        "all test",
        "--target",
        "all",
        "--dry-run",
        "--severity",
        "warn",
        "--title",
        "CI",
      ]);
      assert.equal(code, 0);
    },
  );
});

test("runNotify unknown flag exits 2", async () => {
  const code = await runNotify(["--message", "x", "--bogus"]);
  assert.equal(code, 2);
});
