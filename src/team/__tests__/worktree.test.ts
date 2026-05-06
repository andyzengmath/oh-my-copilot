import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createWorkerWorktree,
  listTeamWorktrees,
  removeWorkerWorktree,
} from "../worktree.js";

function gitAvailable(): boolean {
  const probe = spawnSync("git", ["--version"], { encoding: "utf-8" });
  return probe.status === 0;
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "omghc-worktree-test-"));
  // Use a stable initial branch name so detectDefaultBaseBranch resolves it.
  const init = spawnSync(
    "git",
    ["init", "--initial-branch=main", dir],
    { encoding: "utf-8" },
  );
  if (init.status !== 0) {
    // Older git: fall back and rename master->main after init.
    const fallbackInit = spawnSync("git", ["init", dir], {
      encoding: "utf-8",
    });
    if (fallbackInit.status !== 0) {
      throw new Error(
        `git init failed: ${fallbackInit.stderr || fallbackInit.stdout}`,
      );
    }
    spawnSync("git", ["-C", dir, "branch", "-M", "main"], {
      encoding: "utf-8",
    });
  }
  // Identity required for commits to succeed in pristine envs.
  spawnSync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
  spawnSync("git", ["-C", dir, "config", "user.name", "Test"]);
  spawnSync("git", ["-C", dir, "config", "commit.gpgsign", "false"]);

  // Initial commit so the branch has a tip and worktree add can succeed.
  writeFileSync(join(dir, "README.md"), "init\n");
  const add = spawnSync("git", ["-C", dir, "add", "README.md"], {
    encoding: "utf-8",
  });
  if (add.status !== 0) {
    throw new Error(`git add failed: ${add.stderr || add.stdout}`);
  }
  const commit = spawnSync(
    "git",
    ["-C", dir, "commit", "-m", "init", "--no-gpg-sign"],
    { encoding: "utf-8" },
  );
  if (commit.status !== 0) {
    throw new Error(
      `git commit failed: ${commit.stderr || commit.stdout}`,
    );
  }
  return dir;
}

test("createWorkerWorktree creates the worktree dir and branch", (t) => {
  if (!gitAvailable()) {
    t.skip("git not on PATH");
    return;
  }
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const info = createWorkerWorktree("alpha", "worker1", repo);
  assert.equal(info.team_name, "alpha");
  assert.equal(info.worker_name, "worker1");
  assert.equal(info.branch, "omghc-team/alpha/worker1");
  assert.equal(info.base_branch, "main");
  assert.equal(existsSync(info.path), true);

  // Branch must now exist locally.
  const branchProbe = spawnSync(
    "git",
    [
      "-C",
      repo,
      "show-ref",
      "--verify",
      "--quiet",
      "refs/heads/omghc-team/alpha/worker1",
    ],
    { encoding: "utf-8" },
  );
  assert.equal(branchProbe.status, 0);
});

test("listTeamWorktrees returns the worktree info filtered by team", (t) => {
  if (!gitAvailable()) {
    t.skip("git not on PATH");
    return;
  }
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  createWorkerWorktree("alpha", "worker1", repo);
  createWorkerWorktree("alpha", "worker2", repo);
  createWorkerWorktree("beta", "worker1", repo);

  const alphaTree = listTeamWorktrees("alpha", repo);
  assert.equal(alphaTree.length, 2);
  assert.deepEqual(
    alphaTree.map((wt) => wt.worker_name).sort(),
    ["worker1", "worker2"],
  );
  for (const wt of alphaTree) {
    assert.equal(wt.team_name, "alpha");
    assert.equal(wt.branch, `omghc-team/alpha/${wt.worker_name}`);
    assert.equal(existsSync(wt.path), true);
  }

  const betaTree = listTeamWorktrees("beta", repo);
  assert.equal(betaTree.length, 1);
  assert.equal(betaTree[0]?.worker_name, "worker1");
});

test("removeWorkerWorktree cleans up the dir and the listing drops it", (t) => {
  if (!gitAvailable()) {
    t.skip("git not on PATH");
    return;
  }
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const info = createWorkerWorktree("alpha", "worker1", repo);
  assert.equal(existsSync(info.path), true);

  removeWorkerWorktree("alpha", "worker1", repo);

  assert.equal(existsSync(info.path), false);
  const remaining = listTeamWorktrees("alpha", repo);
  assert.equal(remaining.length, 0);
});

test("createWorkerWorktree is idempotent: re-creating the same worktree returns the existing one", (t) => {
  if (!gitAvailable()) {
    t.skip("git not on PATH");
    return;
  }
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  const first = createWorkerWorktree("alpha", "worker1", repo);
  const second = createWorkerWorktree("alpha", "worker1", repo);
  assert.equal(second.path, first.path);
  assert.equal(second.branch, first.branch);

  // Listing must still show only one entry.
  const list = listTeamWorktrees("alpha", repo);
  assert.equal(list.length, 1);
});
