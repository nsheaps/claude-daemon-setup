# Shared Toolchain Patterns (nsheaps/claude-utils + nsheaps/.github)

Scanned 2026-08-08. Sources:

- `/Users/nathan.heaps/src/nsheaps/claude-utils` — bash CLI repo, Homebrew-released
- `/Users/nathan.heaps/src/nsheaps/.github` — org config repo, TypeScript GH Actions + Ansible

See also [[patterns-ci]], [[patterns-repo-layout]] if/when written.

## Summary of what is present vs absent

| Convention                | claude-utils           | .github                     |
| ------------------------- | ---------------------- | --------------------------- |
| mise                      | `mise.toml` (no dot)   | `.mise.toml` (dotted)       |
| direnv `.envrc`           | **ABSENT**             | **ABSENT**                  |
| nx                        | ABSENT                 | `nx.json` + yarn workspaces |
| yarn berry                | 4.12.0 via packageManager | 4.6.0 via packageManager |
| `.yarnrc.yml`             | `nodeLinker: node-modules` | same (identical file)   |
| bun                       | **ABSENT** (no runtime use, no `--compile`) | **ABSENT** |
| `.editorconfig`           | present                | **ABSENT**                  |
| `.shellcheckrc`           | present                | ABSENT (no shell)           |
| `eslint.config.js`        | ABSENT (no TS)         | present (flat config)       |
| `renovate.json`           | present                | present (extended)          |

**Bun is nowhere in either repo.** The only "bun" grep hit is `brew bundle install` in
`bin/lib/stdlib.sh:418`. There is a research doc at
`/Users/nathan.heaps/src/nsheaps/claude-utils/docs/research/bun-vs-node-debate.md` whose
verdict is *"Bun is production-viable for teams who validate their stack, but not a universal
Node replacement yet."* So there is **no existing standalone-binary compile pattern to copy** —
if claude-daemon-setup wants `bun build --compile`, it is net-new and should be specced.

## mise — exact pins

`claude-utils/mise.toml` (note: **no leading dot**):

```toml
[tools]
node = "lts"
yarn = "4"
shfmt = "latest"
```

`.github/.mise.toml` (**dotted**, and pins harder):

```toml
[tools]
node = "22"
yarn = "4.6.0"
python = "3.11"
github-cli = "latest"

[settings]
experimental = true
```

Pattern notes:

- Two different filename conventions exist; pick `mise.toml` (undotted, newer repo) for a new repo.
- Task naming is stable across both: `setup`, `lint`, `fmt`/`fmt-check`, `test`, `build`, `check`.
- `check` is always the CI-equivalent aggregate: `depends = ["lint", "fmt-check", "test"]` then
  `run = "echo 'All checks passed'"`.
- Multi-line tasks use `run = """ ... """` with `#!/usr/bin/env bash` + `set -euo pipefail`.
- `$MISE_PROJECT_ROOT` is used to `cd` inside tasks (`.mise.toml` `sync-files`).
- Header comment block documenting prerequisites + usage is present in `.github/.mise.toml`:

  ```toml
  # Prerequisites:
  #   - mise: https://mise.run
  # Usage:
  #   mise run          # Show available tasks
  #   mise run setup    # Install dependencies
  #   mise run check    # Run all checks (CI equivalent)
  ```

## yarn

Both repos: Yarn Berry v4, node-modules linker, no zero-installs.

`.yarnrc.yml` — **identical in both, one line**:

```yaml
nodeLinker: node-modules
```

`.yarn/` contains only `install-state.gz` (gitignored). No `.yarn/releases/` checked in —
yarn comes from mise + `packageManager`.

`packageManager` field styles differ:

- `claude-utils`: `"yarn@4.12.0+sha512.f45ab632..."` (with integrity hash — corepack style)
- `.github`: `"yarn@4.6.0"` (bare)

Copy the hashed form; it's the newer repo and is corepack-verifiable.

## nx (only in .github)

`package.json` root:

```json
{
  "name": "@nsheaps/dotgithub",
  "private": true,
  "type": "module",
  "packageManager": "yarn@4.6.0",
  "workspaces": [".github/actions/*"],
  "scripts": {
    "build": "nx run-many --target=build --all",
    "test": "nx run-many --target=test --all",
    "check": "nx run-many --target=check --all",
    "fix": "nx run-many --target=fix --all",
    "lint": "nx run-many --target=lint --all"
  }
}
```

Dev deps pinned as carets: `nx ^20.0.0`, `typescript ^5.7.0`, `eslint ^9.0.0`,
`typescript-eslint ^8.0.0`, `@eslint/js ^9.0.0`, `@types/node ^22.0.0`, `tsx ^4.19.0`.

`nx.json` — no plugins, no daemon config, just target defaults:

```json
{
  "defaultBase": "main",
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "sharedGlobals": ["{workspaceRoot}/tsconfig.base.json"]
  },
  "targetDefaults": {
    "build": { "dependsOn": ["^build"], "inputs": ["default"], "cache": true },
    "test":  { "inputs": ["default"], "cache": true },
    "check": { "inputs": ["default"], "cache": true },
    "lint":  { "inputs": ["default"], "cache": true },
    "fix":   { "inputs": ["default"], "cache": false }
  }
}
```

