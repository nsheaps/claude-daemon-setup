# Patterns: Config Isolation for Agents/Daemons

Scan of `/Users/nathan.heaps/src/nsheaps/*` (2026-08-08) for how an agent process is given a
config identity separate from the interactive user. Only what actually exists is recorded here.

Related: [[patterns-repo-scaffolding]], [[patterns-ci-workflows]]

## TL;DR — what exists vs. what does not

| Concern                     | Exists in nsheaps repos?              | Where                                                                    |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| Claude config isolation      | YES — `CLAUDE_CONFIG_DIR`             | `personal-claude/.envrc`, `personal-claude/bin/claude`                    |
| Claude settings-source lockout | YES — `--setting-sources project,local` | `personal-claude/bin/claude`                                            |
| `CLAUDE_HOME` convention     | YES (but as an alias for `~/.claude`) | `claude-utils/bin/lib/claude.lib.sh:110`, `.claude/bin/swap-source-of-truth:18` |
| XDG base dirs                | Declared only, never overridden       | `dotfiles/_home/zshenv:13-15`                                            |
| `GH_CONFIG_DIR`              | **ABSENT** everywhere                 | —                                                                        |
| `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` | **ABSENT** everywhere    | —                                                                        |
| `HOME=` override for a child process | **ABSENT** everywhere        | —                                                                        |
| launchd/systemd unit with isolated env | **ABSENT** — no `.plist` in any repo | —                                                              |
| Git identity split for agents | Specced, not implemented            | `agent-team/docs/specs/draft/agent-github-auth.md`                        |
| Token-file + credential helper | Specced, not implemented           | `ai-mktpl/docs/specs/draft/github-token-refresh-plugin.md`                |

The new daemon is therefore **extending** the Claude-side pattern into `gh`/`git`, not copying an
existing end-to-end implementation.

---

## 1. Claude config isolation — the one working implementation

`/Users/nathan.heaps/src/nsheaps/personal-claude/.envrc` (entire file):

```bash
#!/usr/bin/env bash

export ORIGINAL_PATH="$PATH"
export PATH="${PWD}/bin:${PATH}"
export ROOT_DIR="${PWD}"

export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$ROOT_DIR/.claude}"
echo "Using CLAUDE_CONFIG_DIR: $CLAUDE_CONFIG_DIR"
```

`/Users/nathan.heaps/src/nsheaps/personal-claude/bin/claude` — a shim earlier on `PATH` that
re-exports the same var and adds the flag, then restores the original `PATH` so it doesn't
recurse into itself:

```bash
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$ROOT_DIR/.claude}"
CLAUDE_FLAGS=(
  --setting-sources project,local
)
exec env PATH="$ORIGINAL_PATH" claude "${CLAUDE_FLAGS[@]}" "$@"
```

Patterns worth reusing verbatim:

- **`${VAR:-default}` everywhere** — the isolated dir is overridable, never hardcoded.
- **`ORIGINAL_PATH` + `exec env PATH="$ORIGINAL_PATH"`** — the shim-on-PATH trick without infinite
  recursion. Directly applicable if the daemon ships its own `bin/claude` wrapper.
- **Belt and suspenders**: `CLAUDE_CONFIG_DIR` (redirect state) *plus* `--setting-sources` (exclude
  user scope). Neither alone is sufficient.

### What `CLAUDE_CONFIG_DIR` actually redirects

