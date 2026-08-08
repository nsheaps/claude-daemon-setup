# claude-daemon-setup — working notes

Notes captured while manually setting up this machine as a temporary environment for
Claude Code on the web. Intended to become `nsheaps/claude-daemon-setup`, which should
programmatically enforce/verify each step below.

- **Started:** 2026-08-08
- **Host:** Nathans-MacBook-Pro-2.local
- **Status:** IN PROGRESS — mechanism research pending

---

## 0. Baseline inventory (captured before any changes)

Verified 2026-08-08. A future `claude-daemon-setup doctor` should assert these.

| Component | Found | Notes |
| --- | --- | --- |
| macOS | 26.3 (build 25D125) | Darwin 25.3.0, arm64 (T6041 / Apple Silicon) |
| Claude Code | 2.1.220 | `/opt/homebrew/bin/claude` (Homebrew install) |
| node | v24.11.1 | via mise (`~/.local/share/mise/installs`) |
| bun | 1.3.3 | via mise |
| yarn | 1.22.22 | via mise/corepack — note: corepack present |
| git | 2.52.0 | |
| gh | 2.86.0 | authed as `nsheaps` (keyring), scopes: gist, read:org, repo, workflow |
| brew | 6.0.15 | `/opt/homebrew` |
| tmux | 3.6a | |

**Toolchain implication for the repo:** node/bun/yarn are managed by **mise**, not system
installs. Any daemon/launchd unit must source the mise shims or use absolute paths —
a bare `launchd` job will NOT have mise's PATH. This is a likely failure mode to encode
as a check.

## 1. Power / sleep state

`pmset -g` at baseline:

```
sleep         0 (sleep prevented by caffeinate, bluetoothd, powerd)
disksleep     10
displaysleep  10
standby       1
powernap      1
tcpkeepalive  1
womp          1
```

System sleep is already effectively disabled (something is holding `caffeinate`).
For a remote environment the machine must stay reachable, so:

- REQUIRE: `sleep 0` (or an explicit `caffeinate` held for the session duration)
- Display sleep is fine — it does not stop compute.
- Note `standby 1` / `hibernatemode 3` are irrelevant while `sleep 0` holds.

**Open question for the repo:** should setup take its own `caffeinate -i` lease scoped to
the session rather than relying on an ambient one it didn't create? Leaning yes — an
ambient caffeinate can disappear without warning. Teardown must release it.

## 2. Security findings — MUST be addressed by the tool

### 2.1 Plaintext credentials in `~/.claude/settings.json`

The user-scope settings file currently contains **three live secrets in plaintext**:

- `env._ANTHROPIC_AUTH_TOKEN` — `sk-ant-oat01-…` OAuth token
- `env._CLAUDE_CODE_OAUTH_TOKEN` — `sk-ant-oat01-…` OAuth token
- `env.ANTHROPIC_CUSTOM_HEADERS` — `cf-aig-authorization: Bearer …` (Cloudflare AI Gateway)

Any session on this host — including a remote one — can read this file. Handing the
machine to a remote environment should be treated as **disclosing all three**.

Required behavior for `claude-daemon-setup`:

- `doctor` MUST scan settings files for secret-shaped values and fail loudly.
- Recommend moving these to `apiKeyHelper` / keychain rather than inline `env`.
- Teardown MUST prompt to rotate anything that was exposed.

### 2.2 Risky permission posture for unattended use

- `skipDangerousModePermissionPrompt: true` — removes the guardrail in front of
  `--dangerously-skip-permissions`.
- `permissions.defaultMode: "default"` (good), but the broad `allow` list includes
  wide wildcards: `Bash(mise:*)`, `Bash(yarn:*)`, `Bash(npm:*)`, `Bash(pnpm:*)`,
  `Bash(just:*)`, `Bash(turbo:*)`. Each of these can execute arbitrary code via
  project scripts — they are effectively `Bash(*)` in any repo the agent can reach.
- `permissions.additionalDirectories` includes `~/.claude` — grants write access to
  the very config (and secrets) above.

Required behavior: setup should apply a **narrowed, temporary permission overlay** for
the remote environment rather than inheriting the interactive-use posture, and restore
the original on teardown. Backing up `settings.json` before modification is mandatory
(never edit in place without a `.bak`).

### 2.3 Telemetry egress

`CLAUDE_CODE_ENABLE_TELEMETRY=1` with OTLP export to `otlp.uptrace.dev` and API traffic
routed through a Cloudflare AI Gateway. Remote-session activity will be attributed to
this account's telemetry. Not a blocker — just needs to be a documented consequence.

## 3. Mechanism — how the web actually attaches to this box

**CONFIRMED.** Full detail in [[remote-control-mechanism]]. Summary:

- Feature is **Remote Control**: `claude remote-control` (subcommand, not the
  `--remote-control [name]` flag — both exist; the subcommand is what `claude-daemon`
  should drive). Also `/remote-control` from within a session, and the `/remote-env`
  slash alias observed in this session.
- On installed **2.1.220**, `claude remote-control --help` shows **only `-h`** — no
  `--name`/`--sandbox`/`--capacity`/`--spawn` flags exist yet. Re-verify against the
  actual installed binary before scripting; do not trust doc-derived flag lists.
- **Blocker confirmed live on this host:** Remote Control refuses to start with
  `ANTHROPIC_BASE_URL` set to the Cloudflare AI Gateway (see §2 above) — error:
  *"Remote Control is only available when using Claude via api.anthropic.com."*
  Unsetting the var in the shell does **not** help, because `~/.claude/settings.json`'s
  `env` block re-injects it every launch.
- **Workaround verified, non-destructive:** `claude --setting-sources project
  remote-control` — excludes user-scope settings entirely, so the gateway `env` block
  never applies and the global config file is untouched. This is the basis for the
  daemon's isolated-config design (§ config isolation, see specs).
- `claude auth status` confirms auth is claude.ai / Max plan / first-party API — no
  issue there.
- Settings keys: `remoteControlAtStartup`, `disableRemoteControl`, `dialogExpiry`.
- User has since run `/remote-control` (aka `/remote-env`) interactively and
  `/config` → "Enabled Remote Control for all sessions" — i.e. `remoteControlAtStartup`
  is now true in the global settings for *interactive* sessions. The **daemon** must
  not depend on that global toggle since it runs under an isolated settings root
  (`--setting-sources project` / a dedicated settings file) — it needs its own
  equivalent config.

## 4. Teardown checklist (draft)

- [ ] End/deregister the remote session
- [ ] Restore `settings.json` from `.bak`
- [ ] Release any `caffeinate` lease taken by setup
- [ ] Restore `pmset` values if changed
- [ ] **Rotate** the two `sk-ant-oat01-…` tokens and the Cloudflare AI Gateway bearer
- [ ] Consider `gh auth refresh` / token rotation for the `nsheaps` GitHub token
- [ ] Review `~/.claude/projects/**` and shell history for anything written remotely

## 5. Open questions

- Does Remote Control require the machine to hold an outbound connection (i.e. a
  foreground `claude` process), or can it survive as a background/launchd service?
- Session lifetime — does it expire, and does teardown need to be explicit?
- Does it constrain the working directory / require a git repo?
- How is access revoked server-side (claude.ai session list?) vs just killing the process?
