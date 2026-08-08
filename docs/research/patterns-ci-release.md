# CI/CD Patterns from nsheaps Repos

Scan date: 2026-08-08. Sources scanned:

- `/Users/nathan.heaps/src/nsheaps/claude-utils/.github` (bash CLI + homebrew release)
- `/Users/nathan.heaps/src/nsheaps/.github/.github` (org-level `.github` repo)
- `/Users/nathan.heaps/src/nsheaps/github-actions` (shared composite actions)

Related: [[patterns-repo-scaffold]], [[../specs/draft/ci-release]]

## Headline: there are NO reusable workflows

**Absent.** `grep -rl workflow_call` across all three repos returns nothing. `nsheaps/github-actions` publishes **composite actions only** (`.github/actions/*/action.yml`). There is no `nsheaps/github-actions/.github/workflows/*.yaml` with `on: workflow_call`. A new repo copies workflow skeletons and calls composite actions by `uses:`.

## Exact `uses:` lines a new repo should adopt

```yaml
# GitHub App auth — token + git identity + re-checkout with creds. Use this
# instead of GITHUB_TOKEN whenever the job pushes commits, tags, or opens PRs.
- name: Authenticate as GitHub App
  id: auth
  uses: nsheaps/github-actions/.github/actions/github-app-auth@main
  with:
    app-id: ${{ secrets.AUTOMATION_GITHUB_APP_ID }}
    private-key: ${{ secrets.AUTOMATION_GITHUB_APP_PRIVATE_KEY }}
# outputs: token, app-slug, user-id, user-name

# Security scanners (all 8, in parallel inside one job)
- name: Install mise and tools
  uses: jdx/mise-action@v2
  with:
    install_args: 'grype trivy syft gitleaks trufflehog checkov aqua:secretlint/secretlint'
- name: Run all security linters in parallel
  uses: qoomon/actions--parallel-steps@v1
  with:
    steps: |
      - uses: nsheaps/github-actions/.github/actions/lint-secretlint@main
      - uses: nsheaps/github-actions/.github/actions/lint-syft@main
      - uses: nsheaps/github-actions/.github/actions/lint-trivy@main
      - uses: nsheaps/github-actions/.github/actions/lint-trufflehog@main
      - uses: nsheaps/github-actions/.github/actions/lint-checkov@main
      - uses: nsheaps/github-actions/.github/actions/lint-kics@main
      - uses: nsheaps/github-actions/.github/actions/lint-grype@main
      - uses: nsheaps/github-actions/.github/actions/lint-gitleaks@main
```

Other available (probably not needed for this repo):
`nsheaps/github-actions/.github/actions/claude-auth@main`,
`.../claude-debug@main`, `.../interpolate-prompt@main`,
`.../arcane-deploy@main`, `.../1password-secret-sync@main`.

Third-party actions used org-wide: `actions/checkout@v4`, `jdx/mise-action@v2`,
`actions/create-github-app-token@v2`, `stefanzweifel/git-auto-commit-action@v5`,
`qoomon/actions--context@v4`, `qoomon/actions--parallel-steps@v1`,
`editorconfig-checker/action-editorconfig-checker@main`, `actions/setup-node@v4`.

Pinning is inconsistent: `github-actions/.github/workflows/check.yaml` pins by SHA with a `# v4` comment; `claude-utils` and `.github` use floating tags. Prefer SHA pins for a new repo.

## Workflow file naming and job split

| File | `name:` | Trigger | Jobs |
| --- | --- | --- | --- |
| `github-actions/.github/workflows/check.yaml` | `check` | `workflow_dispatch`, `push` main, `pull_request` main | `format`, `security` |
| `claude-utils/.github/workflows/check.yaml` | `check` | `push` (all branches) | `check` (shellcheck, shfmt, editorconfig) |
| `claude-utils/.github/workflows/test.yaml` | `Test` | `push` main, `pull_request` | `lint`, `test` |
| `claude-utils/.github/workflows/release.yaml` | `Release` | `push` main | `release`, `update-homebrew` |
| `.github/.github/workflows/ci.yaml` | `CI` | `push` main, `pull_request` main | `validate` |
| `.github/.github/workflows/sync-*.yaml` | `Sync X` | `push` main + `paths:` filter, `workflow_dispatch` | one job |

Convention: `.yaml` extension always; lowercase-or-titlecase `name:` (not normalized); lint/format separated from test; release is its own file triggered only on `push: branches: [main]`.

## Concurrency blocks (two variants seen — pick one)

```yaml
# github-actions/.github/workflows/check.yaml — event-based
concurrency:
  group: ${{ github.event_name == 'push' && github.sha || format('{0}-{1}', github.workflow, github.ref) }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

```yaml
# claude-utils/.github/workflows/check.yaml — ref-based
concurrency:
  group: ${{ github.workflow }}-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

Intent is identical: never cancel main builds, always cancel superseded PR builds. `test.yaml`, `ci.yaml`, and `release.yaml` have **no** concurrency block.

## Permissions blocks

Sparse and job-scoped, not top-level-default-deny:

- `claude-utils/release.yaml` (workflow level): `contents: write`, `actions: read`
- `github-actions/check.yaml` job `format`: `contents: write` (no perms on `security` job)
- `.github/sync-labels.yaml`: `contents: read`
- `.github/sync-files.yaml`: `contents: read`, `pull-requests: write`
- `check.yaml`/`test.yaml`/`ci.yaml` in claude-utils and .github: **no permissions block at all**

