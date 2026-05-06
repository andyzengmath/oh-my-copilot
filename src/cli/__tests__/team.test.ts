import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  executeTeamApiOperation,
  isTeamApiOperation,
  runTeam,
  TEAM_API_OPERATIONS,
  TEAM_API_SCHEMA_VERSION,
} from "../../team/api.js";

interface CapturedStream {
  text: string;
  restore: () => void;
}

function captureStdout(): CapturedStream {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (
    chunk: string,
  ): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  };
  return {
    get text() {
      return chunks.join("");
    },
    restore() {
      (process.stdout as unknown as { write: typeof original }).write = original;
    },
  };
}

function captureStderr(): CapturedStream {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (
    chunk: string,
  ): boolean => {
    chunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  };
  return {
    get text() {
      return chunks.join("");
    },
    restore() {
      (process.stderr as unknown as { write: typeof original }).write = original;
    },
  };
}

test("runTeam(['--help']) prints usage and exits 0", async () => {
  const out = captureStdout();
  try {
    const code = await runTeam(["--help"]);
    assert.equal(code, 0);
    assert.match(out.text, /Usage: omghc team/);
    assert.match(out.text, /api/);
  } finally {
    out.restore();
  }
});

test("runTeam() with no arguments prints help and exits 0", async () => {
  const out = captureStdout();
  try {
    const code = await runTeam([]);
    assert.equal(code, 0);
    assert.match(out.text, /Usage: omghc team/);
  } finally {
    out.restore();
  }
});

test("runTeam(['unknown-subcommand']) prints to stderr and returns non-zero", async () => {
  const err = captureStderr();
  try {
    const code = await runTeam(["nonsense"]);
    assert.notEqual(code, 0);
    assert.match(err.text, /unknown subcommand/);
  } finally {
    err.restore();
  }
});

test(
  "runTeam(['api', 'get-summary', ...]) returns ok:false envelope for unknown op",
  async () => {
    const out = captureStdout();
    try {
      const code = await runTeam([
        "api",
        "get-summary",
        "--input",
        '{"team_name":"nonexistent"}',
        "--json",
      ]);
      assert.equal(code, 1);
      const parsed = JSON.parse(out.text.trim()) as {
        schema_version: string;
        operation: string;
        ok: boolean;
        error?: { code: string; message: string };
      };
      assert.equal(parsed.schema_version, TEAM_API_SCHEMA_VERSION);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.operation, "unknown");
      assert.equal(parsed.error?.code, "unknown_operation");
    } finally {
      out.restore();
    }
  },
);

test("runTeam(['api', 'list-tasks']) for empty team returns ok:true with count:0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omghc-team-test-"));
  const out = captureStdout();
  try {
    const code = await runTeam([
      "api",
      "list-tasks",
      "--input",
      JSON.stringify({ team_name: "freshteam", workingDirectory: dir }),
      "--json",
    ]);
    assert.equal(code, 0);
    const parsed = JSON.parse(out.text.trim()) as {
      ok: boolean;
      data?: { count: number; tasks: unknown[] };
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data?.count, 0);
    assert.deepEqual(parsed.data?.tasks, []);
  } finally {
    out.restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isTeamApiOperation correctly identifies known/unknown ops", () => {
  assert.equal(isTeamApiOperation("create-task"), true);
  assert.equal(isTeamApiOperation("list-tasks"), true);
  assert.equal(isTeamApiOperation("get-summary"), false);
  assert.equal(isTeamApiOperation("evil"), false);
});

test("executeTeamApiOperation rejects malformed input with invalid_input code", async () => {
  const envelope = await executeTeamApiOperation("create-task", {
    // missing team_name and subject
    description: "no anchors",
  });
  assert.equal(envelope.ok, false);
  if (!envelope.ok) {
    assert.equal(envelope.error.code, "invalid_input");
  }
});

test("TEAM_API_OPERATIONS array is non-empty and contains create-task", () => {
  assert.ok(TEAM_API_OPERATIONS.length > 0);
  assert.ok((TEAM_API_OPERATIONS as readonly string[]).includes("create-task"));
});
