# Reusable patterns from nsheaps agent repos

Scan date: 2026-08-08. Repos read on disk at `~/src/nsheaps/`.

Related: [[patterns-daemon-service]] · [[../specs/draft/README]]

## 0. Which repo did the user mean?

`nsheaps/agents` does not exist locally. Two candidates:

| Repo                                          | What it is                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `/Users/nathan.heaps/src/nsheaps/agent`       | Bun/TS **launcher CLI** (`agent`) — wraps `claude`, brew preflight, settings backup |
| `/Users/nathan.heaps/src/nsheaps/agent-team`  | Multi-agent orchestration POC + `templates/teams/*/team.yaml` + shell libs      |

`agent` is the one that owns launch config (`.agent.yaml`, `~/.config/agent/config.yaml`).
`agent-team` is where the *proposed* `agents/{name}/agent.yaml` schema is written down.
For a daemon-per-agent repo, **`agent-team`'s spec text is the naming source, `agent`'s
loader is the working code.**

---

## 1. `nsheaps-ai-workspace` layout (PRIMARY model)

Top level of `/Users/nathan.heaps/src/nsheaps/nsheaps-ai-workspace/`:

| Path                        | Purpose (quoted from its `README.md`)                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `rules/`                    | "Always-loaded instructions. Short by design — they cost context in every session."                          |
| `skills/`                   | "On-demand guidance, loaded when its description matches what you're doing. The bulk of the content."         |
| `agents/`                   | "Agent definitions — specialist roles a session can delegate to."                                             |
| `harness/claudecode/`       | "Everything specific to one agent runtime: settings, hooks, the enabled-skills farm, and the libraries behind `bin/`." |
| `docs/`                     | "Specs, decision records, investigations, and ticket write-ups."                                              |
| `bin/`                      | "Repo-root entry points. Thin forwarders; the logic lives in `harness/claudecode/lib/`."                      |
| `tests/`                    | bun/jest package (`tests/package.json`, `tests/jest.config.ts`) testing `harness/.../hooks`                   |
| `logs/`, `artifacts/`       | gitignored except `.gitkeep`                                                                                  |

The stated rationale is the reusable bit:

> `skills/`, `rules/`, and `agents/` sit at the top level because their content is
> harness-agnostic — it would still make sense under a different agent runtime.
> Everything under `harness/claudecode/` is specific to this one.

### The two-hop skill farm

`skills/<name>/SKILL.md` is the real content. `harness/claudecode/skills-enabled/<name>`
is a **committed symlink** meaning "switched on". `~/.claude/skills` is one symlink to the
farm, repaired by a `SessionStart` hook. Enabling a skill is therefore a reviewable commit.

`rules/` and `agents/` instead get a **nested `<org>/<repo>` directory link** under
`~/.claude/rules/` and `~/.claude/agents/`, because those trees are scanned recursively and
several repos can contribute. `bin/wire` refuses to flatten them, because the
`PreToolUse` hook `block-loose-config-writes.py` resolves paths to decide if a write is tracked.

### bin/ is a 6-line forwarder, always

`bin/wire` in full:

```sh
#!/bin/sh
# Thin forwarder to the host-wiring CLI. No logic here — see
# harness/claudecode/scripts/wire.py. Absolute interpreter for the same reason as
# bin/skillctl: a bare `python3` resolves to a version-manager shim that fails in
# untrusted directories.
exec /usr/bin/python3 \
  "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/harness/claudecode/scripts/wire.py" \
  "$@"
```

Note the **absolute `/usr/bin/python3`** — a deliberate choice, documented inline, because
`env python3` hits a mise/asdf shim that fails in untrusted dirs and silently disabled a hook once.

### docs/ sub-shape

```
docs/specs/<org>/<repo>/<slug>/README.md   # non-trivial changes start here
docs/decisions/YYYY/MM/DD/<slug>.md
docs/investigations/YYYY-MM-DD-<slug>/
docs/tickets/<ticket-id>/{plans,reports,journal}/
docs/bin/<command>.md                      # one doc per bin/ entry point
```

### `.claude/` inside the workspace repo (self-config)