From `personal-claude/docs/research/claude-config-isolation.md` (findings, not speculation on my
part — the doc's own open questions are noted below):

- Redirects settings, MCP servers, plugins, state files, history.
- Settings resolution is **scope-based with no upward directory traversal**
  (Enterprise > User > Project > Local, precedence Local > Project > User > Enterprise).
- **Gotcha:** `CLAUDE.md` memory files DO recurse upward from cwd to `/`. Config isolation does not
  isolate memory. A daemon working in `~/src/...` will still pick up every ancestor `CLAUDE.md`.
- The doc leaves open: whether `CLAUDE_CONFIG_DIR` suppresses user-scoped `~/.claude/CLAUDE.md`,
  and whether hardcoded home paths remain. Untested — the new service must test this.

Observed contents of an isolated `CLAUDE_CONFIG_DIR` (`personal-claude/.claude/`), i.e. the
directory shape `~/.claude-daemon/` needs to accommodate:

```
chrome/  debug/  file-history/  history.jsonl  plugins/  projects/
session-env/  settings.json  settings.local.json  shell-snapshots/  statsig/  todos/
.claude.json          # MCP/user config lands INSIDE the config dir, not at ~/.claude.json
```

`personal-claude/.gitignore` ignores `.claude/*` wholesale and re-includes only
`.claude/settings.local.json` — i.e. treat the isolated dir as runtime state, track only the
deliberate bits.

Enumerated tracked-vs-untracked split for a `~/.claude` clone is in `.claude/bin/swap-source-of-truth`
(the `DIRS`/`FILES` arrays) — useful reference for deciding what `~/.claude-daemon/` seeds vs.
generates.

## 2. `CLAUDE_HOME` — exists, but means something else

Two independent scripts define it, both defaulting to the **user's** dir, not an isolated one:

- `claude-utils/bin/lib/claude.lib.sh:110` — `CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"`,
  used for `$CLAUDE_HOME/backups`, `$CLAUDE_HOME/plugins/installed_plugins.json`,
  `$CLAUDE_HOME/.plugin-check-timestamp`.
- `.claude/bin/swap-source-of-truth:18` — same default.

So `CLAUDE_HOME` is an established knob in this ecosystem, and setting `CLAUDE_HOME=~/.claude-daemon`
would correctly redirect claude-utils' backup/plugin bookkeeping. But it is **not** read by Claude
Code itself — `CLAUDE_CONFIG_DIR` is. Set both, to the same path.

## 3. XDG — declared, never overridden

`dotfiles/_home/zshenv:13-15` is the only XDG site in any repo:

```bash
export XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}
export XDG_DATA_HOME=${XDG_DATA_HOME:-$HOME/.local/share}
export XDG_CACHE_HOME=${XDG_CACHE_HOME:-$HOME/.cache}
```

`XDG_STATE_HOME` is never mentioned anywhere. Nothing in any repo re-points XDG dirs to isolate a
child process. This is greenfield for the daemon.

Consequence that matters: `gh` resolves its config to `$XDG_CONFIG_HOME/gh` — confirmed by the
sample output in `ai-mktpl/plugins/scm-utils/skills/auth-user/SKILL.md:31`
(`Logged in to github.com account octocat (/home/user/.config/gh/hosts.yml)`), and by the live
machine having `~/.config/gh/{config.yml,hosts.yml}`. So overriding `XDG_CONFIG_HOME` alone would
drag every other XDG-aware tool along with `gh`. Prefer the narrower `GH_CONFIG_DIR`.

## 4. Separate gh auth — no existing implementation

`GH_CONFIG_DIR` appears in zero files. The closest existing patterns:

- **Token-in-env** (`ai-mktpl/docs/specs/draft/github-token-refresh-plugin.md:171`):
  `export GH_TOKEN=$(cat ~/.config/agent/github-token)` — a shared token file at
  `~/.config/agent/github-token`, re-read rather than baked into the environment, precisely because
  "env vars are set at process start and can't be updated" and GitHub App installation tokens expire
  after 1 hour.
- **Credential helper reading that file** (same spec):

  ```bash
  #!/usr/bin/env bash
  TOKEN_FILE="${GITHUB_TOKEN_FILE:-$HOME/.config/agent/github-token}"
  if [[ -f "$TOKEN_FILE" ]]; then
    echo "protocol=https"; echo "host=github.com"
    echo "username=x-access-token"; echo "password=$(cat "$TOKEN_FILE")"
  fi
  ```

  wired via `git config --global credential.https://github.com.helper '!...'`.

  **Spinach:** that spec writes to `--global`, i.e. the user's own `~/.gitconfig`. For a daemon that
  is the wrong scope — it would hijack the human's git. The isolated equivalent is
  `GIT_CONFIG_GLOBAL=~/.claude-daemon/gitconfig`, which no repo currently uses.

Note `GH_TOKEN` in the environment overrides `gh`'s stored auth regardless of `GH_CONFIG_DIR`, so
the two mechanisms must not be mixed carelessly.

## 5. Committing as the current user while auth is separate

The load-bearing insight, from `agent-team/docs/specs/draft/agent-github-auth.md` (Tier 1,
"Always On", zero infrastructure): **git stores two identities per commit.** Separate the author
from the committer instead of separating the whole config.

```bash
export GIT_AUTHOR_NAME="Claude Engineer (looney-tunes)"
export GIT_AUTHOR_EMAIL="claude-engineer+looney-tunes@noreply.local"
# GIT_COMMITTER_* deliberately left alone → falls through to the user's ~/.gitconfig
```

- Email convention `claude-{role}+{team-name}@noreply.local` — non-routable, won't collide with a
  real GitHub account, greppable by role.
- GPG signing survives: the **committer** signs, so verified badges still work with a different author.
- `git log --author="Engineer"` becomes the audit filter.
- Custom trailers (`Agent-Role:`, `Agent-Team:`, `Agent-Session:`) are queryable via `git log --grep`
  but not rendered by GitHub; only `Co-Authored-By` renders.

For the daemon the polarity likely inverts — commit **as the user** (author = user, so contribution
graph and branch protection behave) and carry agent identity in trailers. The spec explicitly names
this hybrid: user OAuth for API + git author/committer split for commits, chosen when the user
"values contribution graph credit and existing branch protection compatibility."

Open question the spec never resolved, and which the daemon must test:
> Does Claude Code honor `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`, or does it pass its own `--author`?

The concrete "set identity explicitly, both scopes" mechanic exists in CI at
`agent-team/.github/actions/github-app-auth/action.yml:64-70` (mirrored byte-identically into ~15
repos):

```bash
gh auth setup-git
echo "GH_TOKEN=${GH_TOKEN}" >> $GITHUB_ENV
echo "GITHUB_TOKEN=${GH_TOKEN}" >> $GITHUB_ENV
git config --global user.name '<slug>[bot]'
git config          user.name '<slug>[bot]'
git config --global user.email '<id>+<slug>[bot]@users.noreply.github.com'
git config          user.email '<id>+<slug>[bot]@users.noreply.github.com'
```

Reusable bits: `gh auth setup-git` to make `git` inherit `gh`'s credentials; setting both `--global`
and repo-local so neither scope surprises you; the `<numeric-id>+<login>@users.noreply.github.com`
email form. The user's own global identity today is `Nathan Heaps` /
`1282393+nsheaps@users.noreply.github.com` — same form, so a daemon that commits as the user should
reproduce exactly that pair.

## 6. Helper scripts that build an isolated env

There is no general-purpose "construct isolated env" helper in any repo. The three closest:

- `personal-claude/bin/claude` — the only real one; isolates Claude only (see §1).
- `personal-claude/.envrc` — direnv-scoped isolation, so it applies to an interactive shell in a
  directory, not to a daemon.
- `claude-utils/bin/run-claude` — a launcher, but it *does not* isolate; it inherits `$HOME/.claude`.
  Still worth mining for daemon behaviors: brew-outdated self-update prompt
  (`CHECK_FOR_UPDATES_ON_FORMULAE=("claude-code" "claude-utils")`), plugin auto-update with a
  5-hour cooldown stamped in `$CLAUDE_HOME/.plugin-check-timestamp`, and a settings-backup check
  registered on `trap ... EXIT`. Relevant to the service auto-update loop.

## Implications for `~/.claude-daemon/`

Everything below is a proposal derived from the above, not an existing pattern:

- `CLAUDE_CONFIG_DIR=~/.claude-daemon/claude` + `--setting-sources project,local` — proven pair.
- `CLAUDE_HOME=~/.claude-daemon/claude` — so claude-utils-style tooling agrees.
- `GH_CONFIG_DIR=~/.claude-daemon/gh` — no precedent; narrower and safer than `XDG_CONFIG_HOME`.
- `GIT_CONFIG_GLOBAL=~/.claude-daemon/gitconfig` — no precedent; keeps the credential helper and any
  daemon git config out of the human's `~/.gitconfig`. Seed it with the user's real
  `user.name`/`user.email` so commits land as the user.
- Leave `GIT_COMMITTER_*` / `user.*` as the human; carry agent identity in trailers.
- Do **not** override `HOME` — nothing in the ecosystem does, and it would sever ssh keys, brew,
  and mise.
- Test the memory-traversal gotcha (§1) explicitly; config isolation does not cover `CLAUDE.md`.
