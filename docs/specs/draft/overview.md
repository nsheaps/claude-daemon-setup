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

1. specs (this doc graph) — draft now, refine after each phase.
2. CI workflow scaffold — empty checks that at least run.
3. project scaffold — mise/direnv/nx/bun, no daemon logic yet.
4. build/test/release/publish pipeline + brew formula — installable.
5. service wiring — `brew services start` succeeds at the process-supervision level; daemon logic itself may still crash. That crash is expected and OK at this checkpoint.
6. the minutiae — config isolation, settings-repo sync, skills symlink mechanism, remote-control invocation, auto-update loop. Only now does the daemon actually work.
7. docs site + daemon-agent-template + org registration, in parallel with step 6 once step 5 is stable.

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
