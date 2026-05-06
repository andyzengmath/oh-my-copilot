import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetup } from "../setup.js";

const ENV_KEYS = ["COPILOT_HOME"] as const;

interface TestEnv {
  copilotHome: string;
  projectRoot: string;
  origCwd: string;
}

function setupTmpProject(t: TestContext): TestEnv {
  const copilotHome = mkdtempSync(join(tmpdir(), "omghc-hook-home-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "omghc-hook-proj-"));
  const origEnv: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    origEnv[k] = process.env[k];
  }
  process.env.COPILOT_HOME = copilotHome;
  // Make projectRoot a git repo so findGitProjectRoot() picks it up.
  const gitInit = spawnSync("git", ["init", "-q"], {
    cwd: projectRoot,
    stdio: "pipe",
  });
  assert.equal(
    gitInit.status,
    0,
    `git init failed in tmp project: ${gitInit.stderr?.toString() ?? ""}`,
  );
  const origCwd = process.cwd();
  process.chdir(projectRoot);
  t.after(() => {
    process.chdir(origCwd);
    for (const k of ENV_KEYS) {
      const v = origEnv[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(copilotHome, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });
  return { copilotHome, projectRoot, origCwd };
}

function silenceStdio(t: TestContext): void {
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  t.after(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  });
}

test(
  "setup writes .github/hooks/oh-my-ghcopilot.json with valid JSON containing all 6 events",
  { concurrency: false },
  async (t) => {
    const env = setupTmpProject(t);
    silenceStdio(t);
    const code = await runSetup(["--scope=user", "--plugin"]);
    assert.equal(code, 0);

    const hookPath = join(
      env.projectRoot,
      ".github",
      "hooks",
      "oh-my-ghcopilot.json",
    );
    assert.ok(existsSync(hookPath), `${hookPath} should exist`);
    const raw = readFileSync(hookPath, "utf8");
    let parsed: unknown;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(raw);
    }, "hook file must be valid JSON");
    const obj = parsed as Record<string, unknown>;
    assert.equal(obj.version, 1, "hook file version must be 1");
    const hooks = obj.hooks as Record<string, unknown>;
    assert.ok(hooks && typeof hooks === "object", "hooks key must be an object");
    const expectedEvents = [
      "sessionStart",
      "sessionEnd",
      "userPromptSubmitted",
      "preToolUse",
      "postToolUse",
      "errorOccurred",
    ];
    for (const event of expectedEvents) {
      assert.ok(
        Array.isArray(hooks[event]),
        `hook event '${event}' must be an array`,
      );
      const entries = hooks[event] as unknown[];
      assert.ok(
        entries.length >= 1,
        `hook event '${event}' must have >=1 entry`,
      );
    }
  },
);

test(
  "each hook entry has BOTH bash and powershell fields",
  { concurrency: false },
  async (t) => {
    const env = setupTmpProject(t);
    silenceStdio(t);
    const code = await runSetup(["--scope=user", "--plugin"]);
    assert.equal(code, 0);

    const hookPath = join(
      env.projectRoot,
      ".github",
      "hooks",
      "oh-my-ghcopilot.json",
    );
    const obj = JSON.parse(readFileSync(hookPath, "utf8")) as {
      hooks: Record<string, Array<Record<string, unknown>>>;
    };
    for (const [event, entries] of Object.entries(obj.hooks)) {
      for (const entry of entries) {
        assert.equal(
          entry.type,
          "command",
          `${event} entry.type must be 'command'`,
        );
        assert.equal(
          typeof entry.bash,
          "string",
          `${event} entry must have a string 'bash' field`,
        );
        assert.equal(
          typeof entry.powershell,
          "string",
          `${event} entry must have a string 'powershell' field`,
        );
        assert.ok(
          (entry.bash as string).length > 0,
          `${event} entry.bash must be non-empty`,
        );
        assert.ok(
          (entry.powershell as string).length > 0,
          `${event} entry.powershell must be non-empty`,
        );
      }
    }
  },
);

test(
  "--no-hooks flag skips the hook write",
  { concurrency: false },
  async (t) => {
    const env = setupTmpProject(t);
    silenceStdio(t);
    const code = await runSetup(["--scope=user", "--plugin", "--no-hooks"]);
    assert.equal(code, 0);

    const hookPath = join(
      env.projectRoot,
      ".github",
      "hooks",
      "oh-my-ghcopilot.json",
    );
    assert.equal(
      existsSync(hookPath),
      false,
      "hook file must not be created when --no-hooks is passed",
    );
  },
);
