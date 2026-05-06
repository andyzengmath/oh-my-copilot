/**
 * `omghc doctor` — diagnose OMGHC + Copilot CLI installation health.
 *
 * Auth model per docs/auth.md (Copilot CLI v1.0.40 has no `--status` flag):
 *   1. env precedence: COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN
 *   2. else parse ${COPILOT_HOME:-~/.copilot}/config.json `loggedInUsers`
 *   3. else FAIL with advice `copilot login`
 * BYOK: if COPILOT_PROVIDER_BASE_URL is set, GitHub auth is bypassed.
 *
 * SECURITY: never print token contents — only env-var presence and host/login.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type CheckStatus = "ok" | "warn" | "fail";
export type CheckSeverity = "low" | "medium" | "high";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
  severity?: CheckSeverity;
  advice?: string;
}

export interface DoctorSummary {
  passed: number;
  warnings: number;
  failed: number;
}

export type HookProbeStatus = "pass" | "fail" | "inconclusive";

export interface HookProbeResult {
  status: HookProbeStatus;
  message: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  summary: DoctorSummary;
  hookWiringProbe?: HookProbeResult;
}

const HELP_TEXT = `omghc doctor — diagnose OMGHC + Copilot CLI install

USAGE:
  omghc doctor [--json] [--probe-hooks]

OPTIONS:
  --json          Emit machine-readable JSON output
  --probe-hooks   Live-probe Copilot CLI hook wiring by firing copilot --prompt
                  with a temporary marker hook. Off by default — slow and
                  requires Copilot auth.
  -h, --help      Show this help

EXIT CODES:
  0  All checks passed (warnings allowed)
  1  One or more checks failed (probe-hooks FAIL does not change exit code)
`;

function copilotHome(): string {
  const override = process.env.COPILOT_HOME;
  if (override && override.length > 0) return override;
  return join(homedir(), ".copilot");
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function spawnCopilotVersion(): { ok: boolean; stdout: string } {
  // Node's spawnSync on Windows refuses to launch .cmd shims (EINVAL post-CVE)
  // unless shell:true. Hardcoded argv (no user input), so injection is not a
  // concern; pass as a single string to avoid DEP0190.
  const result = spawnSync("copilot --version", {
    stdio: "pipe",
    encoding: "utf8",
    shell: true,
  });
  if (!result.error && result.status === 0) {
    return { ok: true, stdout: result.stdout || "" };
  }
  return { ok: false, stdout: "" };
}

function checkCopilotCli(): DoctorCheck {
  const result = spawnCopilotVersion();
  if (!result.ok) {
    return {
      name: "Copilot CLI",
      status: "fail",
      severity: "high",
      message: "not installed or not on PATH",
      advice: "npm install -g @github/copilot",
    };
  }
  const version = result.stdout.trim().split(/\r?\n/)[0] || "unknown";
  return {
    name: "Copilot CLI",
    status: "ok",
    message: `installed (${version})`,
  };
}

function checkNodeVersion(): DoctorCheck {
  const raw = process.versions.node;
  const major = Number.parseInt(raw.split(".")[0] ?? "0", 10);
  if (major >= 20) {
    return {
      name: "Node.js",
      status: "ok",
      message: `v${raw} (>= 20)`,
    };
  }
  return {
    name: "Node.js",
    status: "warn",
    message: `v${raw} (recommend >= 20)`,
    advice: "Upgrade Node.js to v20 or later",
  };
}

interface LoggedInUser {
  host?: unknown;
  login?: unknown;
}

function parseLoggedInUsers(configPath: string): LoggedInUser[] {
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const users = (parsed as { loggedInUsers?: unknown }).loggedInUsers;
    if (!Array.isArray(users)) return [];
    return users.filter((u): u is LoggedInUser => !!u && typeof u === "object");
  } catch {
    return [];
  }
}

function checkAuth(home: string): DoctorCheck {
  const byokUrl = process.env.COPILOT_PROVIDER_BASE_URL;
  if (byokUrl && byokUrl.length > 0) {
    return {
      name: "Auth",
      status: "ok",
      message: `BYOK mode active (provider: ${byokUrl})`,
    };
  }

  const envOrder = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];
  for (const name of envOrder) {
    const value = process.env[name];
    if (value && value.length > 0) {
      return {
        name: "Auth",
        status: "ok",
        message: `via env var ${name}`,
      };
    }
  }

  const configPath = join(home, "config.json");
  if (isFile(configPath)) {
    const users = parseLoggedInUsers(configPath);
    if (users.length > 0) {
      const first = users[0] ?? {};
      const host = typeof first.host === "string" ? first.host : "github.com";
      const login = typeof first.login === "string" ? first.login : "<unknown>";
      return {
        name: "Auth",
        status: "ok",
        message: `via login cache (${host} as ${login})`,
      };
    }
  }

  return {
    name: "Auth",
    status: "fail",
    severity: "high",
    message: "no Copilot credentials detected (env or login cache)",
    advice: "copilot login",
  };
}

function checkSettings(home: string): DoctorCheck {
  const settingsPath = join(home, "settings.json");
  if (!isFile(settingsPath)) {
    return {
      name: "Settings",
      status: "fail",
      severity: "high",
      message: `${settingsPath} missing`,
      advice: "omghc setup",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "Settings",
      status: "fail",
      severity: "high",
      message: `${settingsPath} is not valid JSON: ${msg}`,
      advice: "omghc setup",
    };
  }
  const ns =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)._omghc
      : undefined;
  const managed =
    ns && typeof ns === "object"
      ? (ns as Record<string, unknown>).managed === true
      : false;
  if (managed) {
    return {
      name: "Settings",
      status: "ok",
      message: `${settingsPath} has OMGHC namespace`,
    };
  }
  return {
    name: "Settings",
    status: "warn",
    message: `${settingsPath} exists without _omghc namespace`,
    advice: "omghc setup",
  };
}

function checkAgents(home: string): DoctorCheck {
  const agentsDir = join(home, "agents");
  if (!isDir(agentsDir)) {
    return {
      name: "Agents",
      status: "warn",
      message: `${agentsDir} missing`,
      advice: "omghc setup",
    };
  }
  let count = 0;
  try {
    for (const entry of readdirSync(agentsDir)) {
      if (entry.endsWith(".agent.md") && isFile(join(agentsDir, entry))) {
        count += 1;
      }
    }
  } catch {
    return {
      name: "Agents",
      status: "warn",
      message: `${agentsDir} unreadable`,
      advice: "omghc setup",
    };
  }
  if (count === 0) {
    return {
      name: "Agents",
      status: "warn",
      message: `0 agent files in ${agentsDir}`,
      advice: "omghc setup",
    };
  }
  return {
    name: "Agents",
    status: "ok",
    message: `${count} agent file${count === 1 ? "" : "s"} in ${agentsDir}`,
  };
}

function checkProjectStateWritable(): DoctorCheck {
  const dir = resolve(process.cwd(), ".omghc");
  const probe = join(dir, ".doctor-probe");
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(probe, `${Date.now()}\n`, "utf8");
    unlinkSync(probe);
    return {
      name: "Project .omghc/",
      status: "ok",
      message: "writable",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "Project .omghc/",
      status: "fail",
      severity: "low",
      message: `not writable: ${msg}`,
      advice: "fix filesystem permissions on the project directory",
    };
  }
}

function findGitProjectRoot(): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return null;
  const out = (result.stdout || "").trim();
  return out.length > 0 ? out : null;
}

function hasCopilotAuth(): boolean {
  for (const name of ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]) {
    const v = process.env[name];
    if (v && v.length > 0) return true;
  }
  const configPath = join(copilotHome(), "config.json");
  if (isFile(configPath)) {
    const users = parseLoggedInUsers(configPath);
    if (users.length > 0) return true;
  }
  return false;
}

function getCopilotVersion(): string {
  const r = spawnCopilotVersion();
  if (!r.ok) return "unknown";
  return r.stdout.trim().split(/\r?\n/)[0] ?? "unknown";
}

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Best-effort cleanup
  }
}

export function probeHookWiring(): HookProbeResult {
  const projectRoot = findGitProjectRoot();
  if (!projectRoot) {
    return {
      status: "inconclusive",
      message:
        "not inside a git repository; Copilot only loads hooks under <gitRoot>/.github/hooks/",
    };
  }

  if (!hasCopilotAuth()) {
    return {
      status: "inconclusive",
      message:
        "no Copilot auth available; cannot probe live hooks. Set GH_TOKEN or run `copilot login`.",
    };
  }

  const random = Math.random().toString(36).slice(2, 10);
  const hookDir = join(projectRoot, ".github", "hooks");
  const probeHookPath = join(hookDir, "_omghc-probe.json");
  const markerPath = join(
    projectRoot,
    ".omghc",
    "state",
    `.probe-marker-${random}`,
  );
  const markerForJson = markerPath.replace(/\\/g, "/");
  const markerDir = join(projectRoot, ".omghc", "state");

  const bashCmd = `mkdir -p "${markerForJson.replace(/"/g, '\\"').split("/").slice(0, -1).join("/")}" && touch "${markerForJson}" && printf '{"permissionDecision":"allow"}\\n'`;
  const psCmd = `New-Item -ItemType Directory -Force -Path '${markerDir.replace(/'/g, "''")}' | Out-Null; New-Item -ItemType File -Force -Path '${markerPath.replace(/'/g, "''")}' | Out-Null; Write-Output '{"permissionDecision":"allow"}'`;

  const probeContent = `${JSON.stringify(
    {
      version: 1,
      hooks: {
        preToolUse: [
          {
            type: "command",
            bash: bashCmd,
            powershell: psCmd,
          },
        ],
      },
    },
    null,
    2,
  )}\n`;

  try {
    mkdirSync(hookDir, { recursive: true });
    writeFileSync(probeHookPath, probeContent, "utf8");
  } catch (err) {
    return {
      status: "inconclusive",
      message: `failed to write probe hook: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const version = getCopilotVersion();
  let result: HookProbeResult;
  try {
    const spawn = spawnSync(
      "copilot --prompt \"Run 'echo probe' once and exit\" --allow-all-tools",
      {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf8",
        shell: true,
        timeout: 30_000,
      },
    );

    if (spawn.error) {
      result = {
        status: "inconclusive",
        message: `copilot spawn error: ${spawn.error.message}`,
      };
    } else if (typeof spawn.status === "number" && spawn.status !== 0) {
      const stderr = (spawn.stderr || "").trim().slice(0, 200);
      result = {
        status: "inconclusive",
        message: `copilot exited with code ${spawn.status}: ${stderr || "no stderr"}`,
      };
    } else if (existsSync(markerPath)) {
      result = {
        status: "pass",
        message: "Hook wiring is functional. PreToolUse hooks fire as expected.",
      };
    } else {
      result = {
        status: "fail",
        message: `Hook wiring is NOT functional in Copilot CLI ${version}. This is expected on v1.0.40 (per M2a spike). When wiring lands in a future version, this probe will pass.`,
      };
    }
  } finally {
    safeUnlink(probeHookPath);
    safeUnlink(markerPath);
  }
  return result;
}

export function runDoctorChecks(): DoctorResult {
  const home = copilotHome();
  const checks: DoctorCheck[] = [
    checkCopilotCli(),
    checkNodeVersion(),
    checkAuth(home),
    checkSettings(home),
    checkAgents(home),
    checkProjectStateWritable(),
  ];

  const summary: DoctorSummary = { passed: 0, warnings: 0, failed: 0 };
  for (const c of checks) {
    if (c.status === "ok") summary.passed += 1;
    else if (c.status === "warn") summary.warnings += 1;
    else summary.failed += 1;
  }

  return { checks, summary };
}

function statusTag(status: CheckStatus, severity?: CheckSeverity): string {
  if (status === "ok") return "[OK]";
  if (status === "warn") return "[WARN]";
  return severity ? `[FAIL:${severity.toUpperCase()}]` : "[FAIL]";
}

function probeStatusTag(status: HookProbeStatus): string {
  if (status === "pass") return "[PASS]";
  if (status === "fail") return "[FAIL]";
  return "[INCONCLUSIVE]";
}

function formatHuman(result: DoctorResult): string {
  const lines: string[] = [];
  lines.push("omghc doctor");
  lines.push("============");
  lines.push("");
  for (const c of result.checks) {
    const tag = statusTag(c.status, c.severity);
    lines.push(`  ${tag} ${c.name}: ${c.message}`);
    if (c.advice && c.status !== "ok") {
      lines.push(`         advice: ${c.advice}`);
    }
  }
  if (result.hookWiringProbe) {
    const probe = result.hookWiringProbe;
    lines.push(
      `  ${probeStatusTag(probe.status)} Hook wiring probe: ${probe.message}`,
    );
  }
  lines.push("");
  const { passed, warnings, failed } = result.summary;
  lines.push(`Results: ${passed} passed, ${warnings} warnings, ${failed} failed`);
  lines.push("");
  return lines.join("\n");
}

export async function runDoctor(args: string[]): Promise<number> {
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  const json = args.includes("--json");
  const probeHooks = args.includes("--probe-hooks");

  const result = runDoctorChecks();

  if (probeHooks) {
    result.hookWiringProbe = probeHookWiring();
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatHuman(result));
  }

  return result.summary.failed > 0 ? 1 : 0;
}
