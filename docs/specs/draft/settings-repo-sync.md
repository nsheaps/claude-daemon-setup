# settings repo sync

- `CLAUDE_DAEMON_SETTINGS_REPO` — required env var, a git remote URL (or `owner/repo` shorthand for GitHub). Service exits non-zero immediately if unset — no silent default, see [[daemon-service]].
- on start: clone or fast-forward pull into `~/.claude-daemon/config-repo/`.
- that repo is expected to look like `nsheaps/daemon-agent-template` (see [[daemon-agent-template]]): an `agent.yaml` at the root plus `.claude/{skills,agents,rules}/`.

## `agent.yaml` (schema owned by this repo — no prior art)

```yaml
agent:
  name: my-agent          # required. becomes the service label + Remote Control session name.
  description: ""         # optional, free text.
```

- service/launchd label derived as `com.nsheaps.claude-daemon.<agent.name>` (slugified: lowercase, `[a-z0-9-]` only).
- `claude remote-control --name "<agent.name>"` if/when that flag ships (currently absent on 2.1.220, see `docs/research/remote-control-mechanism.md` — verify before wiring, fall back to default session naming otherwise).

## skills/agents/rules injection — the 1-level-deep constraint

- Claude Code only discovers skills one directory level deep under `.claude/skills/<skill-name>/`. A settings repo can't just be symlinked wholesale into `~/.claude-daemon/claude/skills/` if it nests things differently, and a single symlink swap breaks if the settings repo changes shape.
- mechanism: the daemon owns `~/.claude-daemon/claude/{skills,agents,rules}/` as real directories, populated with **one symlink per item**, pointing back into `~/.claude-daemon/config-repo/.claude/{skills,agents,rules}/<item>`. Not a directory-level symlink.
- `~/.claude-daemon/claude/**` (the symlink farm) is daemon-managed and gitignored in the settings repo — it is generated, not committed.
- resync happens every time the settings repo is pulled (see [[auto-update]] for cadence): diff the symlink farm against the repo's current top-level items, add/remove symlinks accordingly, never touch items the daemon didn't create.
- this diffing logic ships as a **daemon-provided skill** (per the user's explicit ask: "which is something the daemon should have skills for") — e.g. `sync-settings-repo` — rather than being buried in the service binary, so it's independently testable and so a running `claude` session can re-trigger it on demand.

## open questions

- does a settings repo's `.claude/rules/*.md` need any transformation, or is a straight symlink sufficient given rules are just markdown Claude reads at startup? assume straight symlink until proven otherwise.
