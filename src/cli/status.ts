import { stateListActive } from "../state/operations.js";

export async function runStatus(_args: string[]): Promise<number> {
  const active = stateListActive();
  if (active.length === 0) {
    process.stdout.write("No active modes.\n");
    return 0;
  }
  process.stdout.write("Active modes:\n");
  for (const entry of active) {
    const phase = entry.current_phase ? ` [${entry.current_phase}]` : "";
    process.stdout.write(`  ${entry.mode}${phase}\n`);
  }
  return 0;
}
