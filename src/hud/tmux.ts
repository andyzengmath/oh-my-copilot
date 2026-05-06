import { spawnSync } from "node:child_process";

export interface TmuxLaunchResult {
  ok: boolean;
  reason?: "tmux_not_found" | "spawn_failed";
  message?: string;
}

function hasTmuxOnPath(): boolean {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["tmux"], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

export function isInsideTmux(): boolean {
  return typeof process.env.TMUX === "string" && process.env.TMUX.length > 0;
}

export function launchHudInTmux(team_name: string, omghcBin: string): TmuxLaunchResult {
  if (!hasTmuxOnPath()) {
    return {
      ok: false,
      reason: "tmux_not_found",
      message: "tmux not on PATH; falling back to stdout",
    };
  }
  const cmd = `${omghcBin} hud --team ${team_name} --watch`;
  const args = isInsideTmux()
    ? ["split-window", "-h", cmd]
    : ["new-session", "-d", "-s", `omghc-hud-${team_name}`, cmd];
  const result = spawnSync("tmux", args, { stdio: "ignore" });
  if (result.status !== 0) {
    return {
      ok: false,
      reason: "spawn_failed",
      message: `tmux exited with status ${result.status ?? "unknown"}`,
    };
  }
  return { ok: true };
}
