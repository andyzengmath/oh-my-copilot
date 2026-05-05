import { runVersion } from "./version.js";
import { runHelp } from "./help.js";
import { runStatus } from "./status.js";

type SubcommandHandler = (args: string[]) => Promise<number>;

const SUBCOMMANDS: Record<string, SubcommandHandler> = {
  version: runVersion,
  "--version": runVersion,
  "-v": runVersion,
  help: runHelp,
  "--help": runHelp,
  "-h": runHelp,
  status: runStatus,
};

const STUBS = [
  "setup", "doctor", "exec", "team", "hud", "wiki", "explore",
  "question", "state", "trace", "mcp-serve", "uninstall", "update",
  "list", "agents-init", "reasoning", "tmux-hook", "hooks", "notify",
  "cancel",
];

export async function runCli(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    return runHelp([]);
  }

  const handler = SUBCOMMANDS[subcommand];
  if (handler) {
    return handler(rest);
  }

  if (STUBS.includes(subcommand)) {
    process.stdout.write(`omghc ${subcommand}: not implemented yet (planned for M1+)\n`);
    return 0;
  }

  process.stderr.write(`omghc: unknown subcommand '${subcommand}'. Run 'omghc help' for usage.\n`);
  return 2;
}
