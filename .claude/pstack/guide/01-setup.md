# Set up pstack

In this page you check the skills are installed, pick which models pstack uses, and run your first task. Setup is one command plus a short conversation.

## Install the skills

This repository already carries pstack under `.claude/`. Claude Code loads project skills from `.claude/skills/`, subagents from `.claude/agents/`, and output styles from `.claude/output-styles/` when you start a session in the repo. Type `/` and check that `/poteto-mode` and `/setup-pstack` are listed. To use pstack in another repository, copy those three directories, or put them under `~/.claude/` for every project.

## Pick your models

Run:

```text
/setup-pstack
```

[`/setup-pstack`](../../skills/setup-pstack/SKILL.md) reads the model aliases the `Agent` tool accepts (`opus`, `sonnet`, `haiku`, and any others it lists), asks for a reasoning budget, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions. It writes `.claude/pstack-models.md` in the project (or `~/.claude/pstack-models.md` for every project), a small file every pstack skill reads before it spawns a subagent.

The defaults are `sonnet` for code roles and `opus` for judgment and prose, at `xhigh` effort where the Agent tool takes an effort level. That matches the `large` budget. `unlimited` runs every role on `opus` at `max`. `medium` and `small` lower the effort and use cheaper models, and spend fewer tokens.

You only override what you care about. A role with no line in the config keeps the skill's default. To restore a default, delete that role's line. A rerun of `/setup-pstack` keeps any role whose model differs from the default. When a default changes, a config written before the change still pins the old default, so delete those role lines, or delete the file, then run `/setup-pstack` again.

To run a role on your session's own model, set it to `inherit`. pstack then omits the subagent `model` field, so the subagent inherits the parent model. For a panel role the value is a list, and one subagent runs per entry, so the list length sets the panel size. Setup also configures `swarm workers`, the default model for every `/swarm` worker unless a race names a model for each arm.

## Accept the verification offer, or don't

At the end of setup, `/setup-pstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.claude/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers it in depth.

If you're new to pstack, say yes. An agent that can check its own work keeps going until the check passes. An agent that can't hands every result back to you to check by hand. Of everything in this guide, the verification skill pays off the most.

Skills read the config on every spawn, so the change applies at once.

## Keep the cost in check

pstack spends extra tokens on subagents and review panels. That's the price of the rigor. To spend fewer:

- Rerun `/setup-pstack` and pick a smaller reasoning budget or cheaper models. A strong model in the main chat with cheaper, faster models in the code roles is a good split.
- Set a role to `inherit` so it runs on the session's own model.
- Shorten a panel list. Each entry runs one subagent.
- Save `/poteto-mode` for work that needs rigor. A small, obvious edit doesn't.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/poteto-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. To keep `/poteto-mode` on for the whole session, switch to the **Poteto** output style (`/output-style`, or `"outputStyle": "Poteto"` in `.claude/settings.local.json`). It is the Claude Code stand-in for a Cursor Custom Mode. It stays in the system prompt on every turn, applies the mode when a playbook matches, and stays out of casual turns. Plain `/poteto-mode` attaches the skill to one message, and it fades as the session moves on.

Next: [Route work through `/poteto-mode`](./02-poteto-mode.md).