Recommendation for a new repo: add top-level `permissions: contents: read` and widen per job — that is stricter than any existing repo but consistent with intent.

## Tooling: mise is the source of truth

Every repo uses `jdx/mise-action@v2` and defines tasks in `mise.toml` so local and CI run the same command. CI steps are thin wrappers: `mise run format`, `mise run check`, `mise run test`, `mise run ansible-lint`. `claude-utils/mise.toml` defines `test`, `lint`, `fmt`, `fmt-check`, `lint-formula`, and an aggregate `check` with `depends = ["lint", "fmt-check", "test"]`.

Package manager: `yarn` (yarn 4 pinned via mise in claude-utils), `yarn install` in CI.

## Format job: auto-commit-then-fail pattern

`github-actions/.github/workflows/check.yaml` `format` job:

1. checkout `persist-credentials: false`, `fetch-depth: 0`
2. github-app-auth
3. merge-conflict guard (`git diff --check HEAD | grep conflict` → fail)
4. `mise run format` with `continue-on-error: true`, sets `has_changes` from `git status --porcelain`
5. `stefanzweifel/git-auto-commit-action@v5` with `commit_user_name: ${{ steps.auth.outputs.user-name }}` and `commit_user_email: ${{ steps.auth.outputs.user-id }}+${{ steps.auth.outputs.user-name }}@users.noreply.github.com`
6. deliberately `exit 1` so CI re-runs on the new commit

`claude-utils` takes the opposite stance — `shfmt -d` diff-check only, no auto-commit.

## Release: release-it + conventional commits + homebrew PR

`claude-utils/.github/workflows/release.yaml`, job `release`:

- `actions/checkout@v4` with `fetch-depth: 0`, then `git fetch --tags --force`
- github-app-auth (local vendored copy — see gotcha below)
- `yarn release-it --ci` with `GITHUB_TOKEN: ${{ steps.auth.outputs.token }}`
- emits `tag` / `version` outputs via `git describe --tags --abbrev=0`

`.release-it.json` config: `git.commitMessage: "chore: release v${version} [skip ci]"`, `tagName: "v${version}"`, `github.release: true` + `autoGenerate: true`, `npm: false`, plugin `@release-it/conventional-changelog` with the `conventionalcommits` preset writing `CHANGELOG.md`. An `after:bump` hook seds the version into a shell lib.

Job `update-homebrew` (`needs: release`): downloads the tag tarball, `sha256sum`, renders `Formula/claude-utils.rb.gotmpl` with **gomplate**, clones `nsheaps/homebrew-devsetup`, closes superseded PRs, opens a PR, then retries `gh pr merge --auto --squash` 5 times with backoff (auto-merge is rejected while PR checks are pending). This is the exact publish path a new brew-installed tool should copy.

## GitHub Pages docs publishing: ABSENT

No `actions/deploy-pages`, `actions/upload-pages-artifact`, `mkdocs`, `docusaurus`, or `jekyll` anywhere in the three repos. `claude-utils/docs/` is plain markdown (`reports/`, `research/`, `specs/`) with no site generator. A docs site for `claude-daemon-setup` is greenfield — no framework precedent to match. See [[../specs/draft/docs-site]].

## Secrets / token conventions

- `secrets.AUTOMATION_GITHUB_APP_ID` + `secrets.AUTOMATION_GITHUB_APP_PRIVATE_KEY` — the universal pair, used in all three repos.
- No OIDC (`id-token: write`) anywhere. No cloud-provider federation.
- Other names seen in `github-actions/README.md`: `ANTHROPIC_API_KEY`, `DOPPLER_TOKEN`, `OP_SERVICE_ACCOUNT_TOKEN`, `ARCANE_URL`, `ARCANE_API_KEY`, `REPO_TOKEN`, `SECRET_SYNC_PAT`.
- PR-safe guard for secret-requiring jobs: `if: ${{ secrets.AUTOMATION_GITHUB_APP_ID != '' }}` (`.github/sync-files.yaml`).
- Secrets are distributed by `1password-secret-sync` driven by a `.github/secret-sync.yaml` config.

## Org registration

`.github/.github/workflows/sync-labels.yaml` carries a hardcoded `matrix.repo` list of every nsheaps repo. A new repo must be added there (and likely to `ansible/config/sync-files.yml`) or it gets no labels and no file sync. Tracked in task #11.

## Gotchas

- `claude-utils` **vendors** `github-app-auth` at `.github/actions/github-app-auth/action.yml` instead of `uses: nsheaps/github-actions/...@main`. The copy has drifted: it uses `actions/create-github-app-token@v2` and `actions/checkout@v4` where upstream uses SHA-pinned `@v2` and **checkout v6**. Do not vendor — reference upstream.
- `github-app-auth` ends with a hidden `actions/checkout` step that re-checks-out the repo with the app token (`clean: false`). Any files written before the auth step survive, but be aware the working tree is re-materialized.
- `github-app-auth` exports both `GH_TOKEN` and `GITHUB_TOKEN` into `$GITHUB_ENV`, so later steps get them implicitly.
- `claude-utils/check.yaml` runs editorconfig twice (`editorconfig-checker/action-editorconfig-checker@main` then `run: editorconfig-checker`) — redundant, do not copy.
- `claude-utils/check.yaml` triggers on bare `push:` (all branches, no PR trigger) while `test.yaml` triggers on `push: main` + `pull_request`. Inconsistent; pick `push: [main]` + `pull_request` for everything.
- `[skip ci]` in the release commit message is what stops the release loop.
