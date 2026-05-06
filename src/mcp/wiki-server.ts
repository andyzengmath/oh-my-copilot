/**
 * OMGHC Wiki MCP Server (stdio).
 *
 * Exposes 6 tools backed by `src/wiki/operations.ts`:
 *   wiki_list, wiki_read, wiki_write, wiki_search, wiki_lint, wiki_refresh
 *
 * Storage: `<workingDirectory>/.omghc/wiki/<slug>.md` with YAML frontmatter
 * (title, slug, tags, updated_at). Search is grep-based (no embeddings).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  wikiLint,
  wikiList,
  wikiRead,
  wikiRefresh,
  wikiSearch,
  wikiWrite,
} from "../wiki/operations.js";

const SERVER_NAME = "omghc_wiki";
const SERVER_VERSION = "0.1.0";

type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string };

function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

function err(error: string): ToolResult<never> {
  return { ok: false, error };
}

function asTextContent(result: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(result, null, 2) },
    ],
  };
}

export function buildWikiServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    "wiki_list",
    {
      description: "List all wiki pages under .omghc/wiki/ with their metadata.",
      inputSchema: {
        workingDirectory: z.string().optional(),
      },
    },
    async ({ workingDirectory }) => {
      try {
        const data = wikiList({ workingDirectory });
        return asTextContent(ok(data));
      } catch (error) {
        return asTextContent(err((error as Error).message));
      }
    },
  );

  server.registerTool(
    "wiki_read",
    {
      description: "Read a wiki page by slug.",
      inputSchema: {
        slug: z.string(),
        workingDirectory: z.string().optional(),
      },
    },
    async ({ slug, workingDirectory }) => {
      try {
        const page = wikiRead(slug, { workingDirectory });
        if (!page) return asTextContent(err("not found"));
        return asTextContent(ok(page));
      } catch (error) {
        return asTextContent(err((error as Error).message));
      }
    },
  );

  server.registerTool(
    "wiki_write",
    {
      description: "Create or update a wiki page. Slug must match [a-z0-9-]+.",
      inputSchema: {
        slug: z.string(),
        title: z.string(),
        body: z.string(),
        tags: z.array(z.string()).optional(),
        workingDirectory: z.string().optional(),
      },
    },
    async ({ slug, title, body, tags, workingDirectory }) => {
      try {
        const data = wikiWrite({ slug, title, body, tags, workingDirectory });
        return asTextContent(ok(data));
      } catch (error) {
        return asTextContent(err((error as Error).message));
      }
    },
  );

  server.registerTool(
    "wiki_search",
    {
      description: "Grep-based search across wiki pages. Case-insensitive.",
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().optional(),
        workingDirectory: z.string().optional(),
      },
    },
    async ({ query, limit, workingDirectory }) => {
      try {
        const data = wikiSearch({ query, limit, workingDirectory });
        return asTextContent(ok(data));
      } catch (error) {
        return asTextContent(err((error as Error).message));
      }
    },
  );

  server.registerTool(
    "wiki_lint",
    {
      description: "Validate wiki pages for required frontmatter fields.",
      inputSchema: {
        workingDirectory: z.string().optional(),
      },
    },
    async ({ workingDirectory }) => {
      try {
        const data = wikiLint({ workingDirectory });
        return asTextContent(ok(data));
      } catch (error) {
        return asTextContent(err((error as Error).message));
      }
    },
  );

  server.registerTool(
    "wiki_refresh",
    {
      description: "Walk the wiki directory and report total page count.",
      inputSchema: {
        workingDirectory: z.string().optional(),
      },
    },
    async ({ workingDirectory }) => {
      try {
        const data = wikiRefresh({ workingDirectory });
        return asTextContent(ok(data));
      } catch (error) {
        return asTextContent(err((error as Error).message));
      }
    },
  );

  return server;
}

export async function startWikiServer(): Promise<void> {
  const server = buildWikiServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain = (() => {
  if (typeof process === "undefined" || !process.argv[1]) return false;
  try {
    const entry = new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
    return import.meta.url === entry;
  } catch {
    return false;
  }
})();

if (isMain) {
  startWikiServer().catch((error) => {
    console.error("[omghc_wiki] failed to start:", error);
    process.exit(1);
  });
}
