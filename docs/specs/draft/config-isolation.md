# config isolation

- root: `~/.claude-daemon/` — everything the daemon owns lives under here, nothing touches the interactive user's `~/.claude`.
- confirmed live on this host: `env` blocks in `~/.claude/settings.json` (e.g. a custom `ANTHROPIC_BASE_URL` gateway) leak into every session unless user-scope settings are excluded — see `docs/research/host-setup-notes.md` §3. The daemon must never inherit user-scope settings.

## env vars the service process sets

```
CLAUDE_CONFIG_DIR=~/.claude-daemon/claude     # proven — Claude Code's own config root override
GH_CONFIG_DIR=~/.claude-daemon/gh             # gh CLI config isolation
GIT_CONFIG_GLOBAL=~/.claude-daemon/gitconfig  # git global config isolation, keeps ~/.gitconfig untouched
XDG_CONFIG_HOME=~/.claude-daemon/xdg/config
XDG_DATA_HOME=~/.claude-daemon/xdg/data
XDG_STATE_HOME=~/.claude-daemon/xdg/state
XDG_CACHE_HOME=~/.claude-daemon/xdg/cache
```

- deliberately NOT set: `HOME`, `GIT_COMMITTER_*`. Commits made by the daemon must still be attributable to the logged-in macOS user — see below.
- claude CLI invocation always includes `--setting-sources project,local` (excludes user scope) as belt-and-suspenders on top of `CLAUDE_CONFIG_DIR`.

## known, accepted limitation

- `CLAUDE_CONFIG_DIR` does not stop `CLAUDE.md` memory-file discovery, which recurses upward from the working directory to `/` regardless of config root. A daemon session run inside the interactive user's repos will still pick up their project/user `CLAUDE.md` files. Not solved in MVP — the daemon's working directory should default to a dedicated scratch/checkout under `~/.claude-daemon/` specifically to minimize this, but it is not a hard guarantee. Document this in [[../getting-started|getting started docs]] as a caveat, not a bug.

## identity split: isolated tool config, shared human identity

- `git`: global config at `$GIT_CONFIG_GLOBAL` sets `user.name`/`user.email` explicitly copied from the invoking user's existing `~/.gitconfig` at first-run (read once, written into the isolated config, not re-read live) — so commits are attributed to the real person, while every other git setting (aliases, credential helpers, etc.) stays isolated.
- `gh`: `$GH_CONFIG_DIR` starts empty; first-run requires either `gh auth login` (interactive, during the interactive `<pkg> setup` step — never inside the unattended service) or an inherited token via `GH_TOKEN`. `GH_TOKEN` and `GH_CONFIG_DIR`-based auth must not both be present — `GH_TOKEN` silently wins and defeats the isolation's purpose of scoping token lifetime; setup must pick exactly one path.
- `claude`: fully isolated auth under `CLAUDE_CONFIG_DIR` — first-run runs `claude auth login` once, interactively, during setup.

## open / untested (must verify before spec moves to `reviewed/`)

- does Claude Code honor `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env vars, or does it shell out to `git commit` and rely purely on `GIT_CONFIG_GLOBAL`? Affects whether the identity-split above needs an extra env pair.