Small and deliberate — only project-scoped overrides:

```
.claude/rules/docs-organization.md
.claude/rules/language-preferences.md
.claude/skills/propagating-convention-changes -> ../../skills/propagating-convention-changes
.claude/worktrees/<branch-slug>/
```

Everything else lives at the top level and reaches `~/.claude` through `bin/wire`.

### Harness settings

`harness/claudecode/settings.json` holds `env`, `attribution`, `permissions.defaultMode`,
`model`, `hooks`, `enabledPlugins`, `extraKnownMarketplaces`. Hook commands are
**absolute paths through `$HOME/src/<org>/<repo>/…`**, e.g.

```json
"command": "/usr/bin/python3 $HOME/src/oura-health-playground/nsheaps-ai-workspace/harness/claudecode/hooks/sync-skill-links.py"
```

Machine-local/secret files are captured but gitignored: `remote-settings.json`,
`managed-settings.json`, `*.local.json`, `/claude.json`, `harness/claudecode/.env`
(a symlink to `~/.claude/.env`).

---

## 2. `agent.yaml` — status: PROPOSED, not implemented

**No `agent.yaml` / `agent.yml` file exists anywhere under `~/src/nsheaps/`.** Every hit is
prose in specs. The canonical description is
`agent-team.worktrees/merge-claude-team/docs/specs/draft/agent-team-architecture.md` §4:

| Format                      | Location                    | Status                        |
| --------------------------- | --------------------------- | ----------------------------- |
| Claude Code agent files     | `.claude/agents/{name}.md`  | Current — used today          |
| **agent.yaml** (proposed)   | `agents/{name}/agent.yaml`  | Future — target format        |
| **Project `.agent.yaml`**   | `.agent.yaml` (project root)| Future — project-level config |

Quoted schema (same file):

```yaml
name: software-eng
character: Bugs Bunny
role: Software Eng
framework: claude-code
model: claude-opus-4-6

tools: [messaging, tasks, filesystem, execution]

permissions:
  mode: bypassPermissions   # or default, acceptEdits, dontAsk, plan
  allowed: ["git *", "bun *", "npm *"]
  denied: ["rm -rf /"]

container:
  image: ghcr.io/nsheaps/agents/engineer:latest
  dockerfile: ./Dockerfile
  resources: { memory: 2Gi, cpu: 1 }

workspace:
  repos: [git@github.com:nsheaps/agent-team.git]
  mounts: ["~/.claude:/home/agent/.claude:ro"]

mesh:
  connect: true
  groups: [engineering, all]

session:
  persist: true
  backend: local   # or s3
```

### What `name` is used for

`name` is the **agent-id**, and it is the directory key everywhere downstream:

- directory: `agents/{name}/agent.yaml`
- session store: `sessions/{agent-id}/{session-id}.jsonl`, `sessions/{agent-id}/memory.md`,
  `tasks.json`, `team-context.json`, `workspace-state.json`
- local backend root `~/.agent-team/sessions/`, s3 backend `s3://bucket/team-name/sessions/`

**There is no service/launchd/systemd unit name derived from `agent.name` anywhere in these
repos — that mapping does not exist yet and is a decision `claude-daemon-setup` must make.**

The nearest working analogue is `team.yaml` (`agent-team/templates/teams/{default,looney-toons}/team.yaml`),
which is real and loaded: top-level `name:`, `description:`, `roles.<role>.{agent_template,
display_name, persona, system_message}`, and `settings.{teammate_mode, permission_mode,
framework, model}`. `display_name` is the human/tmux-facing label (`'Bugs B (software-eng)'`),
`name` is the machine key.

### The one real config loader

`agent/src/config/loader.ts` — worth copying wholesale:

```
Merge order: defaults < ~/.config/agent/config.yaml < ./.agent.yaml < CLI flags
```

Arrays from the later layer replace entirely (`deepMerge`), `~` expanded via `expandTilde`,
everything after `--` or the first unrecognized flag is passthrough to `claude`.

---

## 3. Per-agent config isolation — **ABSENT**

