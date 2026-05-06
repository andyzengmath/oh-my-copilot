import { HUD_COLUMNS, HUD_DEFAULT_REFRESH_MS } from "./constants.js";
import { readHudSnapshot, type HudSnapshot, type HudWorkerRow } from "./state.js";

export { readHudSnapshot } from "./state.js";
export type { HudSnapshot, HudWorkerRow } from "./state.js";

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + " ".repeat(width - value.length);
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}

function formatUptime(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTaskCell(row: HudWorkerRow, ageMinutes: number | null): string {
  if (!row.current_task_id) return "—";
  const status = row.current_task_status ?? "?";
  const ageSuffix =
    row.state === "stalled" && ageMinutes !== null && ageMinutes >= 1
      ? `, ${ageMinutes} min ago`
      : "";
  return `task #${row.current_task_id} (${status}${ageSuffix})`;
}

export function renderHudTable(snapshot: HudSnapshot): string {
  if (!snapshot.found) {
    return `omghc team ${snapshot.team_name} — not found\n`;
  }

  const phase = snapshot.phase ?? "—";
  const uptime = formatUptime(snapshot.uptime_ms);
  const header = `omghc team ${snapshot.team_name} — phase: ${phase} — uptime: ${uptime}\n`;

  const colHeader =
    pad("WORKER", HUD_COLUMNS.worker) +
    " " +
    pad("STATE", HUD_COLUMNS.state) +
    " " +
    pad("TURNS", HUD_COLUMNS.turns) +
    " " +
    "TASK";

  const rows: string[] = [];
  for (const w of snapshot.workers) {
    const ageMin =
      w.last_beat_age_ms !== null ? Math.floor(w.last_beat_age_ms / 60_000) : null;
    rows.push(
      pad(truncate(w.name, HUD_COLUMNS.worker), HUD_COLUMNS.worker) +
        " " +
        pad(truncate(w.state, HUD_COLUMNS.state), HUD_COLUMNS.state) +
        " " +
        pad(String(w.turn_count), HUD_COLUMNS.turns) +
        " " +
        truncate(formatTaskCell(w, ageMin), HUD_COLUMNS.task),
    );
  }
  if (rows.length === 0) rows.push("(no workers registered)");

  const t = snapshot.tasks;
  const tasksLine = `TASKS  pending: ${t.pending}  in_progress: ${t.in_progress}  completed: ${t.completed}  failed: ${t.failed}`;

  return [header, colHeader, ...rows, "", tasksLine, ""].join("\n");
}

export function renderHudJson(snapshot: HudSnapshot): string {
  if (!snapshot.found) {
    return `${JSON.stringify({ ok: false, error: "team not found", team_name: snapshot.team_name })}\n`;
  }
  return `${JSON.stringify({ ok: true, snapshot })}\n`;
}

export interface WatchOptions {
  team_name: string;
  refreshMs?: number;
  json?: boolean;
  workingDirectory?: string;
  signal?: AbortSignal;
  write?: (chunk: string) => void;
  clearScreen?: () => void;
}

const ANSI_CLEAR = "\x1b[2J\x1b[H";

export async function watchHud(opts: WatchOptions): Promise<void> {
  const refreshMs = opts.refreshMs ?? HUD_DEFAULT_REFRESH_MS;
  const write = opts.write ?? ((chunk: string) => process.stdout.write(chunk));
  const clear =
    opts.clearScreen ?? (() => process.stdout.write(ANSI_CLEAR));

  while (!opts.signal?.aborted) {
    const snapshot = readHudSnapshot(opts.team_name, {
      workingDirectory: opts.workingDirectory,
    });
    if (!opts.json) clear();
    write(opts.json ? renderHudJson(snapshot) : renderHudTable(snapshot));

    if (opts.signal?.aborted) break;
    await waitOrAbort(refreshMs, opts.signal);
  }
}

function waitOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
