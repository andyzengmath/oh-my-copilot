/**
 * Wiki operations: underlying functions for the OMGHC markdown wiki at .omghc/wiki/.
 *
 * Pure data ops with no MCP coupling so the CLI (`omghc wiki ...`) can import the same
 * functions for parity with the MCP server.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const WIKI_DIR_NAME = ".omghc";
const WIKI_SUBDIR = "wiki";
const SLUG_PATTERN = /^[a-z0-9-]+$/;

export interface WikiPageMeta {
  slug: string;
  title: string;
  tags: string[];
  updated_at: string;
}

export interface WikiPage extends WikiPageMeta {
  body: string;
}

export interface WikiSearchHit {
  slug: string;
  title: string;
  snippet: string;
}

export interface WikiLintIssue {
  slug: string;
  problem: string;
}

export interface BaseOpts {
  workingDirectory?: string;
}

export interface WikiSearchOpts extends BaseOpts {
  query: string;
  limit?: number;
}

export interface WikiWriteInput extends BaseOpts {
  slug: string;
  title: string;
  body: string;
  tags?: string[];
}

function resolveRoot(workingDirectory?: string): string {
  const raw = typeof workingDirectory === "string" ? workingDirectory.trim() : "";
  return raw.length > 0 ? raw : process.cwd();
}

function getWikiDir(workingDirectory?: string): string {
  return join(resolveRoot(workingDirectory), WIKI_DIR_NAME, WIKI_SUBDIR);
}

function ensureWikiDir(workingDirectory?: string): string {
  const dir = getWikiDir(workingDirectory);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === "string" && SLUG_PATTERN.test(slug);
}

function safeWikiPath(wikiDir: string, slug: string): string | null {
  if (!isValidSlug(slug)) return null;
  const filePath = join(wikiDir, `${slug}.md`);
  const resolved = resolve(filePath);
  const wikiResolved = resolve(wikiDir);
  if (!resolved.startsWith(wikiResolved)) return null;
  return filePath;
}

interface ParsedFile {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFile(raw: string): ParsedFile {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: raw };
  const body = raw.slice(match[0].length);
  const fm = parseMinimalYaml(match[1] ?? "");
  return { frontmatter: fm, body };
}

function parseMinimalYaml(text: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.length === 0 || /^\s*#/.test(line)) continue;
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1] as string;
    const rest = (kv[2] ?? "").trim();
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      result[key] = inner.length === 0
        ? []
        : inner.split(",").map((s) => unquote(s.trim()));
    } else {
      result[key] = unquote(rest);
    }
  }
  return result;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function serializePage(page: WikiPage): string {
  const tagsYaml = page.tags.map((t) => `"${escapeYaml(t)}"`).join(", ");
  const frontmatter = [
    "---",
    `title: "${escapeYaml(page.title)}"`,
    `slug: ${page.slug}`,
    `tags: [${tagsYaml}]`,
    `updated_at: ${page.updated_at}`,
    "---",
    "",
  ].join("\n");
  const body = page.body.endsWith("\n") ? page.body : `${page.body}\n`;
  return `${frontmatter}${body}`;
}

function readMeta(parsed: ParsedFile, fallbackSlug: string): WikiPageMeta {
  const fm = parsed.frontmatter;
  const slugRaw = typeof fm.slug === "string" ? fm.slug : fallbackSlug;
  const slug = isValidSlug(slugRaw) ? slugRaw : fallbackSlug;
  const title = typeof fm.title === "string" && fm.title.length > 0 ? fm.title : slug;
  const tagsRaw = fm.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is string => typeof t === "string")
    : [];
  const updated_at = typeof fm.updated_at === "string" && fm.updated_at.length > 0
    ? fm.updated_at
    : "";
  return { slug, title, tags, updated_at };
}

export function wikiList(opts: BaseOpts = {}): WikiPageMeta[] {
  const dir = getWikiDir(opts.workingDirectory);
  if (!existsSync(dir)) return [];
  const entries: WikiPageMeta[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const slug = file.slice(0, -3);
    if (!isValidSlug(slug)) continue;
    try {
      const raw = readFileSync(join(dir, file), "utf-8");
      const parsed = parseFile(raw);
      entries.push(readMeta(parsed, slug));
    } catch {
      continue;
    }
  }
  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  return entries;
}

export function wikiRead(slug: string, opts: BaseOpts = {}): WikiPage | null {
  if (!isValidSlug(slug)) return null;
  const dir = getWikiDir(opts.workingDirectory);
  const filePath = safeWikiPath(dir, slug);
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = parseFile(raw);
    const meta = readMeta(parsed, slug);
    return { ...meta, body: parsed.body };
  } catch {
    return null;
  }
}

export function wikiWrite(input: WikiWriteInput): { slug: string; path: string } {
  if (!isValidSlug(input.slug)) {
    throw new Error(`invalid slug: must match ${SLUG_PATTERN.source}`);
  }
  if (typeof input.title !== "string" || input.title.length === 0) {
    throw new Error("title is required");
  }
  const dir = ensureWikiDir(input.workingDirectory);
  const filePath = safeWikiPath(dir, input.slug);
  if (!filePath) throw new Error("invalid slug");

  const page: WikiPage = {
    slug: input.slug,
    title: input.title,
    tags: Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === "string") : [],
    updated_at: new Date().toISOString(),
    body: typeof input.body === "string" ? input.body : "",
  };
  writeFileSync(filePath, serializePage(page), "utf-8");
  return { slug: input.slug, path: filePath };
}

export function wikiSearch(opts: WikiSearchOpts): WikiSearchHit[] {
  const query = (opts.query ?? "").toLowerCase();
  if (query.length === 0) return [];
  const limit = typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : 20;

  const dir = getWikiDir(opts.workingDirectory);
  if (!existsSync(dir)) return [];

  const hits: WikiSearchHit[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const slug = file.slice(0, -3);
    if (!isValidSlug(slug)) continue;
    try {
      const raw = readFileSync(join(dir, file), "utf-8");
      const parsed = parseFile(raw);
      const meta = readMeta(parsed, slug);

      const haystack = `${meta.title}\n${parsed.body}`.toLowerCase();
      const idx = haystack.indexOf(query);
      if (idx === -1) continue;

      const sourceText = `${meta.title}\n${parsed.body}`;
      const start = Math.max(0, idx - 30);
      const end = Math.min(sourceText.length, idx + query.length + 70);
      const raw2 = sourceText.slice(start, end).replace(/\s+/g, " ").trim();
      const snippet = (start > 0 ? "..." : "") + raw2 + (end < sourceText.length ? "..." : "");
      const truncated = snippet.length > 100 ? `${snippet.slice(0, 97)}...` : snippet;
      hits.push({ slug: meta.slug, title: meta.title, snippet: truncated });
      if (hits.length >= limit) break;
    } catch {
      continue;
    }
  }
  return hits;
}

export function wikiLint(opts: BaseOpts = {}): { issues: WikiLintIssue[] } {
  const dir = getWikiDir(opts.workingDirectory);
  if (!existsSync(dir)) return { issues: [] };
  const issues: WikiLintIssue[] = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const slug = file.slice(0, -3);
    if (!isValidSlug(slug)) {
      issues.push({ slug: file, problem: "filename has invalid slug (must match [a-z0-9-]+)" });
      continue;
    }
    let raw: string;
    try {
      raw = readFileSync(join(dir, file), "utf-8");
    } catch (error) {
      issues.push({ slug, problem: `cannot read file: ${(error as Error).message}` });
      continue;
    }
    const parsed = parseFile(raw);
    const fm = parsed.frontmatter;
    if (!fm.title) issues.push({ slug, problem: "missing required frontmatter field: title" });
    if (typeof fm.slug === "string" && fm.slug !== slug) {
      issues.push({ slug, problem: `frontmatter slug "${fm.slug}" does not match filename "${slug}"` });
    }
    if (!fm.updated_at) {
      issues.push({ slug, problem: "missing required frontmatter field: updated_at" });
    }
  }
  return { issues };
}

export function wikiRefresh(opts: BaseOpts = {}): { pages: number } {
  const dir = getWikiDir(opts.workingDirectory);
  if (!existsSync(dir)) return { pages: 0 };
  let count = 0;
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".md") && isValidSlug(file.slice(0, -3))) count += 1;
  }
  return { pages: count };
}
