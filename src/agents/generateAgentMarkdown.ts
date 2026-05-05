/**
 * Generate Copilot-format agent markdown files.
 *
 * Produces a Markdown document with YAML frontmatter delimited by `---` lines.
 * The `name` is encoded in the filename, not the frontmatter (Copilot derives
 * agent name from the file basename).
 *
 * No I/O — caller is responsible for writing to disk.
 */

export interface AgentSpec {
  name: string;
  description: string;
  model?: string;
  system?: string;
  tools?: string[];
  skills?: string[];
  xOmghc?: Record<string, unknown>;
  body: string;
}

export interface AgentMarkdownResult {
  fileName: string;
  content: string;
}

const FRONTMATTER_DELIM = "---";

function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function quoteScalar(value: string): string {
  if (value.includes("\n")) {
    return literalBlock(value, 0);
  }
  if (value.includes('"')) {
    const escaped = value.replace(/'/g, "''");
    return `'${escaped}'`;
  }
  return `"${value}"`;
}

function literalBlock(value: string, indent: number): string {
  const pad = " ".repeat(indent + 2);
  const lines = value.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const indented = lines.map((line) => (line.length === 0 ? "" : `${pad}${line}`));
  return `|\n${indented.join("\n")}`;
}

function renderArray(key: string, items: string[]): string {
  if (items.length === 0) {
    return `${key}: []`;
  }
  const entries = items.map((item) => `  - ${item}`);
  return `${key}:\n${entries.join("\n")}`;
}

function renderXOmghc(map: Record<string, unknown>): string {
  const lines: string[] = ["x-omghc:"];
  for (const [key, value] of Object.entries(map)) {
    lines.push(`  ${key}: ${renderXOmghcValue(value)}`);
  }
  return lines.join("\n");
}

function renderXOmghcValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return quoteScalar(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value.map((v) => `\n    - ${renderXOmghcValue(v)}`).join("");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries
      .map(([k, v]) => `\n    ${k}: ${renderXOmghcValue(v)}`)
      .join("");
  }
  return quoteScalar(String(value));
}

export function generateAgentMarkdown(spec: AgentSpec): AgentMarkdownResult {
  const fileName = sanitizeFileName(spec.name);
  const lines: string[] = [FRONTMATTER_DELIM];

  lines.push(`description: ${quoteScalar(spec.description)}`);

  if (spec.model !== undefined) {
    lines.push(`model: ${quoteScalar(spec.model)}`);
  }

  if (spec.system !== undefined) {
    lines.push(`system: ${quoteScalar(spec.system)}`);
  }

  if (spec.tools !== undefined) {
    lines.push(renderArray("tools", spec.tools));
  }

  if (spec.skills !== undefined) {
    lines.push(renderArray("skills", spec.skills));
  }

  if (spec.xOmghc !== undefined && Object.keys(spec.xOmghc).length > 0) {
    lines.push(renderXOmghc(spec.xOmghc));
  }

  lines.push(FRONTMATTER_DELIM);
  lines.push("");
  lines.push(spec.body);

  let content = lines.join("\n");
  if (!content.endsWith("\n")) {
    content += "\n";
  }

  return { fileName, content };
}
