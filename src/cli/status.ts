export async function runStatus(_args: string[]): Promise<number> {
  // M0: state-server is not implemented yet (M2). Report no active modes.
  process.stdout.write("No active modes.\n");
  process.stdout.write("(Mode tracking will be available in M2 once state-server ships.)\n");
  return 0;
}