**There are no `project.json` files.** Projects are inferred purely from yarn workspaces +
each package's `package.json` `scripts`. Per-project scripts follow a fixed contract:

```json
"scripts": {
  "build": "tsc",
  "test": "echo 'No tests yet'",
  "check": "tsc --noEmit && eslint src/",
  "lint": "eslint src/",
  "fix": "eslint src/ --fix"
}
```

`tsconfig.base.json` (root) — ES2022 / NodeNext / strict:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "lib": ["ES2022"], "types": ["node"], "strict": true,
    "esModuleInterop": true, "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true, "resolveJsonModule": true,
    "declaration": true, "declarationMap": true, "sourceMap": true
  }
}
```

Per-project `tsconfig.json`: `{"extends": "../../../tsconfig.base.json", "compilerOptions": {"outDir": "dist", "rootDir": "src"}, "include": ["src/**/*"]}`
— and `dist/` is **committed** for GH Actions (not gitignored there).

`eslint.config.js` (flat, ESM, root only):

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ["**/dist/**", "**/node_modules/**", ".yarn/**"] }
);
```

## editorconfig / shellcheck / shfmt (claude-utils)

`.editorconfig` — 2-space, LF, UTF-8, final newline; `[*.json] insert_final_newline = ignore`;
`[Makefile] indent_style = tab`; `[*.sh] switch_case_indent = true` (**shfmt reads this**);
`[*.md] trim_trailing_whitespace = false`.

`.editorconfig-checker.json`:

```json
{ "Exclude": ["docs/research/", "docs/reports/", ".claude/tmp/"] }
```

`.shellcheckrc`:

```
shell=bash
disable=SC1091   # dynamic sourced paths ($SCRIPT_DIR)
disable=SC2034   # vars exported / used by sourcing scripts
```

The lint/fmt mise tasks discover bash files by **shebang sniffing** (`head -1 "$f" | grep -q 'bash'`)
across `bin`, `bin/lib`, `test` — because `bin/` scripts are extensionless. CI
(`.github/workflows/check.yaml`) does the same with `grep -qE '(bash|^#!/bin/sh)'` and passes the
list through `$GITHUB_OUTPUT`.

## renovate

`claude-utils/renovate.json` — the minimal form a new repo should copy verbatim:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>nsheaps/renovate-config"]
}
```

`.github/renovate.json` additionally disables automerge for minor/patch and enables the
`ansible`, `github-actions`, `npm`, `pip_requirements` managers with `fileMatch` overrides.

## CI conventions

Both repos use `jdx/mise-action@v2` (with `install: true` in `.github`) and then call
`mise run <task>` so local and CI are the same code path. `.github` factors this into a composite
action at `.github/actions/setup/action.yaml`.

`claude-utils/.github/workflows/check.yaml` uses a concurrency group worth copying:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

Release: `release-it` + `@release-it/conventional-changelog` driven by `.release-it.json`
(`npm: false`, tag `v${version}`, commit `chore: release v${version} [skip ci]`, `after:bump` hook
sed-patches the version constant into `bin/lib/claude.lib.sh`). Homebrew formula is a
**gomplate template** at `Formula/claude-utils.rb.gotmpl` rendered in CI into a PR against
`nsheaps/homebrew-devsetup`, with stale-PR closing and retrying `gh pr merge --auto --squash`.
Auth is via the local composite action `.github/actions/github-app-auth/action.yml`
(wraps `actions/create-github-app-token@v2`, derives bot user id/email, `gh auth setup-git`).

## File layout a new repo should copy

```
mise.toml                     # tools + setup/lint/fmt/fmt-check/test/check tasks
.yarnrc.yml                   # nodeLinker: node-modules
package.json                  # private:true, type:module, packageManager yarn@4.x+sha512
.editorconfig
.editorconfig-checker.json
.shellcheckrc                 # if any bash
renovate.json                 # extends github>nsheaps/renovate-config
.gitignore                    # node_modules, .yarn/* with !.yarn/{patches,plugins,releases,sdks,versions}, dist/, .mise.local.toml
LICENSE                       # MIT
docs/research/, docs/specs/{draft,reviewed,...}
.github/workflows/{check,test,release}.yaml
.github/actions/github-app-auth/action.yml
# only if multi-package TypeScript:
nx.json, tsconfig.base.json, eslint.config.js, workspaces in package.json
```

## Gaps a new repo must decide on (no precedent to copy)

1. **direnv** — no `.envrc` in either repo; mise covers env/tool activation today.
2. **bun / standalone binaries** — absent. claude-utils ships plain bash via Homebrew, `.github`
   ships committed `dist/index.js`. A compiled-binary release flow is net-new.
3. **nx + bash** — nx exists only where TypeScript exists; claude-utils uses mise tasks alone.
4. **mise filename** — `mise.toml` vs `.mise.toml` is inconsistent; pick one and note it.
