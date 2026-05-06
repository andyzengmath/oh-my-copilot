import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  type ModeName,
  stateClear,
  stateGetStatus,
  stateListActive,
  stateRead,
  stateWrite,
} from "../state/operations.js";

const SERVER_NAME = "omghc_state";
const SERVER_VERSION = "0.0.1";

const ModeNameSchema = z.enum([
  "autopilot",
  "autoresearch",
  "team",
  "ralph",
  "ultrawork",
  "ultraqa",
  "ralplan",
  "deep-interview",
  "skill-active",
]);

function jsonContent(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload) },
    ],
  };
}

export function buildStateServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.tool(
    "state_read",
    "Read mode state. Returns the parsed state JSON or null if no state exists.",
    {
      mode: ModeNameSchema,
      workingDirectory: z.string().optional(),
    },
    async ({ mode, workingDirectory }) => {
      const data = stateRead(mode as ModeName, { workingDirectory });
      return jsonContent({ ok: true, data });
    },
  );

  server.tool(
    "state_write",
    "Write or merge mode state. Creates the state file if missing; updates _meta timestamps.",
    {
      mode: ModeNameSchema,
      active: z.boolean().optional(),
      current_phase: z.string().optional(),
      iteration: z.number().optional(),
      max_iterations: z.number().optional(),
      started_at: z.string().optional(),
      completed_at: z.string().optional(),
      error: z.string().optional(),
      task_description: z.string().optional(),
      plan_path: z.string().optional(),
      state: z.record(z.string(), z.string()).optional(),
      workingDirectory: z.string().optional(),
    },
    async ({ mode, workingDirectory, ...partial }) => {
      const data = stateWrite(mode as ModeName, partial, { workingDirectory });
      return jsonContent({ ok: true, data });
    },
  );

  server.tool(
    "state_clear",
    "Clear mode state (delete the state file). Idempotent.",
    {
      mode: ModeNameSchema,
      workingDirectory: z.string().optional(),
    },
    async ({ mode, workingDirectory }) => {
      stateClear(mode as ModeName, { workingDirectory });
      return jsonContent({ ok: true });
    },
  );

  server.tool(
    "state_list_active",
    "List all modes whose state has active=true.",
    {
      workingDirectory: z.string().optional(),
    },
    async ({ workingDirectory }) => {
      const data = stateListActive({ workingDirectory });
      return jsonContent({ ok: true, data });
    },
  );

  server.tool(
    "state_get_status",
    "Get a quick status snapshot { active, current_phase?, iteration? } for one mode.",
    {
      mode: ModeNameSchema,
      workingDirectory: z.string().optional(),
    },
    async ({ mode, workingDirectory }) => {
      const data = stateGetStatus(mode as ModeName, { workingDirectory });
      return jsonContent({ ok: true, data });
    },
  );

  return server;
}

export async function startStateServer(): Promise<void> {
  const server = buildStateServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const entry = process.argv[1];
const isMain =
  typeof entry === "string" &&
  (import.meta.url === `file://${entry.replaceAll("\\", "/")}` ||
    entry.endsWith("state-server.js"));

if (isMain) {
  startStateServer().catch((err) => {
    process.stderr.write(`${SERVER_NAME} server error: ${(err as Error).message ?? err}\n`);
    process.exit(1);
  });
}
