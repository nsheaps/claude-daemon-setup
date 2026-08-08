# daemon-agent-template

- new repo `nsheaps/daemon-agent-template`, marked as a GitHub template repo (`is_template: true`).
- modeled on `nsheaps-ai-workspace` layout (`docs/research/patterns-agent-workspace.md`), trimmed to what [[settings-repo-sync]] actually consumes:
  - `agent.yaml` at root (schema defined in [[settings-repo-sync]]).
  - `.claude/skills/`, `.claude/agents/`, `.claude/rules/` — one item per subdirectory, matching the 1-level-deep symlink constraint.
  - `README.md` explaining "this is what you fork to create `CLAUDE_DAEMON_SETTINGS_REPO`".
- ships one example skill/agent/rule as a working reference, not just empty dirs — an empty template teaches nothing about the shape Claude Code expects.
- CI: minimal — lint `agent.yaml` against the schema, validate `.claude/**` structure (depth check), nothing else. This repo has no binary, no release pipeline of its own.
