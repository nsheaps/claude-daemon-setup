# daemon service

- packaged as a `brew services` job — `service do ... end` block in the Formula, see [[release-packaging]].
- installed against best-practice: **enabled to run at login automatically on `brew install`**, per explicit user instruction — normally formulas leave `brew services start` to the user; this one does not.
- interactive auto-config runs once, at install time, via the formula's `post_install` invoking `<binary> setup` — prompts for `CLAUDE_DAEMON_SETTINGS_REPO` (and anything else [[config-isolation]] needs) and writes it into the launchd plist's `EnvironmentVariables`, since a service process has no shell profile / no TTY to source it from later.
- entrypoint contract:
  1. if `CLAUDE_DAEMON_SETTINGS_REPO` unset → print error to stderr, exit 1. no default, no silent skip.
  2. clone/sync settings repo per [[settings-repo-sync]].
  3. set up `~/.claude-daemon/` per [[config-isolation]].
  4. sync skills/agents/rules symlink farm.
  5. invoke `claude remote-control` (or equivalent) inside the isolated env.
  6. auto-update loop, see [[auto-update]].
- **MVP checkpoint (task scaffolding step 5):** steps 1–2 working, `brew services start` supervises the process without immediately erroring out of `brew services list`, even if steps 3–6 aren't implemented yet and the process later crashes on missing logic. Crashing here is acceptable and expected; "started" at the launchd level is the bar for this checkpoint, not "working."
- logs: launchd `StandardOutPath`/`StandardErrorPath` → `~/.claude-daemon/logs/service.log`, so `brew services` crash-looping is diagnosable without extra tooling.
- teardown: `brew services stop <name>` — must actually stop the `claude remote-control` child process, not just the wrapper (process-group kill, not a bare `kill $PID`).
