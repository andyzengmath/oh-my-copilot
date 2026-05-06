/**
 * OMGHC Memory MCP Server
 * Provides persistent project memory and notepad tools for Copilot CLI sessions.
 *
 * Storage layout:
 *   <wd>/.omghc/memory/notepad/{priority,working,manual}.md
 *   <wd>/.omghc/memory/project-memory.json  -> { directives: [], notes: [] }
 *
 * Server name: omghc_memory.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";

export type NotepadPriority = "priority" | "working" | "manual";

const NOTEPAD_PRIORITIES: readonly NotepadPriority[] = [
	"priority",
	"working",
	"manual",
] as const;

const ENTRY_TIMESTAMP_PATTERN = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]/;

export interface MemoryOptions {
	workingDirectory?: string;
}

export interface NotepadWriteOptions extends MemoryOptions {
	content: string;
}

export interface NotepadPruneOptions extends MemoryOptions {
	days: number;
}

export interface ProjectMemoryEntry {
	text: string;
	timestamp: string;
}

export interface ProjectMemoryData {
	directives: ProjectMemoryEntry[];
	notes: ProjectMemoryEntry[];
}

export interface NotepadContent {
	priority: string;
	working: string;
	manual: string;
}

export interface NotepadStats {
	priority: { words: number; lines: number };
	working: { words: number; lines: number };
	manual: { words: number; lines: number };
}

interface OkResult<T = undefined> {
	ok: true;
	data?: T;
}

interface ErrResult {
	ok: false;
	error: string;
}

type Result<T = undefined> = OkResult<T> | ErrResult;

function resolveWorkingDirectory(wd?: string): string {
	if (typeof wd === "string" && wd.trim() !== "") {
		return resolvePath(wd);
	}
	return process.cwd();
}

function memoryDir(wd: string): string {
	return join(wd, ".omghc", "memory");
}

function notepadDir(wd: string): string {
	return join(memoryDir(wd), "notepad");
}

function notepadFile(wd: string, priority: NotepadPriority): string {
	return join(notepadDir(wd), `${priority}.md`);
}

function projectMemoryFile(wd: string): string {
	return join(memoryDir(wd), "project-memory.json");
}

async function ensureNotepadDir(wd: string): Promise<void> {
	await mkdir(notepadDir(wd), { recursive: true });
}

async function ensureMemoryDir(wd: string): Promise<void> {
	await mkdir(memoryDir(wd), { recursive: true });
}

async function readNotepadFile(
	wd: string,
	priority: NotepadPriority,
): Promise<string> {
	const path = notepadFile(wd, priority);
	if (!existsSync(path)) return "";
	return await readFile(path, "utf-8");
}

function countWordsAndLines(text: string): { words: number; lines: number } {
	if (!text) return { words: 0, lines: 0 };
	const words = text.split(/\s+/).filter((token) => token.length > 0).length;
	const lines = text.split(/\r?\n/).filter((line) => line.length > 0).length;
	return { words, lines };
}

// ── Underlying functions (exported for CLI parity) ──────────────────────────

export async function notepadRead(
	options: MemoryOptions = {},
): Promise<Result<NotepadContent>> {
	const wd = resolveWorkingDirectory(options.workingDirectory);
	const [priority, working, manual] = await Promise.all([
		readNotepadFile(wd, "priority"),
		readNotepadFile(wd, "working"),
		readNotepadFile(wd, "manual"),
	]);
	return { ok: true, data: { priority, working, manual } };
}

async function notepadAppend(
	priority: NotepadPriority,
	options: NotepadWriteOptions,
): Promise<Result> {
	if (typeof options.content !== "string" || options.content.length === 0) {
		return { ok: false, error: "content must be a non-empty string" };
	}
	const wd = resolveWorkingDirectory(options.workingDirectory);
	await ensureNotepadDir(wd);
	const path = notepadFile(wd, priority);
	const existing = await readNotepadFile(wd, priority);
	const stamped = `[${new Date().toISOString()}] ${options.content}`;
	const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
	const next = `${existing}${separator}${stamped}\n`;
	await writeFile(path, next, "utf-8");
	return { ok: true };
}

export function notepadWritePriority(
	options: NotepadWriteOptions,
): Promise<Result> {
	return notepadAppend("priority", options);
}

export function notepadWriteWorking(
	options: NotepadWriteOptions,
): Promise<Result> {
	return notepadAppend("working", options);
}

export function notepadWriteManual(
	options: NotepadWriteOptions,
): Promise<Result> {
	return notepadAppend("manual", options);
}

export async function notepadStats(
	options: MemoryOptions = {},
): Promise<Result<NotepadStats>> {
	const wd = resolveWorkingDirectory(options.workingDirectory);
	const [priority, working, manual] = await Promise.all([
		readNotepadFile(wd, "priority"),
		readNotepadFile(wd, "working"),
		readNotepadFile(wd, "manual"),
	]);
	return {
		ok: true,
		data: {
			priority: countWordsAndLines(priority),
			working: countWordsAndLines(working),
			manual: countWordsAndLines(manual),
		},
	};
}

export async function notepadPrune(
	options: NotepadPruneOptions,
): Promise<Result<{ removed: number }>> {
	if (
		typeof options.days !== "number" ||
		!Number.isFinite(options.days) ||
		options.days < 0
	) {
		return { ok: false, error: "days must be a non-negative number" };
	}
	const wd = resolveWorkingDirectory(options.workingDirectory);
	const cutoffMs = Date.now() - options.days * 86_400_000;
	let removed = 0;
	for (const priority of NOTEPAD_PRIORITIES) {
		const path = notepadFile(wd, priority);
		if (!existsSync(path)) continue;
		const original = await readFile(path, "utf-8");
		const kept: string[] = [];
		for (const line of original.split(/\r?\n/)) {
			const match = line.match(ENTRY_TIMESTAMP_PATTERN);
			if (match) {
				const entryTime = Date.parse(match[1]);
				if (Number.isFinite(entryTime) && entryTime < cutoffMs) {
					removed += 1;
					continue;
				}
			}
			kept.push(line);
		}
		const next = kept.join("\n").replace(/\n+$/, "");
		await writeFile(path, next.length === 0 ? "" : `${next}\n`, "utf-8");
	}
	return { ok: true, data: { removed } };
}

function defaultProjectMemory(): ProjectMemoryData {
	return { directives: [], notes: [] };
}

function isProjectMemoryShape(value: unknown): value is ProjectMemoryData {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return Array.isArray(candidate.directives) && Array.isArray(candidate.notes);
}

async function readProjectMemoryFile(wd: string): Promise<ProjectMemoryData> {
	const path = projectMemoryFile(wd);
	if (!existsSync(path)) return defaultProjectMemory();
	try {
		const raw = await readFile(path, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (isProjectMemoryShape(parsed)) {
			return parsed;
		}
		return defaultProjectMemory();
	} catch {
		return defaultProjectMemory();
	}
}

async function writeProjectMemoryFile(
	wd: string,
	data: ProjectMemoryData,
): Promise<void> {
	await ensureMemoryDir(wd);
	await writeFile(
		projectMemoryFile(wd),
		`${JSON.stringify(data, null, 2)}\n`,
		"utf-8",
	);
}

export async function projectMemoryRead(
	options: MemoryOptions = {},
): Promise<Result<ProjectMemoryData>> {
	const wd = resolveWorkingDirectory(options.workingDirectory);
	const data = await readProjectMemoryFile(wd);
	return { ok: true, data };
}

export async function projectMemoryWrite(
	options: MemoryOptions & { data: unknown },
): Promise<Result> {
	if (typeof options.data !== "object" || options.data === null) {
		return { ok: false, error: "data must be an object" };
	}
	const candidate = options.data as Record<string, unknown>;
	const directives = Array.isArray(candidate.directives)
		? (candidate.directives as ProjectMemoryEntry[])
		: [];
	const notes = Array.isArray(candidate.notes)
		? (candidate.notes as ProjectMemoryEntry[])
		: [];
	const wd = resolveWorkingDirectory(options.workingDirectory);
	await writeProjectMemoryFile(wd, { directives, notes });
	return { ok: true };
}

export async function projectMemoryAddDirective(
	options: MemoryOptions & { directive: string },
): Promise<Result> {
	if (typeof options.directive !== "string" || options.directive.trim() === "") {
		return { ok: false, error: "directive must be a non-empty string" };
	}
	const wd = resolveWorkingDirectory(options.workingDirectory);
	const data = await readProjectMemoryFile(wd);
	data.directives.push({
		text: options.directive,
		timestamp: new Date().toISOString(),
	});
	await writeProjectMemoryFile(wd, data);
	return { ok: true };
}

export async function projectMemoryAddNote(
	options: MemoryOptions & { note: string },
): Promise<Result> {
	if (typeof options.note !== "string" || options.note.trim() === "") {
		return { ok: false, error: "note must be a non-empty string" };
	}
	const wd = resolveWorkingDirectory(options.workingDirectory);
	const data = await readProjectMemoryFile(wd);
	data.notes.push({
		text: options.note,
		timestamp: new Date().toISOString(),
	});
	await writeProjectMemoryFile(wd, data);
	return { ok: true };
}

// Re-exported to avoid an "unused" lint. project-memory.json bytes count is
// useful for debugging and surfaced via the CLI parity layer in task #9.
export async function projectMemorySize(
	options: MemoryOptions = {},
): Promise<number> {
	const wd = resolveWorkingDirectory(options.workingDirectory);
	const path = projectMemoryFile(wd);
	if (!existsSync(path)) return 0;
	const info = await stat(path);
	return info.size;
}

// ── MCP tool registration ───────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
	{
		name: "notepad_read",
		description: "Read all three notepad sections (priority, working, manual).",
		inputSchema: {
			type: "object" as const,
			properties: {
				workingDirectory: { type: "string" as const },
			},
		},
	},
	{
		name: "notepad_write_priority",
		description: "Append a timestamped entry to the priority notepad.",
		inputSchema: {
			type: "object" as const,
			properties: {
				content: { type: "string" as const },
				workingDirectory: { type: "string" as const },
			},
			required: ["content"],
		},
	},
	{
		name: "notepad_write_working",
		description: "Append a timestamped entry to the working notepad.",
		inputSchema: {
			type: "object" as const,
			properties: {
				content: { type: "string" as const },
				workingDirectory: { type: "string" as const },
			},
			required: ["content"],
		},
	},
	{
		name: "notepad_write_manual",
		description: "Append a timestamped entry to the manual notepad.",
		inputSchema: {
			type: "object" as const,
			properties: {
				content: { type: "string" as const },
				workingDirectory: { type: "string" as const },
			},
			required: ["content"],
		},
	},
	{
		name: "notepad_stats",
		description: "Return word and line counts for each notepad section.",
		inputSchema: {
			type: "object" as const,
			properties: {
				workingDirectory: { type: "string" as const },
			},
		},
	},
	{
		name: "notepad_prune",
		description: "Remove timestamped notepad entries older than N days.",
		inputSchema: {
			type: "object" as const,
			properties: {
				days: { type: "number" as const, minimum: 0 },
				workingDirectory: { type: "string" as const },
			},
			required: ["days"],
		},
	},
	{
		name: "project_memory_read",
		description: "Read the project memory JSON file (directives + notes).",
		inputSchema: {
			type: "object" as const,
			properties: {
				workingDirectory: { type: "string" as const },
			},
		},
	},
	{
		name: "project_memory_write",
		description: "Replace the entire project memory document.",
		inputSchema: {
			type: "object" as const,
			properties: {
				data: { type: "object" as const },
				workingDirectory: { type: "string" as const },
			},
			required: ["data"],
		},
	},
	{
		name: "project_memory_add_directive",
		description: "Append a directive to project memory.",
		inputSchema: {
			type: "object" as const,
			properties: {
				directive: { type: "string" as const },
				workingDirectory: { type: "string" as const },
			},
			required: ["directive"],
		},
	},
	{
		name: "project_memory_add_note",
		description: "Append a note to project memory.",
		inputSchema: {
			type: "object" as const,
			properties: {
				note: { type: "string" as const },
				workingDirectory: { type: "string" as const },
			},
			required: ["note"],
		},
	},
];

export function buildMemoryServerTools() {
	return TOOL_DEFINITIONS;
}

const server = new Server(
	{ name: "omghc_memory", version: "0.1.0" },
	{ capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: buildMemoryServerTools(),
}));

function asResultPayload(result: Result<unknown>): {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
} {
	const text = JSON.stringify(result);
	if (!result.ok) {
		return {
			content: [{ type: "text", text }],
			isError: true,
		};
	}
	return { content: [{ type: "text", text }] };
}

export async function handleMemoryToolCall(request: {
	params: { name: string; arguments?: Record<string, unknown> };
}): Promise<{
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}> {
	const { name, arguments: rawArgs } = request.params;
	const args = (rawArgs ?? {}) as Record<string, unknown>;
	const wd = args.workingDirectory as string | undefined;

	try {
		switch (name) {
			case "notepad_read":
				return asResultPayload(await notepadRead({ workingDirectory: wd }));
			case "notepad_write_priority":
				return asResultPayload(
					await notepadWritePriority({
						workingDirectory: wd,
						content: args.content as string,
					}),
				);
			case "notepad_write_working":
				return asResultPayload(
					await notepadWriteWorking({
						workingDirectory: wd,
						content: args.content as string,
					}),
				);
			case "notepad_write_manual":
				return asResultPayload(
					await notepadWriteManual({
						workingDirectory: wd,
						content: args.content as string,
					}),
				);
			case "notepad_stats":
				return asResultPayload(await notepadStats({ workingDirectory: wd }));
			case "notepad_prune":
				return asResultPayload(
					await notepadPrune({
						workingDirectory: wd,
						days: args.days as number,
					}),
				);
			case "project_memory_read":
				return asResultPayload(
					await projectMemoryRead({ workingDirectory: wd }),
				);
			case "project_memory_write":
				return asResultPayload(
					await projectMemoryWrite({
						workingDirectory: wd,
						data: args.data,
					}),
				);
			case "project_memory_add_directive":
				return asResultPayload(
					await projectMemoryAddDirective({
						workingDirectory: wd,
						directive: args.directive as string,
					}),
				);
			case "project_memory_add_note":
				return asResultPayload(
					await projectMemoryAddNote({
						workingDirectory: wd,
						note: args.note as string,
					}),
				);
			default:
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ ok: false, error: `Unknown tool: ${name}` }),
						},
					],
					isError: true,
				};
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [
				{ type: "text", text: JSON.stringify({ ok: false, error: message }) },
			],
			isError: true,
		};
	}
}

server.setRequestHandler(CallToolRequestSchema, handleMemoryToolCall);

export { server };

export async function startMemoryServer(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

const entry = process.argv[1];
const isMain =
	typeof entry === "string" &&
	(import.meta.url === `file://${entry.replaceAll("\\", "/")}` ||
		entry.endsWith("memory-server.js"));

if (isMain) {
	startMemoryServer().catch((err) => {
		process.stderr.write(
			`omghc_memory server error: ${(err as Error).message ?? err}\n`,
		);
		process.exit(1);
	});
}
