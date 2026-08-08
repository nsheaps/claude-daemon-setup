# Auto-Update Patterns from `nsheaps/claude-utils`

Source repo scanned: `/Users/nathan.heaps/src/nsheaps/claude-utils` (branch `main`, scanned 2026-08-08).
Related: [[patterns-repo-scaffold]], [[patterns-release-publish]], [[spec-daemon-service]]

## TL;DR

- Auto-update is **launch-time, not background**. There is **no launchd/cron/timer plumbing anywhere in the repo** (verified: zero hits for `launchd|launchctl|plist|crontab|LaunchAgents`).
- Two separate update loops live in one script, `bin/run-claude`:
  1. **Homebrew formula check** — `brew outdated` + interactive `gum confirm` + `brew upgrade`.
  2. **Claude Code plugin update** — `claude plugin update <name>` per installed plugin, gated by a **5-hour cooldown timestamp file**.
- Mid-work restart is avoided structurally: all update work runs **before** the long-lived process starts, then the script `exec`s/`command`s into `claude`. Nothing touches the binary while a session runs.
- Failure handling is **fail-open**: every update command is `|| true` / `|| echo ...` so a broken network or tap never blocks launch. There is **no rollback** for updates; rollback exists only for `settings.json` (backup + hash compare).

## 1. Homebrew self-update loop

`bin/run-claude:36-47` — runs on every launch, before Claude starts:

```bash
CHECK_FOR_UPDATES_ON_FORMULAE=("claude-code" "claude-utils")
AVAILABLE_UPDATES="$(HOMEBREW_NO_AUTO_UPDATE=1 brew outdated --verbose "${CHECK_FOR_UPDATES_ON_FORMULAE[@]}" || true)"
if [[ -n "$AVAILABLE_UPDATES" ]]; then
  cat <<EOF
Updates are available for the following formulae:"
$(echo "$AVAILABLE_UPDATES" | xargs -I{} echo " - local {} remote")

EOF
  if gum confirm "Do you want to upgrade them now?"; then
    brew upgrade "${CHECK_FOR_UPDATES_ON_FORMULAE[@]}" || echo "looks like upgrade failed, continuing anyway..."
  fi
fi
```

Patterns to replicate:

- **The tool updates itself alongside its dependency.** `claude-utils` is in its own check list, so running `run-claude` upgrades the very package that provides `run-claude`.
- `HOMEBREW_NO_AUTO_UPDATE=1` on the *check* — do not pay the full `brew update` tax just to ask "is there a newer version?". The subsequent `brew upgrade` is allowed to update taps.
- `|| true` on the check: a formula that isn't installed, or an offline machine, must not `set -e` the launcher out.
- `|| echo "... continuing anyway..."` on the upgrade: a failed upgrade is a warning, never fatal.
- Interactive consent via `gum confirm` (`gum` is a hard `depends_on` in the formula). **A daemon has no TTY — this is the one piece that cannot be copied verbatim.** See [[spec-daemon-service]] for the non-interactive substitute.

The standalone one-liner, `bin/claude-update:23`, is just:

```bash
exec brew upgrade claude-code
```

Note it does **not** include `claude-utils` — only the launcher's inline check does.

## 2. Plugin update loop with cooldown

`bin/run-claude:49-90`. This is the closest thing in the repo to a periodic-check pattern, and the part most worth copying into a daemon:

```bash
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"
INSTALLED_PLUGINS_FILE="$CLAUDE_HOME/plugins/installed_plugins.json"
PLUGIN_CHECK_TIMESTAMP="$CLAUDE_HOME/.plugin-check-timestamp"
PLUGIN_CHECK_COOLDOWN_SECONDS=$((5 * 60 * 60)) # 5 hours

_plugin_check_needed() {
  if [[ ! -f "$PLUGIN_CHECK_TIMESTAMP" ]]; then
    return 0 # No timestamp — check needed
  fi
  local last_check now elapsed
  last_check="$(cat "$PLUGIN_CHECK_TIMESTAMP")"
  now="$(date +%s)"
  elapsed=$((now - last_check))
  if [[ $elapsed -ge $PLUGIN_CHECK_COOLDOWN_SECONDS ]]; then
    return 0 # Cooldown expired
  fi
  return 1 # Still within cooldown
}
```

and the body:

```bash
if [[ -f "$INSTALLED_PLUGINS_FILE" ]] && command -v jq &>/dev/null && _plugin_check_needed; then
  PLUGIN_NAMES="$(jq -r '.plugins | keys[]' "$INSTALLED_PLUGINS_FILE" 2>/dev/null)"
  if [[ -n "$PLUGIN_NAMES" ]]; then
    UPDATED_PLUGINS=()
    while IFS= read -r plugin; do
      output="$(command claude plugin update "$plugin" 2>&1 || true)"
      # Check if the output indicates an actual update (not "already up to date")
      if [[ -n "$output" ]] && ! echo "$output" | grep -qi "already up.to.date\|no update\|up to date"; then
        UPDATED_PLUGINS+=("$plugin")
      fi
    done <<<"$PLUGIN_NAMES"
    ...
  fi
  # Record check timestamp regardless of whether updates were found
  date +%s >"$PLUGIN_CHECK_TIMESTAMP"
fi
```

Patterns to replicate:

