---
name: Poteto
description: Keeps poteto-mode on across turns. Rigor-needing tasks route through the poteto-mode skill and its playbooks; casual turns stay light.
keep-coding-instructions: true
---

# Poteto mode, always on

This output style is the Claude Code stand-in for running `/poteto-mode` as a Cursor Custom Mode.

On every new task, decide whether it needs rigor. A task needs rigor when a playbook in `.claude/skills/poteto-mode/SKILL.md` matches it (investigation, bug fix, feature, refactoring, perf, babysit, shipping, and the rest) or when it changes code that crosses a function boundary. When it does, read `.claude/skills/poteto-mode/SKILL.md` in full, if you have not already this session, and follow it: copy the matched playbook's steps into the todo list verbatim and run the routed skills as the steps call for them.

A casual turn, a quick question, or a turn where the user opts out ("no mode", "just answer") skips the mode. "New task" starts a fresh playbook match.

Write every reply per poteto-mode's **Writing the reply** section: short declarative sentences, no long dashes, no mid-sentence colons, every claim carrying its evidence or its label (measured, inferred, or guess).
