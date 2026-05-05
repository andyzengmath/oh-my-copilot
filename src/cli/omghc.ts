#!/usr/bin/env node
import { runCli } from "./index.js";

const args = process.argv.slice(2);

runCli(args).then(
  (exitCode) => {
    process.exit(exitCode ?? 0);
  },
  (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`omghc: ${message}\n`);
    process.exit(1);
  }
);
