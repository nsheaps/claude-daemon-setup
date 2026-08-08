# release packaging

- runtime: `bun`. `bun build --compile` → standalone binary, one per target triple (`darwin-arm64`, `darwin-x64` at minimum — this is a personal-mac tool first).
- binaries attached to the GitHub release as assets (departure from the org's normal source-tarball pattern — justified because the whole point is a self-contained daemon binary with no runtime `bun`/`node` dependency on the target mac).
- versioning/release: `release-it` + `@release-it/conventional-changelog`, tag `v${version}`, `chore: release v${version} [skip ci]`, matches [[../research/patterns-ci-release|patterns-ci-release]].
- Homebrew: **not a new tap.** One more formula file in `nsheaps/homebrew-devsetup`. `Formula/claude-daemon.rb.gotmpl` lives in *this* repo; release workflow renders it, opens a PR into `homebrew-devsetup`, auto-merges — same pipeline as other nsheaps formulas.
- formula shape deviates from the tap's norm in exactly one way: `url`/`sha256` point at the compiled binary asset per-arch, not a source tarball; `def install` is `bin.install "claude-daemon-#{arch}" => "claude-daemon"`, no build step.
- `service do` block (new — no precedent anywhere in the org, see `docs/research/patterns-index.md` gap #6): `run [opt_bin/"claude-daemon", "service"]`, `keep_alive true`, `log_path`/`error_log_path` into `~/.claude-daemon/logs/`, `environment_variables` left empty (env comes from the plist written by `setup`, per [[daemon-service]], not the formula).
- `post_install`: runs `claude-daemon setup` (interactive prompt for `CLAUDE_DAEMON_SETTINGS_REPO` etc.) then `brew services start claude-daemon` — both against Homebrew convention, both explicitly requested by the user.