- **Interval = timestamp file + epoch delta**, not a scheduler. `~/.claude/.plugin-check-timestamp` holds a bare `date +%s`. A daemon loop can reuse this exact predicate so that daemon restarts don't cause a check storm.
- **Timestamp is written unconditionally**, even when nothing updated and even when individual updates failed — this prevents a persistently failing update from hammering the network every launch.
- **Preconditions guard the whole block**: manifest file exists, `jq` exists, cooldown expired. Missing tooling silently skips rather than erroring.
- **Update detection is output-sniffing**, because `claude plugin update` has no distinct "no-op" exit code: `grep -qi "already up.to.date\|no update\|up to date"`. Fragile, but it is the existing pattern; a daemon should prefer comparing version fields from `installed_plugins.json` before/after if possible.
- Per-plugin `|| true` — one bad plugin does not abort the rest.
- Only a summary is printed, and only when something actually changed (`UPDATED_PLUGINS` array).

## 3. How restarting mid-work is avoided

There is no mid-work restart logic because there is no long-running supervisor. The ordering is the entire mechanism:

```
run-claude
  → brew outdated / brew upgrade      (line 36-47)
  → claude plugin update loop         (line 49-90)
  → claude_check_settings_backup      (line 92)
  → trap claude_check_settings_backup EXIT   (line 94)
  → simple_claudeish "$@"             (line 96)  ← replaces process, runs for hours
```

`simple_claudeish` (`bin/lib/claude.lib.sh:98-106`) is the final handoff:

```bash
simple_claudeish() {
  local FLAGS=("--allow-dangerously-skip-permissions" "$@")
  echo "Launching claude with flags:" >&2
  for flag in "${FLAGS[@]}"; do echo "  $flag" >&2; done
  command "claude" "${FLAGS[@]}"
}
```

Corollary for the daemon: **a daemon that supervises long-lived Claude sessions cannot use this ordering directly.** The applicable translation is: check on the interval, but only *apply* the upgrade at a quiescent boundary (no active session), otherwise defer to the next tick. That constraint is absent from claude-utils and must be newly designed — see [[spec-daemon-service]].

The draft spec `docs/specs/draft/3-script-architecture-plan.md` also introduces a **`--skip-update-check` flag** so nested invocations don't re-run the check:

> - Add `--skip-update-check` flag parsing: strip the flag from `$@` before passing to `simple_claudeish`
> - Direct invocation (`run-claude`): checks for updates as before
> - Called by orchestrator (`run-claude --skip-update-check ...`): skips update check

Status: **not implemented** — `bin/claude-team` and `bin/ct` contain zero update logic today (verified by grep). The intended refactor extracts `claude_check_for_updates()` into `bin/lib/claude.lib.sh`; that function does not yet exist.

## 4. Failure handling / rollback

There is **no rollback for package updates**. The only rollback-shaped code protects `~/.claude/settings.json`, in `claude_check_settings_backup` (`bin/lib/claude.lib.sh:151-199`), run both before launch and via `trap ... EXIT`:

```bash
    # Fail if the file is empty
    if [[ ! -s "$current_file" ]]; then
      error "$current_file is empty!"
      if [[ -n "$latest_backup" ]]; then
        error "Restore from backup with:"
        hint "cp \"$latest_backup\" \"$current_file\""
      ...
    # Compare hashes
    current_hash="$(shasum -a 256 "$current_file" | cut -d' ' -f1)"
    backup_hash="$(shasum -a 256 "$latest_backup" | cut -d' ' -f1)"
    if [[ "$current_hash" == "$backup_hash" ]]; then continue; fi
    warn "WARNING: $rel_path has changed since last backup ($latest_backup)"
    _claude_backup_file "$rel_path"
```

Backups go to `~/.claude/backups/YYYY-MM-DD/<rel_path>` (`_claude_backup_file`). Restore is **manual** — the script prints the `cp` command rather than running it. Worth strengthening for the daemon (auto-restore on empty-file detection).

## 5. Version identity & release plumbing (what "a new version" means)

- Single source of truth is a shell constant, `bin/lib/claude.lib.sh:17`: `CLAUDE_UTILS_VERSION="v0.10.0"`.
- It is rewritten by release-it on bump, `.release-it.json`:
  ```json
  "hooks": { "after:bump": "sed -i.bak 's/^CLAUDE_UTILS_VERSION=.*/CLAUDE_UTILS_VERSION=\"v${version}\"/' bin/lib/claude.lib.sh && rm -f bin/lib/claude.lib.sh.bak" }
  ```
- Distribution is **Homebrew from a personal tap**, not GH-release binaries and not `git pull`. `.github/workflows/release.yaml` job `update-homebrew` renders `Formula/claude-utils.rb.gotmpl` with `gomplate`, opens a PR against `nsheaps/homebrew-devsetup`, closes superseded PRs, and enables auto-merge with a 5-attempt backoff (`wait=$((attempt * 10))`).
- The formula tarball is pinned by tag + sha256 computed in CI from `archive/refs/tags/${TAG}.tar.gz`; it also declares `head do ... branch: 'main'`, and `depends_on 'fzf'` / `depends_on 'gum'`.

So: **the update channel a daemon must consume is `brew upgrade` against `nsheaps/homebrew-devsetup`.** Not GitHub Releases API, not `git pull`.

## Absent in the source repo (must be designed fresh)

- launchd `.plist` / LaunchAgent / cron / systemd unit — none.
- Any background/daemonized update process — none.
- Non-interactive (no-TTY) update path — none; `gum confirm` requires a terminal.
- Quiesce/drain logic to avoid upgrading during an active session — none.
- Automatic rollback of a bad upgrade — none.
- Version-comparison logic in-script (e.g. semver compare) — none; it defers entirely to `brew outdated`.
