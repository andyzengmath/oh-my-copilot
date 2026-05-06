# Skills

Skills are the keyword-triggered workflows that make OMGHC feel like an opinionated harness rather than a raw CLI. Each skill is a folder containing a `SKILL.md` (frontmatter + body). Copilot loads them from `${COPILOT_HOME:-~/.copilot}/skills/`; OMGHC mirrors them into `plugins/oh-my-ghcopilot/skills/` so the plugin bundle stays in sync.

See [getting-started.md](./getting-started.md) for install and [integrations.md](./integrations.md) for notification surfaces.

## Skill format

Every skill is a directory with `SKILL.md` at its root:

```
skills/
└── ralph/
    └── SKILL.md
```

`SKILL.md` starts with YAML frontmatter, then a freeform body. Minimum frontmatter:

```yaml
---
name: ralph
description: Self-referential loop until task completion with architect verification
---
```

- `name` — keyword used after `$` to invoke the skill
- `description` — one-line summary surfaced by `omghc list` and Copilot's skill picker

The body is the prompt the skill injects. It can include `<Purpose>`, `<Steps>`, `<Examples>`, and other XML-tagged sections. OMGHC also recognises template variables like `{{PROMPT}}`, `{{ITERATION}}`, `{{MAX}}` for skills that loop.

## How to invoke

Inside a Copilot CLI session:

```
$ralph fix the cache invalidation bug in src/cache.ts and verify
```

The `$ralph` token (no space) is the activation keyword. The remainder of the line becomes `{{PROMPT}}`. A planned future surface is `omghc skill <name> "<prompt>"` for shell-driven invocation; for v0.1.0 the keyword form is the supported path.

## Skill-active state

When a stateful skill (ralph, autopilot, team, ultrawork, ultraqa, pipeline) starts, it writes its lifecycle state via the `omghc_state` MCP server:

```
state_write({mode: "ralph", active: true, current_phase: "executing", ...})
```

Read with `state_read`, clear with `state_clear`, or end the active mode cleanly with the `cancel` skill (`$cancel`). The HUD (`$hud`) reads these state files to display the current mode, phase, and iteration in the statusline.

State files live under `.omghc/state/<scope>/`. Scoping is per-session when a session id is available, else root-scoped.

## Skill catalogue (v0.1.0)

All 21 skills ported from oh-my-codex (OMX) v0.15.1 and adapted to Copilot CLI semantics.

### Execution loops

- **`ralph`** — Self-referential loop until task completion with architect verification. Use when a task must be guaranteed-complete with fresh evidence and a deslop pass before exit.
- **`autopilot`** — Full autonomous execution from idea to working code. Five phases: expansion → planning → execution → QA → multi-perspective validation.
- **`pipeline`** — Configurable pipeline orchestrator that sequences stages (`ralplan → team-exec → ralph-verify`) through a uniform `PipelineStage` interface, with resume from `pipeline-state.json`.

### Planning & analysis

- **`plan`** — Strategic planning with optional interview workflow. Use to scope work before committing to execution.
- **`ralplan`** — Alias for `$plan --consensus`. Multi-agent (planner / architect / critic) consensus planning before handoff to ralph or team.
- **`deep-interview`** — Socratic deep interview with mathematical ambiguity gating. Closes requirements gaps before any execution loop starts.
- **`analyze`** — Read-only deep repository analysis. Returns ranked synthesis with explicit confidence scores and evidence-vs-inference labels.
- **`brainstorm`** — Used during early ideation; produces structured option lists with tradeoffs.

### Coordination

- **`team`** — N coordinated tmux workers on a shared task list. macOS / Linux only. See `omghc team` CLI in [getting-started.md](./getting-started.md).
- **`worker`** — Team worker protocol (ACK, mailbox, task lifecycle) for tmux-based OMGHC teams. Loaded by worker panes, not invoked directly by leaders.

### Quality

- **`code-review`** — Comprehensive code review against a checklist (correctness, security, style, tests). Routes severity-bucketed issues back to the agent.
- **`tdd`** — Test-Driven Development enforcement: write tests first, run them red, implement to green, refactor, verify >=80% coverage.
- **`build-fix`** — Fix build and TypeScript errors with minimal changes. Surgical, no incidental refactors.
- **`ai-slop-cleaner`** — Anti-slop cleanup / deslop workflow. Run after generation passes to remove placeholder, half-baked, or speculative code.

### Lifecycle

- **`omghc-setup`** — Setup and configure oh-my-ghcopilot using current CLI behavior. Mirrors `omghc setup` semantics for skill-driven flows.
- **`doctor`** — Diagnose and fix oh-my-ghcopilot installation issues (plugin cache, hooks, AGENTS.md, auth, legacy paths). Mirrors `omghc doctor`.
- **`cancel`** — Cancel any active OMGHC mode (autopilot, ralph, ultrawork, ecomode, ultraqa, swarm, ultrapilot, pipeline, team). Calls `state_clear` for the active mode.
- **`git-master`** — Git expert for atomic commits, rebasing, and history management. Used after work blocks to produce clean commit chains.

### Knowledge

- **`note`** — Save notes to `notepad.md` for compaction resilience. Survives Copilot session compaction so durable context isn't lost.
- **`wiki`** — Persistent markdown project wiki under `.omghc/wiki/` with keyword search and lifecycle capture. Cross-session knowledge base.
- **`hud`** — Show or configure the OMGHC HUD (two-layer statusline). Reflects active mode, iteration, and team status.
- **`help`** — Guide on using oh-my-ghcopilot plugin. Lists available skills, common entrypoints, and links to docs.

## Composition patterns

Common skill chains used in real sessions:

```
deep-interview --quick → ralplan → autopilot
```

Use when input is too vague: ambiguity-gated clarification feeds consensus planning, which feeds autonomous execution.

```
plan → ralph
```

Use for focused single-thread work: plan the change, then loop until verified.

```
plan → team N:executor → ralph (verification)
```

Use for parallelizable work that needs a final single-owner verification pass.

```
$ralph ... --no-deslop
```

Skip the mandatory deslop step (Step 7.5 in ralph) when downstream cleanup is handled separately.

## Adding a skill

1. Create `skills/<name>/SKILL.md` with valid frontmatter (`name`, `description`).
2. Write the body using OMGHC's tag conventions (`<Purpose>`, `<Steps>`, `<Tool_Usage>`, etc.).
3. Run `npm run sync:plugin` to mirror the skill into `plugins/oh-my-ghcopilot/skills/`.
4. Run `npm run verify:plugin-bundle` to confirm parity.
5. Restart your Copilot CLI session; the new keyword is available.
