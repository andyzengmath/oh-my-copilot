---
name: autoresearch
description: Stateful validator-gated research loop with native-hook persistence
---

# Autoresearch

Autoresearch is a skill-first stateful research workflow. It runs the measured-research loop as a native-hook stateful workflow rather than a direct CLI surface — there is no `omghc autoresearch` command. Activation goes through `$autoresearch` in a Copilot session.

## Use when
- You want a Ralph-ish persistent research loop
- The task should keep nudging until explicit validation evidence exists
- You want init-time choice between script validation and prompt+architect validation

## Do not use when
- You want detached tmux or split-pane launch parity (use `$team` for that)
- You have not decided the validation regime yet (run `$deep-interview --autoresearch` first)

## Core contract
1. **Init chooses validation mode.** Pick exactly one:
   - `mission-validator-script`
   - `prompt-architect-artifact`
2. **Persist mode state** in `.omghc/state/autoresearch-state.json` via `omghc_state` MCP, including:
   - `validation_mode`
   - `completion_artifact_path`
   - `mission_validator_command` **or** `validator_prompt`
   - optional `output_artifact_path`
3. **Completion is artifact-gated.** The loop does not stop because the model says "done", because a stop hook fired once, or because several turns were no-ops.
4. **Skill-only surface.** Use `$deep-interview --autoresearch` for intake and `$autoresearch` for execution.

## Completion artifact contract

### `mission-validator-script`
The completion artifact must exist and record a passing validator result, for example:

```json
{
  "status": "passed",
  "passed": true,
  "summary": "metric improved beyond baseline"
}
```

### `prompt-architect-artifact`
The completion artifact must include both an architect approval verdict and an output artifact path, for example:

```json
{
  "validator_prompt": "Review the research output against the mission.",
  "architect_review": { "verdict": "approved" },
  "output_artifact_path": ".omghc/specs/autoresearch-demo/report.md"
}
```

## Recommended flow
1. Run `$deep-interview --autoresearch` to clarify mission + evaluator.
2. Materialize `.omghc/specs/autoresearch-{slug}/mission.md`, `sandbox.md`, and `result.json`.
3. Start `$autoresearch` with the chosen validation mode stored in mode state.
4. Let the agent (and, when Copilot CLI wires hook execution, the `sessionEnd` resume hint via `omghc continue`) drive iterations until the completion artifact satisfies the chosen validation mode.
5. Finish only after the validator artifact is complete.

## State management

Use `omghc_state` MCP tools for autoresearch lifecycle state.

- **On start:**
  `state_write({mode: "autoresearch", active: true, current_phase: "init", iteration: 1, started_at: "<now>"})`
- **On each cycle:**
  `state_write({mode: "autoresearch", current_phase: "<phase>", iteration: <n>})`
- **On completion (validator passed):**
  `state_write({mode: "autoresearch", active: false, current_phase: "complete", completed_at: "<now>"})`
- **On cancellation/cleanup:**
  run `$cancel` or `state_clear({mode: "autoresearch"})`

## Forward-compat note

In Copilot CLI v1.0.40, file-based hooks DO NOT FIRE (R-hooks-not-wired). The `sessionEnd` → resume-hint → `omghc continue` flow is forward-compat and only activates when Copilot wires `Session.hooks` to `preToolsExecution`. Until then, run `omghc continue` manually after a session restart, or invoke `$autoresearch` again to resume from persisted state.
