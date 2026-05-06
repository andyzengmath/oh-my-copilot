import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface WorktreeInfo {
  team_name: string;
  worker_name: string;
  path: string;
  branch: string;
  base_branch: string;
}

export interface MergeConflictResult {
  conflicts: boolean;
  files?: string[];
}

export interface MergeResult {
  success: boolean;
  output: string;
}

export interface MergeAllResult {
  merged: string[];
  conflicts: string[];
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function assertSafeName(label: string, value: string): void {
  if (!NAME_PATTERN.test(value)) {
    throw new Error(`invalid_${label}:${value}`);
  }
}

function runGit(
  repoRoot: string,
  args: string[],
  opts: { cwd?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", ["--no-pager", ...args], {
    cwd: opts.cwd ?? repoRoot,
    encoding: "utf-8",
    windowsHide: true,
  });
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: (result.stdout ?? "").toString(),
    stderr: (result.stderr ?? "").toString(),
  };
}

function readGit(repoRoot: string, args: string[], opts: { cwd?: string } = {}): string {
  const result = runGit(repoRoot, args, opts);
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(stderr || `git_failed:${args.join(" ")}`);
  }
  return result.stdout.trim();
}

function detectDefaultBaseBranch(repoRoot: string): string {
  const symbolic = runGit(repoRoot, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const value = symbolic.stdout.trim();
    if (value.startsWith("origin/")) {
      return value.slice("origin/".length);
    }
    if (value) return value;
  }

  for (const candidate of ["main", "master"]) {
    const verify = runGit(repoRoot, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${candidate}`,
    ]);
    if (verify.status === 0) return candidate;
  }

  const branch = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.status === 0 && branch.stdout.trim() && branch.stdout.trim() !== "HEAD") {
    return branch.stdout.trim();
  }

  throw new Error("no_base_branch");
}

function branchName(team_name: string, worker_name: string): string {
  return `omghc-team/${team_name}/${worker_name}`;
}

function teamWorktreesRoot(repoRoot: string, team_name: string): string {
  return join(repoRoot, ".omghc", "worktrees", team_name);
}

function workerWorktreePath(repoRoot: string, team_name: string, worker_name: string): string {
  return join(teamWorktreesRoot(repoRoot, team_name), worker_name);
}

function localBranchExists(repoRoot: string, branch: string): boolean {
  const result = runGit(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  return result.status === 0;
}

interface RawWorktreeEntry {
  path: string;
  head: string;
  branchRef: string | null;
  detached: boolean;
}

function listGitWorktrees(repoRoot: string): RawWorktreeEntry[] {
  const raw = readGit(repoRoot, ["worktree", "list", "--porcelain"]);
  if (!raw) return [];

  const entries: RawWorktreeEntry[] = [];
  const chunks = raw
    .split(/\n\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const lines = chunk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const worktreeLine = lines.find((line) => line.startsWith("worktree "));
    const headLine = lines.find((line) => line.startsWith("HEAD "));
    const branchLine = lines.find((line) => line.startsWith("branch "));
    if (!worktreeLine || !headLine) continue;

    entries.push({
      path: resolve(worktreeLine.slice("worktree ".length)),
      head: headLine.slice("HEAD ".length).trim(),
      branchRef: branchLine ? branchLine.slice("branch ".length).trim() : null,
      detached: lines.includes("detached") || !branchLine,
    });
  }

  return entries;
}

function findWorktreeByPath(
  entries: RawWorktreeEntry[],
  worktreePath: string,
): RawWorktreeEntry | null {
  const target = resolve(worktreePath);
  return entries.find((entry) => entry.path === target) ?? null;
}

function pruneWorktrees(repoRoot: string): void {
  const result = runGit(repoRoot, ["worktree", "prune"]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "worktree_prune_failed");
  }
}

export function createWorkerWorktree(
  team_name: string,
  worker_name: string,
  repoRoot: string,
  base_branch?: string,
): WorktreeInfo {
  assertSafeName("team_name", team_name);
  assertSafeName("worker_name", worker_name);

  const repoRootResolved = resolve(repoRoot);
  const baseBranch = base_branch ?? detectDefaultBaseBranch(repoRootResolved);
  assertSafeName("base_branch", baseBranch.replace(/\//g, "-"));

  const branch = branchName(team_name, worker_name);
  const worktreePath = workerWorktreePath(repoRootResolved, team_name, worker_name);

  const entries = listGitWorktrees(repoRootResolved);
  const existing = findWorktreeByPath(entries, worktreePath);
  if (existing) {
    if (existing.branchRef !== `refs/heads/${branch}`) {
      throw new Error(`worktree_target_mismatch:${worktreePath}`);
    }
    return {
      team_name,
      worker_name,
      path: resolve(worktreePath),
      branch,
      base_branch: baseBranch,
    };
  }

  if (existsSync(worktreePath)) {
    pruneWorktrees(repoRootResolved);
    if (existsSync(worktreePath)) {
      throw new Error(`worktree_path_conflict:${worktreePath}`);
    }
  }

  mkdirSync(dirname(worktreePath), { recursive: true });

  const branchAlreadyExists = localBranchExists(repoRootResolved, branch);
  const addArgs = ["worktree", "add"];
  if (branchAlreadyExists) {
    addArgs.push(worktreePath, branch);
  } else {
    addArgs.push("-b", branch, worktreePath, baseBranch);
  }

  const result = runGit(repoRootResolved, addArgs);
  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    if (/already used by worktree|already checked out/i.test(stderr)) {
      throw new Error(`branch_in_use:${branch}`);
    }
    throw new Error(stderr || `worktree_add_failed:${addArgs.join(" ")}`);
  }

  return {
    team_name,
    worker_name,
    path: resolve(worktreePath),
    branch,
    base_branch: baseBranch,
  };
}

export function removeWorkerWorktree(
  team_name: string,
  worker_name: string,
  repoRoot: string,
): void {
  assertSafeName("team_name", team_name);
  assertSafeName("worker_name", worker_name);

  const repoRootResolved = resolve(repoRoot);
  const worktreePath = workerWorktreePath(repoRootResolved, team_name, worker_name);

  const entries = listGitWorktrees(repoRootResolved);
  const existing = findWorktreeByPath(entries, worktreePath);

  if (existing) {
    const result = runGit(repoRootResolved, [
      "worktree",
      "remove",
      "--force",
      worktreePath,
    ]);
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `worktree_remove_failed:${worktreePath}`);
    }
  } else if (existsSync(worktreePath)) {
    pruneWorktrees(repoRootResolved);
  }
}

export function listTeamWorktrees(team_name: string, repoRoot: string): WorktreeInfo[] {
  assertSafeName("team_name", team_name);
  const repoRootResolved = resolve(repoRoot);

  const baseBranch = (() => {
    try {
      return detectDefaultBaseBranch(repoRootResolved);
    } catch {
      return "";
    }
  })();

  const teamPrefix = `refs/heads/omghc-team/${team_name}/`;
  const teamRoot = resolve(teamWorktreesRoot(repoRootResolved, team_name));
  const entries = listGitWorktrees(repoRootResolved);
  const out: WorktreeInfo[] = [];

  for (const entry of entries) {
    if (!entry.branchRef) continue;
    if (!entry.branchRef.startsWith(teamPrefix)) continue;
    if (!entry.path.startsWith(teamRoot)) continue;

    const worker_name = entry.branchRef.slice(teamPrefix.length);
    if (!NAME_PATTERN.test(worker_name)) continue;

    out.push({
      team_name,
      worker_name,
      path: entry.path,
      branch: entry.branchRef.slice("refs/heads/".length),
      base_branch: baseBranch,
    });
  }

  return out;
}

export function cleanupTeamWorktrees(team_name: string, repoRoot: string): void {
  assertSafeName("team_name", team_name);
  const repoRootResolved = resolve(repoRoot);
  const worktrees = listTeamWorktrees(team_name, repoRootResolved);

  const errors: string[] = [];
  for (const wt of worktrees) {
    const result = runGit(repoRootResolved, [
      "worktree",
      "remove",
      "--force",
      wt.path,
    ]);
    if (result.status !== 0) {
      errors.push(`${wt.worker_name}:${result.stderr.trim() || "remove_failed"}`);
    }
  }

  try {
    pruneWorktrees(repoRootResolved);
  } catch (err) {
    errors.push(`prune:${(err as Error).message}`);
  }

  if (errors.length > 0) {
    throw new Error(`cleanup_team_worktrees_failed:${errors.join(" | ")}`);
  }
}

export function checkMergeConflicts(
  workerBranch: string,
  baseBranch: string,
  repoRoot: string,
): MergeConflictResult {
  const repoRootResolved = resolve(repoRoot);

  const baseSha = readGit(repoRootResolved, ["rev-parse", baseBranch]);
  const workerSha = readGit(repoRootResolved, ["rev-parse", workerBranch]);
  const mergeBase = readGit(repoRootResolved, ["merge-base", baseSha, workerSha]);

  const dryRun = runGit(repoRootResolved, [
    "merge-tree",
    "--write-tree",
    "--name-only",
    mergeBase,
    baseSha,
    workerSha,
  ]);

  if (dryRun.status === 0) {
    return { conflicts: false };
  }

  const stdoutLines = dryRun.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const conflictFiles = stdoutLines.slice(1).filter((line) => !/^[0-9a-f]{40}$/i.test(line));

  return {
    conflicts: true,
    files: conflictFiles.length > 0 ? conflictFiles : undefined,
  };
}

export function mergeWorkerBranch(
  workerBranch: string,
  baseBranch: string,
  repoRoot: string,
): MergeResult {
  const repoRootResolved = resolve(repoRoot);

  const checkout = runGit(repoRootResolved, ["checkout", baseBranch]);
  if (checkout.status !== 0) {
    return {
      success: false,
      output: checkout.stderr.trim() || `checkout_failed:${baseBranch}`,
    };
  }

  const merge = runGit(repoRootResolved, [
    "merge",
    "--no-ff",
    "--no-edit",
    workerBranch,
  ]);

  const output = [merge.stdout, merge.stderr]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");

  if (merge.status === 0) {
    return { success: true, output };
  }

  runGit(repoRootResolved, ["merge", "--abort"]);

  return { success: false, output: output || "merge_failed" };
}

export function mergeAllWorkerBranches(
  team_name: string,
  repoRoot: string,
  base_branch?: string,
): MergeAllResult {
  assertSafeName("team_name", team_name);
  const repoRootResolved = resolve(repoRoot);
  const baseBranch = base_branch ?? detectDefaultBaseBranch(repoRootResolved);
  const worktrees = listTeamWorktrees(team_name, repoRootResolved);

  const merged: string[] = [];
  const conflicts: string[] = [];

  for (const wt of worktrees) {
    const result = mergeWorkerBranch(wt.branch, baseBranch, repoRootResolved);
    if (result.success) {
      merged.push(wt.branch);
    } else {
      conflicts.push(wt.branch);
    }
  }

  return { merged, conflicts };
}
