# auto-update

- modeled on `nsheaps/claude-utils`' `run-claude` update loop (see `docs/research/patterns-autoupdate.md`), adapted for zero-TTY operation.
- `run-claude`'s original gate is `gum confirm` — daemon has no TTY, so this becomes always-yes, fail-open: check on an interval, if a newer release exists, download + swap + restart the child process, log the outcome either way.
- also re-syncs the settings repo (see [[settings-repo-sync]]) on the same interval or a separate one — two independent update surfaces: the daemon binary itself (via brew/GH release) and the settings repo content (via git pull).
- interval: 5 hours, matching the existing cooldown precedent, configurable via an env var for testing.
- no rollback in MVP (explicit scope cut, see [[overview]]) — if the new binary fails a basic smoke check (`--version` exits 0) don't swap; if it swaps and then the daemon crash-loops, that's a `brew services` crash-loop, visible in logs, not silently masked.
- must not update mid-remote-session in a way that drops an active connection without warning — at minimum, log a notice; a graceful drain is a post-MVP improvement.
