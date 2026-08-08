# claude-daemon-setup — overview

- goal: turn any mac into a temporary [Claude Code](https://code.claude.com) [[remote-control-mechanism|Remote Control]] host, via `brew services`.
- MVP = installable + starts as a service + doesn't need to work perfectly yet (crashing at service-start is an acceptable checkpoint, see [[daemon-service]]).
- not a new tap — ships into the existing `nsheaps/homebrew-devsetup` tap, see [[release-packaging]].
- config lives outside `~/.claude` entirely — isolated root at `~/.claude-daemon/`, see [[config-isolation]].
- the isolated root is populated from a user-owned settings repo (skills/agents/rules), see [[settings-repo-sync]].
- service identity (its name in `brew services list`, launchd label, Remote Control session name) comes from that settings repo's `agent.yaml` → `agent.name`, see [[settings-repo-sync]].
- ships as a compiled `bun` binary attached to GitHub releases, formula just downloads + installs it, see [[release-packaging]].
- self-updates on an interval once running, see [[auto-update]].
- CI mirrors `mise run check`, see [[ci-workflows]].
- docs published to GitHub Pages, see [[docs-site]].
- companion template repo `nsheaps/daemon-agent-template` is the thing users fork to make their own `CLAUDE_DAEMON_SETTINGS_REPO`, see [[daemon-agent-template]].

## build order (do not reorder)

1. ✅ specs (this doc graph) — draft now, refine after each phase.
2. ✅ CI workflow scaffold — check/test/release/docs workflows written; release.yaml not yet runnable end-to-end (depends on a real tagged release).
3. ✅ project scaffold — mise/direnv/yarn/tsconfig/eslint/bun, no daemon logic yet.
4. ✅ build/test/release/publish pipeline + brew formula — `Formula/claude-daemon.rb.gotmpl`, `.release-it.json` written; formula not yet rendered/published to `nsheaps/homebrew-devsetup` (needs a real tag).
5. ✅ service wiring, MVP checkpoint verified locally: `bun build --compile` produces a working binary; `--version`/`--help` exit 0; `service` exits 1 with a clear, documented error when `CLAUDE_DAEMON_SETTINGS_REPO` is unset. Real `brew install`/`brew services start` deliberately not run — the formula isn't published yet, and doing so would mutate this host's real Homebrew/launchd state and the shared tap.
6. ✅ the minutiae — `src/lib/{config-isolation,settings-repo-sync,remote-control,auto-update}.ts` written and typecheck clean. Known open gaps (not yet resolved, tracked in-code as TODOs):
   - auto-update's binary download/swap step detects a newer release but does not yet download/swap it — blocked on finalizing per-arch release asset naming.
   - the `GIT_AUTHOR_*` question from [[config-isolation]] is still untested.
   - ~~`remote-control.ts` uses `--setting-sources project,local`~~ — dropped. Isolation is now pure env vars (`CLAUDE_CONFIG_DIR` etc.), matching `nsheaps/agents`' proven `agent-env.sh` pattern, not a CLI flag. See [[config-isolation]].
   - `setup` now hands off to an interactive `claude` session running three `context: fork` skills (`claude-login-setup`, `git-credentials-setup`, `1password-vault-setup`) — see [[config-isolation]]'s "setup skills" section. GitHub App *provisioning* and 1Password *service-account* creation are confirmed human-only, web-console steps (no CLI/API path exists) — the skills consume existing credentials/guide the human through those two steps rather than faking automation that isn't possible.
7. ✅ docs site (Starlight, `site/`) + `daemon-agent-template` (scaffolded, pushed, marked as a GitHub template repo) + org registration ([nsheaps/.github#197](https://github.com/nsheaps/.github/pull/197), open).

Not yet done, deliberately deferred beyond this scaffolding pass: cutting a real tagged release, publishing the formula, and an actual `brew install` end-to-end test — each mutates shared/external state (a GitHub release, the `homebrew-devsetup` tap, this host's launchd) and belongs to a follow-up pass with the user present, not an unattended scaffold.

## explicit resolutions to research gaps

Recorded here so scaffolding doesn't re-litigate them. See `docs/research/patterns-index.md` §"Conflicts and gaps" for the source list.

- `mise.toml` (undotted). `packageManager` with integrity hash. Ref-based concurrency. Diff-check-only format job (fail, don't auto-commit — a daemon-adjacent repo should never push unreviewed formatting). SHA-pin third-party actions.
- prebuilt binaries: yes, `bun build --compile`, one per target triple, attached to the GH release; formula downloads the binary directly (no `bin.install` from source tarball — this repo is the one exception to the existing pattern, because the whole point is a self-contained daemon binary).
- non-interactive update path: required from day one (daemon has no TTY) — see [[auto-update]]. No rollback in MVP; log and continue running the old process if the new binary fails a smoke check.
- `agent.yaml`: this repo defines the schema (see [[settings-repo-sync]]), since nothing else does yet.
- `CLAUDE_CONFIG_DIR` does not isolate `CLAUDE.md` memory discovery (it recurses from cwd upward regardless) — accepted as a known limitation, not solved in MVP. Document it loudly in [[config-isolation]].
- direnv: adopted, `.envrc` + `mise` (matches `ai-agent-henry`, not the released tooling repos — released repos didn't need per-directory env, this one does because of the isolated XDG root).
- docs site: greenfield, see [[docs-site]].
- org registration: add to `.github/.github/workflows/sync-labels.yaml` matrix and `ansible/config/sync-files.yml`, see [[org-registration]].
