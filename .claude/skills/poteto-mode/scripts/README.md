# poteto-mode scripts

Deno ports of the bun scripts that ship with upstream pstack. They are agent tooling, not application code, so they keep their own `deno.json` and the root `deno.json` excludes `.claude/`.

| Script | Used by | Run |
|---|---|---|
| `watch-pr/watch-pr` | Babysit, Shipping | `.claude/skills/poteto-mode/scripts/watch-pr/watch-pr --help` (needs `gh`) |
| `orch/orch` | Orchestrate | `ORCH_STORE=<dir> .claude/skills/poteto-mode/scripts/orch/orch --help` |
| `check-plan.mjs` | Multi-phase plan | `deno run --allow-read --no-lock .claude/skills/poteto-mode/scripts/check-plan.mjs <plan.md>` |
| `worktree-audit.sh` | Worktree cleanup | `.claude/skills/poteto-mode/scripts/worktree-audit.sh` (needs `rg`, `jq`, `gh`; macOS `stat`/`date` flags) |

Checks, from this directory:

```bash
deno task check
deno task test
```

The wrappers pass `--no-lock` so running them never touches the root `deno.lock`.
