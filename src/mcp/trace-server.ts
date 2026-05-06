/**
 * OMGHC Trace MCP Server (read-only)
 * Consumes events from <wd>/.omghc/state/trace.jsonl (one JSON event per line).
 * Never writes to trace.jsonl — M2b hooks will produce events; this server only
 * aggregates/queries them.
 *
 * Server name: omghc_trace.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createReadStream, existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline";

export interface TraceEvent {
	timestamp: string;
	event: string;
	source?: string;
	data?: Record<string, unknown>;
}

export interface TraceQueryOptions {
	workingDirectory?: string;
	since?: string;
	until?: string;
}

export interface TraceTimelineOptions extends TraceQueryOptions {
	limit?: number;
	eventFilter?: string;
}

export interface TraceSummaryData {
	totalEvents: number;
	byEvent: Record<string, number>;
	span: { earliest: string | null; latest: string | null };
}

interface OkResult<T> {
	ok: true;
	data: T;
}

interface ErrResult {
	ok: false;
	error: string;
}

type Result<T> = OkResult<T> | ErrResult;

const DEFAULT_TIMELINE_LIMIT = 100;
const MAX_TIMELINE_LIMIT = 1_000;

function resolveWorkingDirectory(wd?: string): string {
	if (typeof wd === "string" && wd.trim() !== "") {
		return resolvePath(wd);
	}
	return process.cwd();
}

function tracePath(wd: string): string {
	return join(wd, ".omghc", "state", "trace.jsonl");
}

function isValidIsoTimestamp(value: unknown): value is string {
	if (typeof value !== "string") return false;
	return Number.isFinite(Date.parse(value));
}

function isTraceEvent(value: unknown): value is TraceEvent {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.timestamp === "string" && typeof candidate.event === "string"
	);
}

function eventInRange(
	event: TraceEvent,
	sinceMs: number | null,
	untilMs: number | null,
): boolean {
	if (sinceMs === null && untilMs === null) return true;
	const ts = Date.parse(event.timestamp);
	if (!Number.isFinite(ts)) return false;
	if (sinceMs !== null && ts < sinceMs) return false;
	if (untilMs !== null && ts > untilMs) return false;
	return true;
}

async function* iterateTraceEvents(
	path: string,
): AsyncGenerator<TraceEvent, void, void> {
	if (!existsSync(path)) return;
	const stream = createReadStream(path, { encoding: "utf-8" });
	const rl = createInterface({ input: stream, crlfDelay: Infinity });
	try {
		for await (const rawLine of rl) {
			const line = rawLine.trim();
			if (line.length === 0) continue;
			try {
				const parsed = JSON.parse(line) as unknown;
				if (isTraceEvent(parsed)) {
					yield parsed;
				}
			} catch {
				// skip malformed line; trace.jsonl is best-effort
			}
		}
	} finally {
		rl.close();
		stream.close();
	}
}

function parseRangeBound(value: unknown): number | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

// ── Underlying functions (exported for CLI parity) ──────────────────────────

export async function traceSummary(
	options: TraceQueryOptions = {},
): Promise<Result<TraceSummaryData>> {
	if (options.since !== undefined && !isValidIsoTimestamp(options.since)) {
		return { ok: false, error: "since must be an ISO8601 timestamp" };
	}
	if (options.until !== undefined && !isValidIsoTimestamp(options.until)) {
		return { ok: false, error: "until must be an ISO8601 timestamp" };
	}
	const wd = resolveWorkingDirectory(options.workingDirectory);
	const sinceMs = parseRangeBound(options.since);
	const untilMs = parseRangeBound(options.until);

	const byEvent: Record<string, number> = {};
	let totalEvents = 0;
	let earliest: string | null = null;
	let latest: string | null = null;
	let earliestMs = Number.POSITIVE_INFINITY;
	let latestMs = Number.NEGATIVE_INFINITY;

	for await (const event of iterateTraceEvents(tracePath(wd))) {
		if (!eventInRange(event, sinceMs, untilMs)) continue;
		totalEvents += 1;
		byEvent[event.event] = (byEvent[event.event] ?? 0) + 1;
		const ts = Date.parse(event.timestamp);
		if (Number.isFinite(ts)) {
			if (ts < earliestMs) {
				earliestMs = ts;
				earliest = event.timestamp;
			}
			if (ts > latestMs) {
				latestMs = ts;
				latest = event.timestamp;
			}
		}
	}

	return {
		ok: true,
		data: {
			totalEvents,
			byEvent,
			span: { earliest, latest },
		},
	};
}

export async function traceTimeline(
	options: TraceTimelineOptions = {},
): Promise<Result<TraceEvent[]>> {
	if (options.since !== undefined && !isValidIsoTimestamp(options.since)) {
		return { ok: false, error: "since must be an ISO8601 timestamp" };
	}
	if (options.until !== undefined && !isValidIsoTimestamp(options.until)) {
		return { ok: false, error: "until must be an ISO8601 timestamp" };
	}
	if (options.limit !== undefined) {
		if (
			typeof options.limit !== "number" ||
			!Number.isFinite(options.limit) ||
			options.limit <= 0
		) {
			return { ok: false, error: "limit must be a positive number" };
		}
	}

	const limit = Math.min(
		options.limit ?? DEFAULT_TIMELINE_LIMIT,
		MAX_TIMELINE_LIMIT,
	);
	const wd = resolveWorkingDirectory(options.workingDirectory);
	const sinceMs = parseRangeBound(options.since);
	const untilMs = parseRangeBound(options.until);
	const eventFilter =
		typeof options.eventFilter === "string" && options.eventFilter !== ""
			? options.eventFilter
			: null;

	// Bounded ring buffer keeping the last `limit` events that match filters,
	// preserving file order. Final response reverses to most-recent-first.
	const ring: TraceEvent[] = new Array(limit);
	let count = 0;

	for await (const event of iterateTraceEvents(tracePath(wd))) {
		if (!eventInRange(event, sinceMs, untilMs)) continue;
		if (eventFilter !== null && event.event !== eventFilter) continue;
		ring[count % limit] = event;
		count += 1;
	}

	const collected: TraceEvent[] = [];
	if (count <= limit) {
		for (let i = 0; i < count; i += 1) {
			collected.push(ring[i]);
		}
	} else {
		const start = count % limit;
		for (let i = 0; i < limit; i += 1) {
			collected.push(ring[(start + i) % limit]);
		}
	}
	collected.reverse();
	return { ok: true, data: collected };
}

// ── MCP tool registration ───────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
	{
		name: "trace_summary",
		description:
			"Aggregate counts of trace events by event type, optionally bounded by since/until ISO8601 timestamps.",
		inputSchema: {
			type: "object" as const,
			properties: {
				workingDirectory: { type: "string" as const },
				since: { type: "string" as const },
				until: { type: "string" as const },
			},
		},
	},
	{
		name: "trace_timeline",
		description:
			"Return recent trace events (most recent first), capped at `limit` (default 100, max 1000). Optional `eventFilter` matches the event type exactly.",
		inputSchema: {
			type: "object" as const,
			properties: {
				workingDirectory: { type: "string" as const },
				limit: { type: "number" as const, minimum: 1 },
				since: { type: "string" as const },
				eventFilter: { type: "string" as const },
			},
		},
	},
];

export function buildTraceServerTools() {
	return TOOL_DEFINITIONS;
}

const server = new Server(
	{ name: "omghc_trace", version: "0.1.0" },
	{ capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: buildTraceServerTools(),
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

export async function handleTraceToolCall(request: {
	params: { name: string; arguments?: Record<string, unknown> };
}): Promise<{
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}> {
	const { name, arguments: rawArgs } = request.params;
	const args = (rawArgs ?? {}) as Record<string, unknown>;
	const wd = args.workingDirectory as string | undefined;
	const since = args.since as string | undefined;
	const until = args.until as string | undefined;

	try {
		switch (name) {
			case "trace_summary":
				return asResultPayload(
					await traceSummary({ workingDirectory: wd, since, until }),
				);
			case "trace_timeline":
				return asResultPayload(
					await traceTimeline({
						workingDirectory: wd,
						since,
						until,
						limit: args.limit as number | undefined,
						eventFilter: args.eventFilter as string | undefined,
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

server.setRequestHandler(CallToolRequestSchema, handleTraceToolCall);

export { server };

export async function startTraceServer(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

const entry = process.argv[1];
const isMain =
	typeof entry === "string" &&
	(import.meta.url === `file://${entry.replaceAll("\\", "/")}` ||
		entry.endsWith("trace-server.js"));

if (isMain) {
	startTraceServer().catch((err) => {
		process.stderr.write(
			`omghc_trace server error: ${(err as Error).message ?? err}\n`,
		);
		process.exit(1);
	});
}
