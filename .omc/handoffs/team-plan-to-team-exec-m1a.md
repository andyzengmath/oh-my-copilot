## Handoff: team-plan → team-exec (M1a — foundation)

- **Decided**: Scope this team to the **foundation** of M1: skills port (21), prompts port (33), templates (4), agent-markdown generator (NEW), catalog reader (NEW), and the M0 spike for `copilot login --status`. Defer setup.ts (large), doctor (depends on auth shape), uninstall, list, update to a follow-up team `omghc-port-m1b`.
- **Rejected**: (1) All of M1 in one team — setup.ts is 3,094-LOC equivalent and pairs poorly with the rest; (2) per-skill task granularity (21 separate tasks) — too much TaskCreate overhead, batching of 7 skills/worker is more efficient; (3) Skipping the M1a auth spike — gates doctor's design and worker-bootstrap design (M3); cheap to do now while Copilot CLI is installed.
- **Risks**: 
  - M1a foundation gates everything in M1b (setup.ts depends on catalog reader + agent generator + templates). Any defect in M1a forces revisions in M1b.
  - 33 prompts need rename pass (Codex→Copilot, omx→omghc). Some prompt content is OpenAI-specific and may need semantic rewrite, not pure substitution.
  - The M0-stamped spike runs locally on Windows; behavior of `copilot login --status` may differ on Linux/macOS. Document caveats in docs/auth.md.
- **Files**:
  - Source (read-only): `C:\Users\andyzeng\OneDrive - Microsoft\Documents\GitHub\oh-my-codex\{skills,prompts,templates}\`
  - Target: `oh-my-copilot/{skills,prompts,agents,templates,docs}/` and `oh-my-copilot/src/{agents,catalog}/`
- **Remaining (this team's scope)**:

| ID | Task | Owner | Files | Depends |
|----|------|-------|-------|---------|
| 1 | Skills batch A (7) — ralph, ralplan, team, deep-interview, autopilot, plan, code-review | worker-1 | `skills/<name>/SKILL.md` × 7 | — |
| 2 | Skills batch B (7) — tdd, doctor, omghc-setup (renamed from omx-setup), worker, pipeline, hud, wiki | worker-2 | `skills/<name>/SKILL.md` × 7 | — |
| 3 | Skills batch C (7) — cancel, help, note, git-master, analyze, build-fix, ai-slop-cleaner | worker-3 | `skills/<name>/SKILL.md` × 7 | — |
| 4 | Prompts port (all 33) | worker-3 | `prompts/*.md` × 33 | — |
| 5 | templates/AGENTS.md (port from OMX, swap markers to OMGHC) | worker-4 | `templates/AGENTS.md` | — |
| 6 | templates/instructions.md.tmpl (NEW, Copilot-flavored) | worker-4 | `templates/instructions.md.tmpl` | — |
| 7 | templates/settings.seed.json (NEW, Copilot settings stub) | worker-4 | `templates/settings.seed.json` | — |
| 8 | templates/catalog-manifest.json (port from OMX) | worker-4 | `templates/catalog-manifest.json` | — |
| 9 | src/agents/generateAgentMarkdown.ts (NEW agent .md frontmatter generator) | worker-5 | `src/agents/generateAgentMarkdown.ts` | — |
| 10 | src/catalog/reader.ts (skill+prompt+agent registry reader) | worker-5 | `src/catalog/reader.ts` | 9 |
| 11 | src/agents/__tests__/generator.test.ts | worker-5 | test file | 9 |
| 12 | src/catalog/__tests__/reader.test.ts | worker-5 | test file | 10 |
| 13 | Spike: confirm `copilot login --status` exact behavior; document in docs/auth.md | worker-5 | `docs/auth.md` | — |

- **Remaining (next team — M1b)**: src/cli/setup.ts (large), src/cli/doctor.ts (with auth checks per §A), src/cli/uninstall.ts, src/cli/list.ts, src/cli/update.ts, integration tests for setup, finalize-mcp subcommand.
