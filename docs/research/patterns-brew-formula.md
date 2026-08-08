# Patterns: Homebrew packaging + release (nsheaps)

Scanned 2026-08-08 against `/Users/nathan.heaps/src/nsheaps/claude-utils` and
`/Users/nathan.heaps/src/nsheaps/homebrew-devsetup`. Everything below is observed,
not proposed. Gaps are called out explicitly in [[#What is absent]].

Related: [[patterns-ci]], [[patterns-repo-scaffold]], [[spec-daemon-service]]

## Topology: source repo owns the template, tap owns the rendered formula

| Thing | Lives in |
| --- | --- |
| Formula **template** | `nsheaps/claude-utils` → `Formula/claude-utils.rb.gotmpl` |
| Rendered formula | `nsheaps/homebrew-devsetup` → `Formula/claude-utils.rb` |
| Tap name | `nsheaps/devsetup` (repo must be `homebrew-` prefixed — see tap README) |

The tap is a **shared, multi-project tap**. It already carries `claude-utils.rb`,
`git-wt.rb`, `gs-stack-status.rb`, `infra-tools.rb`, `devsetup-base.rb`,
`python@3.11.rb`, plus `Casks/nsheaps-base.rb`. A new project adds one more file;
it does not get its own tap.

User-facing install (from `claude-utils/README.md`):

```bash
brew tap nsheaps/devsetup
brew install claude-utils
```

## Formula shape (the house style)

`homebrew-devsetup/Formula/gs-stack-status.rb` — the canonical minimal formula:

```ruby
# typed: false
# frozen_string_literal: true

class GsStackStatus < Formula
  desc 'Terminal dashboard for git-spice stacked branch workflows'
  homepage 'https://github.com/nsheaps/gs-stack-status'
  url 'https://github.com/nsheaps/gs-stack-status/archive/refs/tags/v0.3.0.tar.gz'
  sha256 'c9f62ee09e14fe157d39432148746d766b46275c5975cbda4df19132862eaf7e'
  license 'MIT'

  head do
    url 'https://github.com/nsheaps/gs-stack-status.git', branch: 'main'
  end

  depends_on 'git-spice'
  depends_on 'gum'

  def install
    bin.install Dir['bin/*']
  end

  test do
    assert_match 'gs-stack-status', shell_output("#{bin}/gs-stack-status --help 2>&1")
  end
end
```

Invariants across all three real formulas:

- `# typed: false` + `# frozen_string_literal: true` header, single-quoted strings
  (rubocop-enforced; see `.rubocop.yml` in both repos, `Style/FrozenStringLiteralComment:
  Enabled: false` so the magic comment is optional but present anyway).
- Source distribution only: `url` points at the **GitHub auto-generated tag tarball**
  `archive/refs/tags/vX.Y.Z.tar.gz`.
- `head do ... end` block pointing at `main` — always present.
- Install is a plain `bin.install Dir['bin/*']` (claude-utils, gs-stack-status) or a
  single named file (`bin.install 'bin/git-wt'` in `git-wt.rb`).
- Runtime deps declared as `depends_on 'fzf'` / `depends_on 'gum'`.
- A `test do` block that shells the binary with `--help` and `assert_match`. Note
  claude-utils asserts against exit code 1: `shell_output("#{bin}/ccresume --help 2>&1", 1)`.
- No `version` stanza on real formulas — brew infers it from the tag in `url`. Only the
  **meta** formulas hard-code `version` (`devsetup-base.rb` has `version '1.0.0'` with the
  comment `# bump me if you want people to re-install these things`).

### Template form

`claude-utils/Formula/claude-utils.rb.gotmpl` is byte-identical to the rendered formula
except two gomplate substitutions:

```ruby
  url 'https://github.com/nsheaps/claude-utils/archive/refs/tags/{{ .Env.Tag }}.tar.gz'
  sha256 '{{ .Env.SHA256 }}'
```

That is the entire templating surface. Everything else is literal.

## Release pipeline

Two jobs in `claude-utils/.github/workflows/release.yaml`, triggered on push to `main`.

### Job 1 `release` — release-it cuts the tag

- Auth via a local composite action `./.github/actions/github-app-auth`
  (`AUTOMATION_GITHUB_APP_ID` / `AUTOMATION_GITHUB_APP_PRIVATE_KEY`) — **not** `GITHUB_TOKEN`,
  so the push can re-trigger downstream workflows.
- `git fetch --tags --force`, mise setup, `yarn install`, then `yarn release-it --ci`.
- Outputs `tag` (from `git describe --tags --abbrev=0`) and `version` (`${TAG#v}`).

`claude-utils/.release-it.json`:

```json
{
  "hooks": { "after:bump": "sed -i.bak 's/^CLAUDE_UTILS_VERSION=.*/CLAUDE_UTILS_VERSION=\"v${version}\"/' bin/lib/claude.lib.sh && rm -f bin/lib/claude.lib.sh.bak" },
  "git": { "commitMessage": "chore: release v${version} [skip ci]", "tagName": "v${version}",
           "requireCleanWorkingDir": false, "getLatestTagFromAllRefs": true },
  "github": { "release": true, "autoGenerate": true },
  "npm": false,
  "plugins": { "@release-it/conventional-changelog": { ... "infile": "CHANGELOG.md" } }
}
```

Key details:

- `"npm": false` — nothing is published to a registry; the tag *is* the artifact.
- Version is stamped into shell source by the `after:bump` hook, not read from
  `package.json`. `bin/lib/claude.lib.sh:17` holds `CLAUDE_UTILS_VERSION="v0.10.0"` and
  `bin/claude-utils:14` echoes it. `package.json` `version` is stale (`0.1.0`) and unused.
- Conventional-commits changelog with explicit type→section mapping
  (feat/fix/perf/refactor/docs/chore).
- `[skip ci]` on the release commit prevents a loop.

### Job 2 `update-homebrew` — render + PR into the tap

Ordered steps, all in `release.yaml`:

1. Compute SHA256 by downloading the tag tarball:
   `curl -fsSL "https://github.com/${{ github.repository }}/archive/refs/tags/${TAG}.tar.gz" -o /tmp/archive.tar.gz`
   then `sha256sum ... | cut -d' ' -f1`. **The sha is of GitHub's tarball, not a built asset.**
2. `gh repo clone nsheaps/homebrew-devsetup`
3. Install `gomplate` from its GitHub latest release into `/usr/local/bin`.
4. Render: `gomplate -f Formula/claude-utils.rb.gotmpl -o homebrew-devsetup/Formula/claude-utils.rb`
   with env `Tag` and `SHA256`.
5. **Close stale formula PRs** — `gh pr list --state open --search "chore: update claude-utils to"`,
   close each with "Superseded by vX.Y.Z update."
6. Branch `bump-claude-utils-${VERSION}`, delete stale remote branch first
   (`git push origin --delete "$BRANCH" 2>/dev/null || true`), commit
   `chore: update claude-utils to ${VERSION}`, `gh pr create --base main`.
7. **Auto-merge with retry loop** — 5 attempts of `gh pr merge "$PR_URL" --auto --squash`
   with backoff `attempt * 10`s, because the GraphQL API rejects auto-merge while the PR is
   "unstable" (checks pending). Falls through to `::warning::` rather than failing.

PR body links back to the release URL and the workflow job URL (via `qoomon/actions--context@v4`).

## Are binaries prebuilt and attached to a release?

**No.** Nothing is compiled, uploaded, or downloaded as a release asset. `github.release: true`
with `autoGenerate: true` creates a GitHub Release whose only payload is GitHub's automatic
source tarball. The formula consumes exactly that tarball and `bin.install`s the shell scripts.
A new repo shipping a compiled daemon would be introducing a **new** pattern here — see
[[#What is absent]].

## Brew services / launchd

**Absent.** A grep for `service`, `plist`, `launchd`, `post_install`, `keg_only`, `resource`
across `homebrew-devsetup/Formula/` and `Casks/` returns exactly one hit:
`Casks/nsheaps-base.rb:154: def caveats`.

So, concretely:

- **No `service do ... end` block exists anywhere** in either repo.
- **No `.plist` files, no `launchctl`, no `LaunchAgents`, no `brew services`** references in
  `claude-utils/bin/`, `test/`, or `.github/`.
- **No `post_install` hook** in any formula.
- The one `caveats` example is `Casks/nsheaps-base.rb` — a heredoc printing zshrc lines the user
  must paste, with the comment `# TODO: make install/uninstall manage this`. It is a
  *print instructions* pattern, not an interactive-configure pattern.
- `Formula/cc-ent-config.rb` is a 3-line **stub comment only** — no Ruby. It describes the
  intent: "a formula that when installed will take a heredoc defined in this file and place it
  in the appropriate location on a mac machine; if modifying user configs, use jsonnet to merge
  the items with the existing config." That is the closest thing to an install-time-configuring
  formula and it is unimplemented.
- The `homebrew-devsetup/README.md` documents a *designed but unbuilt* interactive-config
  contract under `devsetup configure <topic>`: formulas named `devsetup-configure-<topic>`,
  `--reconfigure` removes-then-reinstalls, `--preserve` makes it non-interactive, uninstall
  removes what it configured. No such formula exists in `Formula/`.

## What is absent (new-repo greenfield work)

The new repo needs these and has **no precedent to copy** in either scanned repo:

1. A `service do ... end` block (`run`, `keep_alive`, `run_type :immediate`, `log_path`,
   `error_log_path`, `working_dir`) and any `brew services start` UX.
2. Interactive configuration at install time. Brew runs `post_install` non-interactively with
   stdout captured — the observed house pattern for anything interactive is instead
   **`caveats` printing a command the user runs by hand** (`nsheaps-base` zshrc block). Expect
   to ship a `<pkg> setup` / `<pkg> configure` subcommand and have `caveats` tell the user to
   run it, rather than prompting inside `def install`.
3. Prebuilt binaries / release assets. Current pattern is source tarball + `bin.install`.
4. Bottles. No `bottle do` block anywhere.
5. `livecheck` on a real formula — only `devsetup-base.rb` uses it, and only to
   `skip 'Meta formulas cannot be updated'`.

## Supporting conventions worth mirroring

- `mise.toml` task names: `test`, `lint`, `fmt`, `fmt-check`, `check` (depends on the first
  three), plus `lint-formula` → `rubocop Formula/*.rb --config .rubocop.yml`.
- `.rubocop.yml` disables `Naming/FileName`, `Style/Documentation`, `Metrics/BlockLength`,
  and allows long `# renovate: ...` lines.
- Tap CI (`homebrew-devsetup/.github/workflows/check.yaml`) is format-autocommit +
  a parallel security matrix (secretlint, syft, trivy, trufflehog, checkov, kics, grype,
  gitleaks) via `qoomon/actions--parallel-steps`. Actions are SHA-pinned with `# vN` comments.
  Formula PRs from the release workflow must pass this — which is why the auto-merge retry
  loop exists.
- Source-repo CI (`claude-utils/.github/workflows/test.yaml`) is much lighter: `bash -n`
  syntax check over `bin/*` and `bin/lib/*.sh`, then `mise run test`.
