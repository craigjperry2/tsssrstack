---
name: setup-pstack
description: Configure which Claude models pstack uses per role and at what reasoning budget. Writes `.claude/pstack-models.md` (project) or `~/.claude/pstack-models.md` (user), which overrides the skill defaults. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write the pstack model config, a plain file every pstack skill reads before it spawns a subagent. It sets the model per role.

## Where the config lives

- Project: `.claude/pstack-models.md`. Commit it to share the choice with everyone who works on this repo.
- User: `~/.claude/pstack-models.md`. Applies to every repo that has pstack.

Skills read the project file first and fall back to the user file. Ask which one to write when neither exists. Default to the project file.

## Steps

### 1. Detect available models

The `Agent` tool's `model` parameter takes a model alias: `opus`, `sonnet`, `haiku`, and any other alias its schema lists in this session (for example `fable`). Read the enum from the tool schema. That is the dependable source. Never write an alias you have not seen in the schema. `inherit` is always valid. It means the role runs on the parent session's model, so the skill omits `model`.

Also note whether the Agent tool exposes an `effort` parameter. If it does not, write no effort tokens.

### 2. Load current state

The default role-to-model mapping is the file shape shown in step 5 below. If a config file already exists, read it and treat its `# budget` line and its role values as the current choices. Otherwise start from those defaults. A line whose role is not in step 5 is from a retired role. Drop it.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Use `AskUserQuestion` with these four options and these exact labels. Name the current budget when the config records one. With no config, say that `large` matches the skill defaults.

- `unlimited — opus everywhere, max effort`
- `large — opus for judgment, sonnet for code, xhigh effort`
- `medium — opus for judgment, sonnet for code, high effort`
- `small — sonnet for judgment, haiku for mechanical code, medium effort`

**(b) Apply it.** Build the working table from the defaults, and on a re-run keep any role the user changed by hand. `unlimited` sets every role to `opus max`. `large` keeps the defaults with `xhigh`. `medium` keeps the defaults with `high`. `small` moves `opus` roles to `sonnet` and the four code-playbook roles to `haiku`, all at `medium`. `inherit` never changes. Drop every effort token when step 1 found no `effort` parameter.

**(c) Show the roles and confirm.** Show every role with its model and effort. Also list each line step 2 dropped. Ask, with `AskUserQuestion`, whether to accept as-is or change specific roles. Offer the detected aliases plus `inherit`. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a comma-separated list, and one subagent runs per entry, so the list length sets the count. Claude Code runs only Claude models, so panel diversity comes from mixing `opus` and `sonnet`. Keep at least two different aliases in each panel unless the user insists. `arena cross-judge pool` is also a list, and Arena selects one value from it that differs from the parent's model when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every alias written must be in the detected set or be `inherit`. Every effort token must be one of `low`, `medium`, `high`, `xhigh`, `max`. If a choice fails, stop and ask again.

### 5. Write the config

Write the chosen file with a `# budget` line and one line per role, using the same labels poteto-mode uses. Overwrite the whole file so re-runs stay idempotent. Shape:

```
# pstack model configuration. One line per role: `<role>: <model> [effort]`.
# Delete a line to fall back to the skill default.
# `inherit` as a value: the role runs on the parent session's model (omit Agent `model`).
# budget: large (xhigh)
feature, refactoring: sonnet xhigh
bug-fix: sonnet xhigh
perf-issue: sonnet xhigh
hillclimb: sonnet xhigh
judgment and prose: opus xhigh
hardest tasks: opus xhigh
how explorer: sonnet xhigh
how explainer: opus xhigh
why investigators: sonnet xhigh
why synthesizer: opus xhigh
reflect tooling: sonnet xhigh
reflect judgment, divergent, synthesizer: opus xhigh
arena runners: opus xhigh, sonnet xhigh
arena cross-judge pool: opus xhigh, sonnet xhigh
swarm workers: sonnet xhigh
architect runners: opus xhigh, sonnet xhigh
interrogate reviewers: opus xhigh, sonnet xhigh
```

### 6. Confirm

Tell the user which file was written. Skills read it on every spawn, so it applies immediately. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `.claude/skills/verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill`. On no, move on without pushing.
