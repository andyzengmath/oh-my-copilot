/**
 * `omghc update` — check npm for a newer OMGHC version, optionally install
 * it, and then re-run `omghc setup --force --merge-agents` to refresh
 * installed assets.
 *
 * Network failures are non-fatal: when `npm view` is unreachable we report
 * it but still allow `--force` to refresh setup.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runSetup } from "./setup.js";

interface UpdateOptions {
  checkOnly: boolean;
  force: boolean;
  help: boolean;
}

interface PackageJson {
  name: string;
  version: string;
}

const HELP_TEXT = `omghc update — check npm for a newer version and refresh setup

USAGE:
  omghc update [options]

OPTIONS:
  --check-only   Print current vs latest; do not install or refresh setup.
  --force        Refresh setup even when already on the latest version.
  --help, -h     Show this help.

BEHAVIOR:
  1. Reads the local package.json version.
  2. Calls \`npm view oh-my-ghcopilot version\` to learn the latest published
     version (handles registry config / proxy via npm).
  3. If newer is available, runs \`npm install -g oh-my-ghcopilot@latest\`
     unless --check-only is set.
  4. After a successful install (or with --force), refreshes assets via
     \`omghc setup --force --merge-agents\`.
`;

const PKG_NAME = "oh-my-ghcopilot";

function parseArgs(args: string[]): UpdateOptions {
  const opts: UpdateOptions = {
    checkOnly: false,
    force: false,
    help: false,
  };
  for (const arg of args) {
    switch (arg) {
      case "--check-only":
        opts.checkOnly = true;
        break;
      case "--force":
        opts.force = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        break;
    }
  }
  return opts;
}

function readLocalVersion(): string {
  // dist/cli/update.js → ../../package.json
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, "..", "..", "package.json");
  const raw = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(raw) as PackageJson;
  return pkg.version;
}

interface NpmViewResult {
  ok: boolean;
  version: string | null;
  reason?: string;
}

function fetchLatestVersion(): NpmViewResult {
  try {
    const result = spawnSync("npm", ["view", PKG_NAME, "version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    if (result.error) {
      return { ok: false, version: null, reason: result.error.message };
    }
    if (result.status !== 0) {
      const stderr = (result.stderr ?? "").trim();
      return {
        ok: false,
        version: null,
        reason: stderr.length > 0 ? stderr : `npm view exited with status ${result.status}`,
      };
    }
    const version = (result.stdout ?? "").trim();
    if (version.length === 0) {
      return { ok: false, version: null, reason: "npm view returned empty output" };
    }
    return { ok: true, version };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, version: null, reason };
  }
}

/**
 * Returns 1 if `a > b`, -1 if `a < b`, 0 if equal. Compares numeric segments
 * left-to-right. Falls back to lexicographic for non-numeric tails.
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string): Array<number | string> => {
    return v.split(".").map((seg) => {
      const num = Number(seg);
      return Number.isFinite(num) && /^\d+$/.test(seg) ? num : seg;
    });
  };
  const sa = parse(a);
  const sb = parse(b);
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i += 1) {
    const x = sa[i] ?? 0;
    const y = sb[i] ?? 0;
    if (typeof x === "number" && typeof y === "number") {
      if (x > y) return 1;
      if (x < y) return -1;
      continue;
    }
    const xs = String(x);
    const ys = String(y);
    if (xs > ys) return 1;
    if (xs < ys) return -1;
  }
  return 0;
}

function runNpmInstallLatest(): { ok: boolean; reason?: string } {
  const result = spawnSync(
    "npm",
    ["install", "-g", `${PKG_NAME}@latest`],
    {
      encoding: "utf8",
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (result.error) {
    return { ok: false, reason: result.error.message };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      reason: `npm install exited with status ${result.status}`,
    };
  }
  return { ok: true };
}

async function refreshSetup(): Promise<number> {
  process.stdout.write("Refreshing OMGHC setup...\n");
  return runSetup(["--force", "--merge-agents"]);
}

export async function runUpdate(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (opts.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const current = readLocalVersion();
  const view = fetchLatestVersion();

  if (!view.ok) {
    process.stdout.write(
      `Could not reach npm. Skipping version check. (${view.reason ?? "unknown error"})\n`,
    );
    if (opts.checkOnly) {
      process.stdout.write(`Local version: ${current}\n`);
      return 0;
    }
    if (opts.force) {
      return refreshSetup();
    }
    process.stdout.write("Use --force to refresh setup anyway.\n");
    return 0;
  }

  const latest = view.version as string;
  const cmp = compareVersions(latest, current);

  if (cmp <= 0) {
    if (opts.force) {
      process.stdout.write(`oh-my-ghcopilot is up to date (${current}). Forcing refresh.\n`);
      return refreshSetup();
    }
    process.stdout.write(`oh-my-ghcopilot is up to date (${current}).\n`);
    return 0;
  }

  // newer available
  if (opts.checkOnly) {
    process.stdout.write(
      `Update available: ${current} → ${latest}. Run \`omghc update\` to install.\n`,
    );
    return 0;
  }

  process.stdout.write(`Updating oh-my-ghcopilot: ${current} → ${latest}\n`);
  const install = runNpmInstallLatest();
  if (!install.ok) {
    process.stderr.write(
      `Update failed (${install.reason ?? "unknown error"}). Try \`sudo npm install -g ${PKG_NAME}@latest\` (Linux/macOS) or run as Administrator (Windows).\n`,
    );
    return 1;
  }

  return refreshSetup();
}