Grepped `agent`, `agent-team`, `claude-utils`, `nsheaps-ai-workspace` for
`GH_CONFIG_DIR`, `GIT_CONFIG_GLOBAL`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`,
`XDG_STATE_HOME`, `HOME=`. **No repo sets any of them to isolate an agent.** What exists:

- `CLAUDE_CONFIG_DIR` — only *documented* as a Claude Code env var in
  `agent-team/docs/research/agent-teams-messaging{,-source}.md`: "Config directory:
  `process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')`". Never set.
- `CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"` — `claude-utils/bin/run-claude:50` and
  `claude-utils/bin/lib/claude.lib.sh:110`. Overridable, but defaults to the shared `~/.claude`.
- `agent-team/bin/lib/agent-config/common.sh` isolates by **path namespacing, not env**:

  ```bash
  _derive_upstream_folder() {
      local folder="upstream--${ROOT_DIR#"$HOME"/}"
      echo "${folder//\//-}"
  }
  readonly UPSTREAM_FOLDER="$(_derive_upstream_folder)"
  ```

  yielding `~/.claude/rules/upstream--src-nsheaps-ai/` — collision-free per source repo.
- `ai-agent-henry/workspace.Dockerfile` isolates by **container**: `USER runner`,
  `/home/runner/.claude`, `/home/runner/.ai`, `/home/runner/work`.

**Conclusion for claude-daemon-setup:** per-agent git/gh/claude isolation is a genuinely new
design surface. The precedent to follow is henry's container-per-agent or a
`CLAUDE_CONFIG_DIR`/`GH_CONFIG_DIR`/`GIT_CONFIG_GLOBAL` triple set from `agent.name` — the
latter has no prior art here.

---

## 4. `daemon-agent-template` — empty

```
/Users/nathan.heaps/src/nsheaps/daemon-agent-template/
├── .git/
└── README.md        (0 bytes)
```

Nothing scaffolded. Green field.

---

## 5. Per-agent repo shape worth copying (`ai-agent-henry`)

The closest existing "one repo = one daemon agent":

```
.ai/{CLAUDE.md,rules,skills,agents,commands,docs}   # harness-agnostic, synced out
.claude/{CLAUDE.md,settings.json,hooks/,mcp/,plans/,sessions/<uuid>/prompt.md}
.claude/hooks/run-hook.sh + hooks/session-start/00-setup-workspace.sh   # numbered dispatch
.envrc + rc.d/{00_direnv-helpers,01_mise-activate,05_add-bin-to-path}.sh
bin/lib/stdlib.sh, bin/setup-workspace.sh
.mise.toml, .mise/tasks/claude-statusline
.github/actions/{github-app-auth,run-agent,with-post-step}/action.yaml
.github/workflows/{build-container,repo-dispatch,sync-labels}.yml
docs/specs/{draft,reviewed,in-progress,live,deprecated,archive}/
workspace.Dockerfile
renovate.json5
```

`.envrc` is deliberately logic-free — it only loops `rc.d/*.sh`, with the comment
"put scripts in rc.d and source them here … so it will need to be re-allowed with
`direnv allow .` on all changes" otherwise.

## 6. Build/release conventions (both `agent` and `agent-team`)

- `mise.toml` task names are stable across repos: `build`, `dev`, `typecheck`, `fmt`,
  `fmt-check`, `lint` (`depends = ["typecheck","fmt-check"]`), `test`, `check`
  (`depends = ["lint","test"]`).
- Bun single-binary: `bun build src/index.ts --compile --outfile dist/agent`.
- `.release-it.json` with `@release-it/conventional-changelog`, tag `v${version}`,
  commit `chore: release v${version} [skip ci]`, `github.release: true`.
- Homebrew formula as a **Go template**: `Formula/<name>.rb.gotmpl` with `{{ .Env.Tag }}` /
  `{{ .Env.SHA256 }}`, `depends_on 'oven-sh/bun/bun'`, a `head do` block, and a `test do`
  asserting `--help` output.
- Workflows: `.github/workflows/{test,release}.yaml` only.
- Shared linter configs vendored from `nsheaps/.org` (`.org/linters/{.editorconfig,
  .prettierrc.yaml,.prettierignore,.rubocop.yml}`).
