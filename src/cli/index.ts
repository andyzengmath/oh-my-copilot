import { runVersion } from "./version.js";
import { runHelp } from "./help.js";
import { runStatus } from "./status.js";
import { runSetup } from "./setup.js";
import { runDoctor } from "./doctor.js";
import { runUninstall } from "./uninstall.js";
import { runList } from "./list.js";
import { runUpdate } from "./update.js";
import { runSetupFinalizeMcp } from "./setup-finalize-mcp.js";
import { runMcpServe } from "./mcp-serve.js";
import { runState } from "./state.js";
import { runWiki } from "./wiki.js";
import { runTrace } from "./trace.js";
import { runTeam } from "../team/api.js";

type SubcommandHandler = (args: string[]) => Promise<number>;

const SUBCOMMANDS: Record<string, SubcommandHandler> = {
  version: runVersion,
  "--version": runVersion,
  "-v": runVersion,
  help: runHelp,
  "--help": runHelp,
  "-h": runHelp,
  status: runStatus,
  setup: runSetup,
  doctor: runDoctor,
  uninstall: runUninstall,
  list: runList,
  update: runUpdate,
  "mcp-serve": runMcpServe,
  state: runState,
  wiki: runWiki,
  trace: runTrace,
  team: runTeam,
};

const STUBS = [
  "exec", "hud", "explore",
  "question",
  "agents-init", "reasoning", "tmux-hook", "hooks", "notify",
  "cancel",
];

export async function runCli(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    return runHelp([]);
  }

  // Special routing: `omghc setup --finalize-mcp` → runSetupFinalizeMcp
  if (subcommand === "setup" && rest.includes("--finalize-mcp")) {
    return runSetupFinalizeMcp(rest.filter((a) => a !== "--finalize-mcp"));
  }

  const handler = SUBCOMMANDS[subcommand];
  if (handler) {
    return handler(rest);
  }

  if (STUBS.includes(subcommand)) {
    process.stdout.write(`omghc ${subcommand}: not implemented yet (planned for M2+)\n`);
    return 0;
  }

  process.stderr.write(`omghc: unknown subcommand '${subcommand}'. Run 'omghc help' for usage.\n`);
  return 2;
}
