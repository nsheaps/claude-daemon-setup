# config isolation

- root: `~/.claude-daemon/` — everything the daemon owns lives under here, nothing touches the interactive user's `~/.claude`.
- confirmed live on this host: `env` blocks in `~/.claude/settings.json` (e.g. a custom `ANTHROPIC_BASE_URL` gateway) leak into every session unless user-scope settings are excluded — see `docs/research/host-setup-notes.md` §3. The daemon must never inherit user-scope settings.
- **mechanism: pure env vars, no CLI flag.** An earlier draft of this spec relied on `claude --setting-sources project,local` to dodge the leak above. That's dropped — ported instead from `nsheaps/agents`' `apps/agent-cli/lib/agent-env.sh`, the org's actual proven per-agent isolation mechanism (real code, not a draft). `CLAUDE_CONFIG_DIR` pointing at a root that has never seen the user's gateway config achieves the same isolation without depending on a flag's exact semantics.

## env vars the service process sets

Implemented in `src/lib/config-isolation.ts`'s `buildIsolatedEnv()`, mirroring `agent-env.sh`'s XDG layout (`GH_CONFIG_DIR`/`GIT_CONFIG_GLOBAL` nest *under* `XDG_CONFIG_HOME`, matching what XDG-aware and non-XDG-aware tools both expect; `CLAUDE_CONFIG_DIR` stays a direct sibling, same as `agent-env.sh`'s `$AGENT_HOME_DIR/.claude`):

```
CLAUDE_CONFIG_DIR=~/.claude-daemon/claude              # proven — Claude Code's own config root override
XDG_CONFIG_HOME=~/.claude-daemon/xdg/config
XDG_DATA_HOME=~/.claude-daemon/xdg/data
XDG_STATE_HOME=~/.claude-daemon/xdg/state
XDG_CACHE_HOME=~/.claude-daemon/xdg/cache
XDG_CONFIG_DIRS=$XDG_CONFIG_HOME:/etc/xdg              # prepended, system defaults remain fallback
XDG_DATA_DIRS=$XDG_DATA_HOME:/usr/local/share:/usr/share
GH_CONFIG_DIR=$XDG_CONFIG_HOME/gh                      # gh CLI config isolation
GIT_CONFIG_GLOBAL=$XDG_CONFIG_HOME/git/config          # git global config isolation, keeps ~/.gitconfig untouched
DISABLE_AUTOUPDATER=1                                  # daemon's own auto-update.ts owns binary updates
CLAUDE_CODE_ATTRIBUTION_HEADER=0
CLAUDE_CODE_TASK_LIST_ID=<agent.name>                  # continuity across restarts/reconnects
```

- deliberately NOT set: `HOME`, `GIT_COMMITTER_*`. Commits made by the daemon must still be attributable to the logged-in macOS user — see below.
- deliberately NOT copied from `agent-env.sh`: `CLAUDE_AUTO_BACKGROUND_TASKS`, `FORCE_AUTOUPDATE_PLUGINS`, and a few others — those are `nsheaps/agents`-specific policy choices, not isolation mechanics. Only vars with a direct isolation or continuity justification were adopted.

## known, accepted limitation

- `CLAUDE_CONFIG_DIR` does not stop `CLAUDE.md` memory-file discovery, which recurses upward from the working directory to `/` regardless of config root. A daemon session run inside the interactive user's repos will still pick up their project/user `CLAUDE.md` files. Not solved in MVP — the daemon's working directory should default to a dedicated scratch/checkout under `~/.claude-daemon/` specifically to minimize this, but it is not a hard guarantee. Document this in [[../getting-started|getting started docs]] as a caveat, not a bug.

## identity split: isolated tool config, human or bot identity

- `git`: global config at `$GIT_CONFIG_GLOBAL` sets `user.name`/`user.email`, either copied from the invoking user's existing `~/.gitconfig` at first-run (default — commits attributed to the real person) or, if the `git-credentials-setup` skill configures GitHub App mode, the bot identity instead. Every other git setting (aliases, credential helpers, etc.) stays isolated either way.
- `gh`: `$GH_CONFIG_DIR` starts empty; setup (via `git-credentials-setup`, see below) picks exactly one of: `gh auth login` (personal account) or a GitHub App installation token set as `GH_TOKEN`. Never both — `GH_TOKEN` silently wins over `gh auth login` state and defeats the isolation's purpose of scoping token lifetime.
- `claude`: fully isolated auth under `CLAUDE_CONFIG_DIR` — `claude-login-setup` runs `claude auth login` once, interactively, during setup.

## setup skills

`claude-daemon setup` does not implement credential flows itself — each is its own `context: fork` skill under this repo's `.claude/skills/`, invoked by handing off to a real interactive `claude` session (`claude "<prompt>"`) running inside the isolated env once `CLAUDE_CONFIG_DIR` etc. are set. Forking keeps each flow's back-and-forth (browser OAuth, pasting a token, walking a web console) out of the parent setup session's context.

- **`claude-login-setup`** — `claude auth login` / `claude auth status`, confirms the account's plan supports Remote Control (Pro/Max/Team/Enterprise; API keys are not supported).
- **`git-credentials-setup`** — seeds git identity, then asks the human to choose personal `gh auth login` vs. a GitHub App installation token. **Creating a new GitHub App is a human-only, web-console task** — no CLI/API can do it (confirmed against `nsheaps/agents`' `docs/runbooks/create-github-app.md`, itself `audience: human`). The skill can consume an *existing* App's credentials and generate installation tokens, but cannot provision the App itself.
- **`1password-vault-setup`** — `op vault create` + `op item create` (both real, CLI-automatable) for a per-instance vault + `ENVIRONMENT` aggregator item, following `nsheaps/agents`' `docs/runbooks/create-1password-vault-and-service-account.md`. **1Password service-account creation cannot be CLI/API-automated** — confirmed by that org's own vetted research (`docs/research/1password-secrets-sync.md`: "Human Decisions Required: Create 1Password Service Account... Who: Repo owner") — the token is shown once, only via the web admin console. The skill walks the human through those steps and stores the resulting `ops_...` token in the isolated `CLAUDE_CONFIG_DIR/settings.local.json`, matching the org's proven pattern of never putting it in a shared, non-isolated settings file.

These two "cannot automate" facts are load-bearing design constraints, not gaps to route around — the original request asked for "a new vault and service account via cli"; the vault half is CLI-automatable, the service-account half is not, by 1Password's own design (the token can only be displayed once, at creation, via the console).

## `.env` loading

`~/.claude-daemon/.env`, if present, is loaded via the `dotenv` package before anything else runs (`cli.ts`'s first statement) — the place an operator drops secrets (`OP_SERVICE_ACCOUNT_TOKEN`, `GITHUB_APP_PRIVATE_KEY`, etc.) for this daemon instance specifically. `quiet: true` — a missing file is the common/expected case, not a warning.

## packaging seam (not yet wired)

`src/lib/bundled-skills.ts` resolves these three skills via `CLAUDE_DAEMON_SKILLS_DIR` (packaged-install path, not yet set by anything) with a dev-mode fallback that only works running from a checkout. [[release-packaging]]'s Formula needs to install `.claude/skills/` alongside the binary and set that env var in the launchd plist — tracked there, not solved here.

## open / untested (must verify before spec moves to `reviewed/`)

- does Claude Code honor `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` env vars, or does it shell out to `git commit` and rely purely on `GIT_CONFIG_GLOBAL`? Affects whether the identity-split above needs an extra env pair.
- the GitHub App installation-token exchange (JWT-sign App ID + private key, exchange for a 1-hour token) has no automated implementation yet — `git-credentials-setup` currently tells the human this step isn't automated in this scaffold rather than faking it.
