import { spawnSync } from "node:child_process";

export type TeamWorkerCli = "copilot" | "codex" | "claude" | "gemini";

export const SUPPORTED_WORKER_CLIS: readonly TeamWorkerCli[] = [
  "copilot",
  "codex",
  "claude",
  "gemini",
] as const;

const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_WORKER_CLIS);

export function isWorkerCli(value: string): value is TeamWorkerCli {
  return SUPPORTED_SET.has(value);
}

export function defaultWorkerCli(): TeamWorkerCli {
  return "copilot";
}

export interface TmuxPaneRef {
  pane_id: string;
  window_index: number;
  pane_index: number;
}

export interface TmuxSessionInfo {
  session_name: string;
  panes: TmuxPaneRef[];
}

export interface TranslateLaunchOptions {
  prompt?: string;
  reasoning?: "low" | "medium" | "high" | "xhigh";
}

const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const PANE_ID_PATTERN = /^%[0-9]+$/;
const RECORD_DELIM = "\x1f";

function tmuxBinary(): string {
  return process.platform === "win32" ? "psmux" : "tmux";
}

function assertSessionName(name: string): void {
  if (!SESSION_NAME_PATTERN.test(name)) {
    throw new Error(`invalid_session_name:${name}`);
  }
}

function assertPaneId(pane_id: string): void {
  if (!PANE_ID_PATTERN.test(pane_id)) {
    throw new Error(`invalid_pane_id:${pane_id}`);
  }
}

function runTmux(
  args: string[],
  opts: { cwd?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(tmuxBinary(), args, {
    encoding: "utf-8",
    cwd: opts.cwd,
    windowsHide: true,
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: (result.stdout ?? "").toString(),
    stderr: (result.stderr ?? "").toString(),
  };
}

function readTmux(args: string[], opts: { cwd?: string } = {}): string {
  const result = runTmux(args, opts);
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(stderr || `tmux_failed:${args.join(" ")}`);
  }
  return result.stdout;
}

function reasoningToCopilotModel(
  reasoning: TranslateLaunchOptions["reasoning"],
): string | null {
  switch (reasoning) {
    case "high":
    case "xhigh":
      return "claude-opus-4-7";
    case "medium":
    case "low":
    case undefined:
      return null;
    default:
      return null;
  }
}

export function translateWorkerLaunchArgsForCli(
  cli: TeamWorkerCli,
  opts: TranslateLaunchOptions = {},
): string[] {
  const prompt = opts.prompt?.trim();

  if (cli === "copilot") {
    const args: string[] = [
      "--allow-all-tools",
      "--no-color",
      "--no-ask-user",
      "--no-auto-update",
      "--secret-env-vars=GH_TOKEN,GITHUB_TOKEN,COPILOT_GITHUB_TOKEN",
    ];
    const model = reasoningToCopilotModel(opts.reasoning);
    if (model) {
      args.push("--model", model);
    }
    if (prompt) {
      args.push("-p", prompt);
    }
    return args;
  }

  if (cli === "codex") {
    const args: string[] = [];
    if (opts.reasoning) {
      args.push("-c", `model_reasoning_effort=${opts.reasoning}`);
    }
    if (prompt) {
      args.push("--prompt", prompt);
    }
    return args;
  }

  if (cli === "claude") {
    return ["--dangerously-skip-permissions"];
  }

  if (cli === "gemini") {
    const args: string[] = ["--yolo"];
    if (prompt) {
      args.push("--prompt-interactive", prompt);
    }
    return args;
  }

  return [];
}

function listPanes(session_name: string): TmuxPaneRef[] {
  const fmt = ["#{pane_id}", "#{window_index}", "#{pane_index}"].join(RECORD_DELIM);
  const result = runTmux(["list-panes", "-t", session_name, "-a", "-F", fmt]);
  if (result.status !== 0) {
    return [];
  }

  const out: TmuxPaneRef[] = [];
  const lines = result.stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [pane_id = "", win = "", pane = ""] = trimmed.split(RECORD_DELIM);
    if (!PANE_ID_PATTERN.test(pane_id)) continue;
    const window_index = Number.parseInt(win, 10);
    const pane_index = Number.parseInt(pane, 10);
    if (!Number.isFinite(window_index) || !Number.isFinite(pane_index)) continue;
    out.push({ pane_id, window_index, pane_index });
  }
  return out;
}

function sessionExists(session_name: string): boolean {
  const result = runTmux(["has-session", "-t", session_name]);
  return result.status === 0;
}

export function createSession(
  name: string,
  opts: { detach?: boolean; cwd?: string } = {},
): TmuxSessionInfo {
  assertSessionName(name);
  const detach = opts.detach !== false;

  if (sessionExists(name)) {
    throw new Error(`session_exists:${name}`);
  }

  const args = ["new-session"];
  if (detach) args.push("-d");
  args.push("-s", name);
  if (opts.cwd) {
    args.push("-c", opts.cwd);
  }

  const result = runTmux(args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `create_session_failed:${name}`);
  }

  return {
    session_name: name,
    panes: listPanes(name),
  };
}

export function listSession(name: string): TmuxSessionInfo | null {
  assertSessionName(name);
  if (!sessionExists(name)) return null;
  return {
    session_name: name,
    panes: listPanes(name),
  };
}

export function killSession(name: string): void {
  assertSessionName(name);
  if (!sessionExists(name)) return;
  const result = runTmux(["kill-session", "-t", name]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `kill_session_failed:${name}`);
  }
}

export function splitPane(
  session_name: string,
  opts: { vertical?: boolean; cwd?: string } = {},
): { pane_id: string } {
  assertSessionName(session_name);
  if (!sessionExists(session_name)) {
    throw new Error(`session_not_found:${session_name}`);
  }

  const args = ["split-window", "-t", session_name, "-P", "-F", "#{pane_id}"];
  args.push(opts.vertical ? "-v" : "-h");
  if (opts.cwd) {
    args.push("-c", opts.cwd);
  }

  const result = runTmux(args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `split_pane_failed:${session_name}`);
  }

  const pane_id = result.stdout.trim();
  if (!PANE_ID_PATTERN.test(pane_id)) {
    throw new Error(`split_pane_invalid_id:${pane_id}`);
  }
  return { pane_id };
}

export function sendKeys(
  pane_id: string,
  text: string,
  opts: { submit?: boolean } = {},
): void {
  assertPaneId(pane_id);
  const args = ["send-keys", "-t", pane_id, "-l", text];
  const result = runTmux(args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `send_keys_failed:${pane_id}`);
  }

  if (opts.submit) {
    const enter = runTmux(["send-keys", "-t", pane_id, "Enter"]);
    if (enter.status !== 0) {
      throw new Error(enter.stderr.trim() || `send_keys_submit_failed:${pane_id}`);
    }
  }
}

export function capturePane(
  pane_id: string,
  opts: { tail_lines?: number } = {},
): string {
  assertPaneId(pane_id);
  const args = ["capture-pane", "-t", pane_id, "-p", "-J"];
  if (typeof opts.tail_lines === "number" && opts.tail_lines > 0) {
    const start = -Math.floor(opts.tail_lines);
    args.push("-S", String(start));
  }

  return readTmux(args);
}
