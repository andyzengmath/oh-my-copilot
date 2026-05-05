# oh-my-ghcopilot (OMGHC)

> Harness-engineering plugin for GitHub Copilot CLI — analogue of oh-my-codex (OMX) for OpenAI Codex CLI.

**Status:** v0.0.1 — early scaffold (M0). Not yet usable. See [.omc/plans/2026-05-05-port-omx-to-copilot.md](.omc/plans/2026-05-05-port-omx-to-copilot.md) for the implementation plan.

## What this will be

OMGHC layers harness-engineering primitives on top of GitHub Copilot CLI, mirroring what
[oh-my-codex (OMX)](https://github.com/Yeachan-Heo/oh-my-codex) provides for OpenAI Codex CLI.
Headline features (planned across milestones M1–M5):

- **Skills** — invocable workflows like `$ralph` (self-referential improvement loop),
  `$team` (parallel multi-agent runtime), and `$ralplan` (consensus planning gate).
- **Parallel team runtime** — N coordinated worker agents on a shared task list,
  driven from the Copilot CLI surface.
- **MCP server bundle** — curated set of Model Context Protocol servers wired in by default.
- **Hooks** — PreToolUse / PostToolUse / Stop lifecycle hooks for guardrails, formatting,
  and verification.

## Why a separate project

GitHub Copilot CLI's plugin model is distinct from Codex CLI's: different config schema,
different tool surface, different lifecycle. Rather than fork OMX and bend it sideways,
OMGHC ports the harness-engineering layer cleanly onto Copilot's surface so each side can
evolve at its own pace.

## Disclaimer

Independent project, not affiliated with GitHub or Microsoft.

## License

MIT — see [LICENSE](./LICENSE). Inspired by [oh-my-codex](https://github.com/Yeachan-Heo/oh-my-codex), also MIT.
