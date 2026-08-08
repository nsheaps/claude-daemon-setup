# Patterns Index — map for the `claude-daemon-setup` scaffold

Scanned 2026-08-08 across `~/src/nsheaps/*`. This is a **map**, not a summary. Each doc
records only what exists on disk; this page pulls out the decisions and the unknowns.

## The docs

- [[patterns-tooling]] — mise / yarn / nx / tsconfig / eslint / editorconfig / shellcheck / renovate pins as they exist in `claude-utils` and `.github`.
- [[patterns-brew-formula]] — tap topology, the house formula shape, the gomplate template, and why `service do` has no precedent.
- [[patterns-ci-release]] — exact `uses:` lines, workflow file split, concurrency/permissions blocks, release-it → homebrew PR pipeline.
- [[patterns-agent-workspace]] — `nsheaps-ai-workspace` layout, the proposed `agent.yaml` schema, `ai-agent-henry` as the one-repo-per-agent model.
- [[patterns-config-isolation]] — `CLAUDE_CONFIG_DIR` (the only working isolation), `CLAUDE_HOME`, and the git author/committer split.
- [[patterns-autoupdate]] — `run-claude`'s launch-time brew check + 5-hour-cooldown plugin loop, and its fail-open style.

## Decisions the scaffold adopts (copy these, no debate needed)

**Toolchain**

- `mise.toml` (undotted) at repo root; `[tools] node = "lts"`, `yarn = "4"`, `shfmt = "latest"`.
- Task names, fixed contract: `setup`, `lint`, `fmt`, `fmt-check`, `test`, `build`, `check`
  (`check` = `depends = ["lint","fmt-check","test"]`).
- Yarn Berry 4 via `packageManager: "yarn@4.12.0+sha512..."`; `.yarnrc.yml` = `nodeLinker: node-modules`.
- `package.json`: `private: true`, `type: module`.
- `renovate.json` = `{ "$schema": ..., "extends": ["github>nsheaps/renovate-config"] }` verbatim.
- `.editorconfig` + `.editorconfig-checker.json` (`Exclude: docs/research/, docs/reports/, .claude/tmp/`);
  `.shellcheckrc` (`shell=bash`, disable SC1091/SC2034) if any bash ships.
- TypeScript only if multi-package: `tsconfig.base.json` ES2022/NodeNext/strict, flat `eslint.config.js`,
  `nx.json` target defaults with **no** `project.json` files.
- Docs tree: `docs/research/`, `docs/specs/{draft,reviewed,in-progress,live,deprecated,archive}/`.

**CI / release**

