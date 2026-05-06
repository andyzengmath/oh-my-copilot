import { translateWorkerLaunchArgsForCli } from "./tmux-session.js";
import type {
  TeamWorkerCli,
  TranslateLaunchOptions,
} from "./tmux-session.js";

const COPILOT_AUTH_ENV_PRECEDENCE = [
  "COPILOT_GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
] as const;

const COPILOT_PASSTHROUGH_ENV = [
  ...COPILOT_AUTH_ENV_PRECEDENCE,
  "COPILOT_HOME",
  "COPILOT_GH_HOST",
  "COPILOT_PROVIDER_BASE_URL",
] as const;

const CODEX_AUTH_ENV = ["OPENAI_API_KEY"] as const;
const CLAUDE_AUTH_ENV = ["ANTHROPIC_API_KEY"] as const;
const GEMINI_AUTH_ENV = ["GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;

export interface AuthResolution {
  cli: TeamWorkerCli;
  source:
    | "env-token"
    | "cached-login"
    | "byok"
    | "missing";
  env_var?: string;
  byok_provider?: string;
  message?: string;
}

export interface BootstrapEnv {
  [key: string]: string;
}

export interface BootstrapOptions {
  cli: TeamWorkerCli;
  team_name: string;
  worker_name: string;
  worker_role: string;
  cwd: string;
  prompt?: string;
  reasoning?: TranslateLaunchOptions["reasoning"];
  log_dir?: string;
  binary_override?: string;
  /**
   * Caller-supplied environment. Defaults to `process.env`. Tests pass an
   * isolated map so the resolver does not depend on the live process env.
   */
  source_env?: NodeJS.ProcessEnv;
}

export interface BootstrapPlan {
  cli: TeamWorkerCli;
  binary: string;
  args: string[];
  env: BootstrapEnv;
  auth: AuthResolution;
  scripts: { bash: string; powershell: string };
}

const TEAM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const WORKER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function assertSafeName(label: string, value: string): void {
  const pattern = label === "team_name" ? TEAM_NAME_PATTERN : WORKER_NAME_PATTERN;
  if (!pattern.test(value)) {
    throw new Error(`invalid_${label}:${value}`);
  }
}

function isPresent(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function defaultBinary(cli: TeamWorkerCli): string {
  switch (cli) {
    case "copilot":
      return "copilot";
    case "codex":
      return "codex";
    case "claude":
      return "claude";
    case "gemini":
      return "gemini";
  }
}

export function resolveAuth(
  cli: TeamWorkerCli,
  env: NodeJS.ProcessEnv,
): AuthResolution {
  if (cli === "copilot") {
    if (isPresent(env.COPILOT_PROVIDER_BASE_URL)) {
      return {
        cli,
        source: "byok",
        byok_provider: env.COPILOT_PROVIDER_BASE_URL,
        message: "BYOK provider override active; GitHub token not required",
      };
    }
    for (const name of COPILOT_AUTH_ENV_PRECEDENCE) {
      if (isPresent(env[name])) {
        return { cli, source: "env-token", env_var: name };
      }
    }
    return {
      cli,
      source: "cached-login",
      message:
        "no auth env var set; copilot will fall back to cached login under ~/.copilot/",
    };
  }

  const required = (() => {
    switch (cli) {
      case "codex":
        return CODEX_AUTH_ENV;
      case "claude":
        return CLAUDE_AUTH_ENV;
      case "gemini":
        return GEMINI_AUTH_ENV;
    }
  })();

  for (const name of required) {
    if (isPresent(env[name])) {
      return { cli, source: "env-token", env_var: name };
    }
  }

  return {
    cli,
    source: "missing",
    message: `${cli} worker requires one of: ${required.join(", ")}`,
  };
}

function buildPassthroughEnv(
  cli: TeamWorkerCli,
  source: NodeJS.ProcessEnv,
): BootstrapEnv {
  const out: BootstrapEnv = {};
  const names = (() => {
    switch (cli) {
      case "copilot":
        return COPILOT_PASSTHROUGH_ENV;
      case "codex":
        return CODEX_AUTH_ENV;
      case "claude":
        return CLAUDE_AUTH_ENV;
      case "gemini":
        return GEMINI_AUTH_ENV;
    }
  })();
  for (const name of names) {
    const value = source[name];
    if (isPresent(value)) out[name] = value;
  }
  return out;
}

function quoteBash(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildBootstrapScripts(
  plan: Omit<BootstrapPlan, "scripts">,
  options: BootstrapOptions,
): { bash: string; powershell: string } {
  const { cli, binary, args, auth } = plan;
  const requiredEnv = (() => {
    switch (cli) {
      case "copilot":
        return COPILOT_AUTH_ENV_PRECEDENCE;
      case "codex":
        return CODEX_AUTH_ENV;
      case "claude":
        return CLAUDE_AUTH_ENV;
      case "gemini":
        return GEMINI_AUTH_ENV;
    }
  })();

  const banner = `OMGHC worker bootstrap: team=${options.team_name} worker=${options.worker_name} role=${options.worker_role} cli=${cli}`;

  // Bash: short-circuit failure if auth missing for non-copilot, or non-cached-login + no env for copilot.
  // Copilot allows cached login fallback, so we DO NOT fail closed there — we just warn.
  const bashAuthCheck =
    cli === "copilot"
      ? [
          `if [ -z "$COPILOT_PROVIDER_BASE_URL" ] && [ -z "$COPILOT_GITHUB_TOKEN" ] && [ -z "$GH_TOKEN" ] && [ -z "$GITHUB_TOKEN" ]; then`,
          `  echo "[omghc] no copilot auth env var set; relying on cached login under \\$HOME/.copilot/" 1>&2`,
          `fi`,
        ].join("\n")
      : [
          `_omghc_have_auth=0`,
          ...requiredEnv.map(
            (name) => `if [ -n "$${name}" ]; then _omghc_have_auth=1; fi`,
          ),
          `if [ "$_omghc_have_auth" != "1" ]; then`,
          `  echo "[omghc] FATAL: ${cli} worker requires one of: ${requiredEnv.join(", ")}" 1>&2`,
          `  exit 78`,
          `fi`,
        ].join("\n");

  const bashArgs = args.map(quoteBash).join(" ");
  const bashScript = [
    `#!/usr/bin/env bash`,
    `set -euo pipefail`,
    `# ${banner}`,
    `# auth=${auth.source}${auth.env_var ? `:${auth.env_var}` : ""}`,
    bashAuthCheck,
    `cd ${quoteBash(options.cwd)}`,
    options.log_dir ? `mkdir -p ${quoteBash(options.log_dir)}` : "",
    `exec ${quoteBash(binary)} ${bashArgs}`,
    "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  // PowerShell: same logic with PowerShell idioms.
  const psAuthCheck =
    cli === "copilot"
      ? [
          `if (-not $env:COPILOT_PROVIDER_BASE_URL -and -not $env:COPILOT_GITHUB_TOKEN -and -not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {`,
          `  Write-Warning '[omghc] no copilot auth env var set; relying on cached login under $env:USERPROFILE\\.copilot'`,
          `}`,
        ].join("\n")
      : [
          `$haveAuth = $false`,
          ...requiredEnv.map(
            (name) => `if ($env:${name}) { $haveAuth = $true }`,
          ),
          `if (-not $haveAuth) {`,
          `  Write-Error "[omghc] FATAL: ${cli} worker requires one of: ${requiredEnv.join(", ")}"`,
          `  exit 78`,
          `}`,
        ].join("\n");

  const psArgs = args.map(quotePowerShell).join(" ");
  const psScript = [
    `# ${banner}`,
    `# auth=${auth.source}${auth.env_var ? `:${auth.env_var}` : ""}`,
    `$ErrorActionPreference = 'Stop'`,
    psAuthCheck,
    `Set-Location ${quotePowerShell(options.cwd)}`,
    options.log_dir
      ? `New-Item -ItemType Directory -Force -Path ${quotePowerShell(options.log_dir)} | Out-Null`
      : "",
    `& ${quotePowerShell(binary)} ${psArgs}`,
    "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");

  return { bash: bashScript, powershell: psScript };
}

export function buildBootstrapPlan(options: BootstrapOptions): BootstrapPlan {
  assertSafeName("team_name", options.team_name);
  assertSafeName("worker_name", options.worker_name);
  if (!options.cwd || options.cwd.trim() === "") {
    throw new Error("buildBootstrapPlan: cwd required");
  }

  const sourceEnv = options.source_env ?? process.env;
  const auth = resolveAuth(options.cli, sourceEnv);
  const env = buildPassthroughEnv(options.cli, sourceEnv);
  const binary = options.binary_override ?? defaultBinary(options.cli);

  const launchArgs = translateWorkerLaunchArgsForCli(options.cli, {
    prompt: options.prompt,
    reasoning: options.reasoning,
  });

  // Append --log-dir for copilot when supplied (worker-isolated logs per spike rec #7).
  const args = [...launchArgs];
  if (options.cli === "copilot" && options.log_dir) {
    args.push("--log-dir", options.log_dir);
  }

  const partial: Omit<BootstrapPlan, "scripts"> = {
    cli: options.cli,
    binary,
    args,
    env,
    auth,
  };

  const scripts = buildBootstrapScripts(partial, options);

  return { ...partial, scripts };
}

export function assertAuthAvailable(plan: BootstrapPlan): void {
  if (plan.auth.source === "missing") {
    throw new Error(
      plan.auth.message ?? `${plan.cli} worker auth not available`,
    );
  }
}
