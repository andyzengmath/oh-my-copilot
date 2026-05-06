import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetupFinalizeMcp } from "../setup-finalize-mcp.js";

const ORIGINAL_COPILOT_HOME = process.env.COPILOT_HOME;

function setupTmp(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "omghc-finalize-mcp-test-"));
  process.env.COPILOT_HOME = dir;
  t.after(() => {
    if (ORIGINAL_COPILOT_HOME === undefined) {
      delete process.env.COPILOT_HOME;
    } else {
      process.env.COPILOT_HOME = ORIGINAL_COPILOT_HOME;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

async function captureStdout<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; stdout: string }> {
  const chunks: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    const result = await fn();
    return { result, stdout: chunks.join("") };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

test(
  "--dry-run prints valid JSON without writing the file",
  { concurrency: false },
  async (t) => {
    const dir = setupTmp(t);
    const mcpPath = join(dir, "mcp-config.json");
    const { result, stdout } = await captureStdout(() =>
      runSetupFinalizeMcp(["--dry-run"]),
    );
    assert.equal(result, 0);
    assert.equal(
      existsSync(mcpPath),
      false,
      "dry-run must not write mcp-config.json",
    );
    // The first part of stdout is JSON; trailing line is "[dry-run] Would write to: ...".
    const jsonEnd = stdout.lastIndexOf("\n}");
    assert.ok(jsonEnd > 0, "stdout must contain a JSON object body");
    const jsonPart = stdout.slice(0, jsonEnd + 2);
    const parsed = JSON.parse(jsonPart) as {
      mcpServers?: Record<string, unknown>;
    };
    assert.ok(
      parsed.mcpServers && Object.keys(parsed.mcpServers).length >= 1,
      "dry-run JSON must contain mcpServers entries",
    );
  },
);

test(
  "real run merges OMGHC servers into existing mcp-config.json preserving user entries",
  { concurrency: false },
  async (t) => {
    const dir = setupTmp(t);
    const mcpPath = join(dir, "mcp-config.json");
    const userConfig = {
      mcpServers: {
        "user-private": {
          type: "stdio",
          command: "user-cmd",
          args: ["--user-flag"],
        },
      },
      preferences: { theme: "dark" },
    };
    writeFileSync(mcpPath, JSON.stringify(userConfig, null, 2), "utf8");

    const { result } = await captureStdout(() =>
      runSetupFinalizeMcp([]),
    );
    assert.equal(result, 0);

    const merged = JSON.parse(readFileSync(mcpPath, "utf8")) as {
      mcpServers: Record<string, unknown>;
      preferences?: { theme?: string };
    };
    assert.ok(
      merged.mcpServers["user-private"],
      "user-authored MCP server must survive",
    );
    assert.equal(
      merged.preferences?.theme,
      "dark",
      "user top-level fields must survive",
    );
    const omghcKeys = Object.keys(merged.mcpServers).filter((k) =>
      k.startsWith("omghc_"),
    );
    assert.ok(
      omghcKeys.length >= 1,
      "at least one omghc_* MCP server must be registered",
    );
  },
);

test(
  "re-running is idempotent (no change to existing OMGHC entries)",
  { concurrency: false },
  async (t) => {
    const dir = setupTmp(t);
    const mcpPath = join(dir, "mcp-config.json");

    const { result: first } = await captureStdout(() =>
      runSetupFinalizeMcp([]),
    );
    assert.equal(first, 0);
    const afterFirst = readFileSync(mcpPath, "utf8");

    const { result: second } = await captureStdout(() =>
      runSetupFinalizeMcp([]),
    );
    assert.equal(second, 0);
    const afterSecond = readFileSync(mcpPath, "utf8");

    assert.equal(
      afterSecond,
      afterFirst,
      "second run must not change file contents (idempotency)",
    );
  },
);