- Workflows: `.github/workflows/{check,test,release}.yaml`, `.yaml` extension always.
  Triggers standardize on `push: [main]` + `pull_request` (not `claude-utils`' bare `push:`).
- `uses: nsheaps/github-actions/.github/actions/github-app-auth@main` — **reference upstream, do not vendor**
  (`claude-utils`' vendored copy has drifted). Secrets: `AUTOMATION_GITHUB_APP_ID` / `AUTOMATION_GITHUB_APP_PRIVATE_KEY`.
- `uses: jdx/mise-action@v2` then `mise run <task>` — CI is a thin wrapper over local tasks.
- Security matrix via `qoomon/actions--parallel-steps@v1` + the 8 `nsheaps/github-actions/.../lint-*@main` actions.
- Concurrency: the ref-based variant (never cancel main, always cancel superseded PRs).
- Top-level `permissions: contents: read`, widened per job (stricter than any existing repo, matches intent).
- SHA-pin third-party actions with `# vN` comments.
- Release: `release-it` + `@release-it/conventional-changelog`, `npm: false`, tag `v${version}`,
  commit `chore: release v${version} [skip ci]`, `after:bump` hook seds the version constant into source.
- Homebrew publish: SHA256 of the GitHub tag tarball → `gomplate` render → PR into `nsheaps/homebrew-devsetup`
  → close superseded PRs → `gh pr merge --auto --squash` with 5-attempt backoff.

**Formula**

- Template `Formula/<name>.rb.gotmpl` in this repo; rendered `.rb` lands in the shared tap `nsheaps/devsetup`
  (one more file in an existing multi-project tap — **not** a new tap).
- Shape: `# typed: false` + `# frozen_string_literal: true`, single-quoted strings, `desc`/`homepage`/
  `url .../archive/refs/tags/{{ .Env.Tag }}.tar.gz`/`sha256 '{{ .Env.SHA256 }}'`/`license 'MIT'`,
  a `head do` block on `main`, `depends_on` lines, `def install` = `bin.install Dir['bin/*']`,
  `test do` asserting `--help` output. No `version`, no `bottle`, no `livecheck`.
- Interactive setup goes in a `<pkg> setup` subcommand advertised by `caveats` — never in `def install`.

**Env-var isolation set** (from [[patterns-config-isolation]]; `CLAUDE_CONFIG_DIR` is the only proven one)

```
CLAUDE_CONFIG_DIR=~/.claude-daemon/claude     # proven
CLAUDE_HOME=~/.claude-daemon/claude           # same path, so claude-utils tooling agrees
GH_CONFIG_DIR=~/.claude-daemon/gh             # no precedent; narrower than XDG_CONFIG_HOME
GIT_CONFIG_GLOBAL=~/.claude-daemon/gitconfig  # no precedent; keeps daemon config out of ~/.gitconfig
claude --setting-sources project,local        # pairs with CLAUDE_CONFIG_DIR; neither alone suffices
# NOT set: HOME, XDG_*, GIT_COMMITTER_*
```

Plus the `ORIGINAL_PATH` + `exec env PATH="$ORIGINAL_PATH"` shim trick if we ship `bin/claude`.

## Conflicts and gaps — need the user's input

**Conflicts (repos disagree; pick one)**

1. `mise.toml` vs `.mise.toml` — both exist. Recommendation above picks undotted; confirm.
2. Concurrency block: event-based (`github-actions`) vs ref-based (`claude-utils`). Same intent.
3. Format job stance: auto-commit-then-`exit 1` (`github-actions`) vs diff-check-only (`claude-utils`).
4. `packageManager` with integrity hash vs bare. Recommendation picks hashed.
5. Action pinning: SHA-pinned vs floating tags — inconsistent org-wide.

**Gaps (no precedent anywhere; genuinely new design)**

6. **`service do` / launchd.** Zero `.plist`, `launchctl`, `brew services`, or `post_install` in any repo.
   The whole daemon surface is greenfield.
7. **Compiled/prebuilt binaries.** Nothing is built or attached to a release today — source tarball +
   `bin.install` only. `bun build --compile` appears in `agent`/`agent-team` mise tasks but bun is absent
   from the released repos, and the org's own research doc stops short of endorsing it.
8. **Non-interactive update path.** `run-claude` gates upgrades on `gum confirm`; a daemon has no TTY.
   Also missing: quiesce/drain before upgrading mid-session, and any rollback for a bad upgrade.
9. **`agent.yaml` is proposed, never implemented** — no such file exists. And nothing anywhere maps
   `agent.name` → a service/unit name. That mapping is ours to invent.
10. **Per-agent `gh`/`git` isolation** is untested. Open questions the specs never resolved: does
    `CLAUDE_CONFIG_DIR` suppress user-scoped `~/.claude/CLAUDE.md`? (Memory files recurse upward from cwd
    regardless — isolation does **not** cover them.) Does Claude Code honor `GIT_AUTHOR_*` or pass its own
    `--author`? Both must be tested before the design locks.
11. **direnv** — no `.envrc` in the tooling repos; `ai-agent-henry` has one (`rc.d/*.sh` loop). Adopt or not?
12. **Docs site** — no Pages/mkdocs/docusaurus precedent. Greenfield if wanted.
13. **Org registration** — a new repo must be added to `.github/.github/workflows/sync-labels.yaml`'s
    hardcoded `matrix.repo` list (and likely `ansible/config/sync-files.yml`) or it gets no labels/file sync.
