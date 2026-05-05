## Handoff: team-plan → team-exec

- **Decided**: Skip team-prd (PRD already exists as the consensus-approved plan). M0 is the only phase in this session — small (13 file-scoped tasks), greenfield, low conflict. Use 3 parallel workers + lead-as-verifier.
- **Rejected**: (1) Lead-as-executor — violates skill discipline; workers must do the writes. (2) Single-worker sequential — wastes parallelism for clearly independent files. (3) Running M0–M4 in one team session — unrealistic for ~7 weeks of work; this team is M0-only.
- **Risks**: M0 tasks may collide on `package.json` and `tsconfig.json` settings if workers don't read the plan first. Mitigate via task descriptions that quote exact required content from §M0 acceptance criteria.
- **Files** (created during plan + this handoff): `.omc/plans/2026-05-05-port-omx-to-copilot.md` (v2 with ADR), `.omc/handoffs/team-plan-to-team-exec.md`
- **Remaining**: M1 (skills + setup + doctor), M2 (hooks + state + MCP), M3 (team runtime), M4 (plugin + polish). Each will spawn its own team in subsequent sessions per the staged pipeline.

### M0 Task Decomposition (13 tasks, 3 workers)

| ID | File | Worker | Depends on |
|----|------|--------|------------|
| 1 | package.json | worker-1 | — |
| 2 | tsconfig.json + tsconfig.no-unused.json | worker-2 | — |
| 3 | biome.json | worker-2 | — |
| 4 | .gitignore | worker-2 | — |
| 5 | LICENSE (MIT) | worker-2 | — |
| 6 | README.md | worker-2 | — |
| 7 | src/cli/omghc.ts (bin entry) | worker-1 | 1, 2 |
| 8 | src/cli/index.ts (dispatcher skeleton) | worker-1 | 2 |
| 9 | src/cli/version.ts | worker-3 | 2 |
| 10 | src/cli/help.ts | worker-3 | 2 |
| 11 | src/cli/status.ts | worker-3 | 2 |
| 12 | .github/workflows/ci.yml | worker-3 | 1 |
| 13 | src/cli/__tests__/omghc-smoke.test.ts | worker-3 | 7, 8, 9 |

Lead handles M0 verification (`npm install && npm run build && node dist/cli/omghc.js version`) after tasks 1-13 complete.
