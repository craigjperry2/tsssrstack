# pstack for Claude Code

This directory holds the notes for a Claude Code port of [pstack](https://github.com/cursor/plugins/tree/main/pstack), Lauren Tan's (poteto's) Cursor plugin. The port is taken from upstream commit `df58112` (2026-10-05, plugin version 0.15.15). pstack is MIT licensed. See [`LICENSE`](./LICENSE).

pstack is a set of skills for rigorous agent work. You describe a goal and a check, `/poteto-mode` matches the task to a playbook, and the playbook routes to the other skills (`/how`, `/why`, `/architect`, `/arena`, `/swarm`, `/interrogate`, `/tdd`, `/unslop`, `/no-comments`, and the `principle-*` skills) as its steps need them.

## Layout

| Path | Contents |
|---|---|
| `.claude/skills/` | 50 skills: `poteto-mode` with its 23 playbooks, references, and scripts, the workflow skills, and 24 `principle-*` skills. |
| `.claude/agents/` | `poteto-agent` (playbook delegate), `comment-sicko` (used by `/no-comments`), `pstack-reader` (read-only worker for explorers, reviewers, and judges). |
| `.claude/output-styles/poteto.md` | The **Poteto** output style, which keeps poteto-mode on across turns. |
| `.claude/pstack/guide/` | The upstream user guide, adapted. Start at [`guide/README.md`](./guide/README.md). |

## Get started

1. Start Claude Code in this repository and type `/`. `/poteto-mode`, `/setup-pstack`, and `/poteto-help` should be listed.
2. Run `/setup-pstack` to choose models per role. It writes `.claude/pstack-models.md`. Without it, code roles use `sonnet` and judgment roles use `opus`.
3. Start a task: `/poteto-mode the task list loses its sort after a delete. repro first, then fix and verify.`
4. Optional: run `/output-style` and pick **Poteto** to keep the mode on for the whole session.

Ask `/poteto-help` when you're unsure which skill fits.

## What changed from the Cursor original

| Cursor pstack | This port |
|---|---|
| `Task` tool, `subagent_type: generalPurpose` | `Agent` tool, `general-purpose` or `poteto-agent` |
| `readonly: true` (which strips MCP) | `subagent_type: pstack-reader`, which blocks edits and keeps MCP |
| `environment: "cloud"`, `cloud_base_branch` | `isolation: "worktree"` (or `"remote"`) plus `run_in_background`. Workers fetch their branch themselves. |
| Nested subagents (depth 3) | Not supported in Claude Code. Fan-out runs from the main session. Sub-coordinators and long-lived PR owners become separate sessions (`claude -p` or cloud sessions). |
| Models `claude-opus-5-5-xhigh` and `grok-4.7-xhigh-fast` | `opus` and `sonnet`. Effort goes in the Agent tool's `effort` parameter when present. Review panels mix `opus` and `sonnet`, which is less diverse than Claude versus Grok. |
| `~/.cursor/rules/pstack-models.mdc` | `.claude/pstack-models.md`, else `~/.claude/pstack-models.md`. `auto` and `inherit-parent` became `inherit`. |
| Custom Mode (Option+Enter) | The **Poteto** output style |
| `AskQuestion` | `AskUserQuestion` |
| `~/.cursor/projects/<slug>/agent-transcripts/` | `~/.claude/projects/<slug>/<session-id>.jsonl` |
| `/deslop` from `cursor-team-kit` | Built-in `/simplify` |
| `control-ui`, `control-cli` from `cursor-team-kit` | A project `verify-*` skill (make one with `/create-verification-skill`), Playwright, or Bash |
| Cursor's `create-skill` | Anthropic's `skill-creator` skill when installed, otherwise Claude Code's SKILL.md format |
| Bugbot triage | Review-bot triage, for Claude Code Review, Bugbot, Copilot, and security reviewers |
| Bun scripts (`watch-pr`, `orch`, `check-plan`) | Deno ports with their own `deno.json` in `skills/poteto-mode/scripts/`. The upstream tests pass under `deno task test`. |
| Cursor Projects, cloud agent dashboard | Coordinator sessions, `claude --resume`, cloud sessions |

Repository-specific additions: poteto-mode has a **This repository** section that points at `AGENTS.md` and the Deno check commands, and says to use the GitHub MCP tools where `gh` is missing.

## Not ported

- `/make-bot-ui`. It builds UIs that wake a Cursor Grok Bot over a Cursor Automations webhook.
- `automations/benny`, the Slack issue-triage and repro automation pack. It depends on Cursor Automations. Claude Code Routines or the Claude Code GitHub Action are the place to rebuild it.
- The guide's illustrations.

## Updating from upstream

Diff the upstream `pstack/skills` tree against the commit above, then port each change through the mapping table. Keep the skill prose otherwise verbatim, so later upstream diffs stay easy to apply.
