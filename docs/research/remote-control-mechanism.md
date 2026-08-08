# Claude Code Web + Local Machine Integration Research

**Date:** 2026-08-08  
**Query:** Connecting a local macOS machine to claude.ai/code for web-based use

> **VERIFIED CORRECTION (2026-08-08, claude-code-guide research agent output below was
> NOT fully accurate for the installed version):**
> On this machine, Claude Code **2.1.220**, `claude remote-control --help` shows
> **only `-h`/`--help`** — none of `--name`, `--sandbox`, `--capacity`, `--spawn`,
> `--create-session-in-dir` exist as documented below. Treat this doc's "Flags for
> `claude remote-control`" section as **aspirational/future-version**, not current
> fact. Always re-verify flags with `--help` against the actual installed binary
> before encoding them into scripts. See [[host-setup-notes]] for the live
> verification transcript.
>
> Also confirmed live on this host: **the custom-endpoint block is real and cannot
> be worked around by unsetting `ANTHROPIC_BASE_URL` in the shell alone** — it is
> re-injected via the `env` block in `~/.claude/settings.json`. Workaround verified:
> `claude --setting-sources project remote-control` (excludes user-scope settings,
> so the gateway `env` block never applies). See [[host-setup-notes]] §2 for the
> credential-exposure implications of that settings file before using it as a model.

---

## Summary

There is **no single "bring your own compute" daemon** feature that registers a personal laptop as a permanent backend for claude.ai/code. However, Claude Code offers three related patterns:

1. **Remote Control** — Your local CLI session, steered from the web (what users usually want)
2. **Teleport** — A cloud session, pulled down to the terminal (reverse direction)
3. **Self-hosted Environments** — Organization-level infrastructure (not personal laptops)

---

## 1. Remote Control — Local Execution, Web Control

**This is the closest match to "connect my local machine to claude.ai/code."**

### What It Is
Remote Control exposes a local Claude Code session running on your machine to claude.ai/code, the Claude mobile app, and other devices. Your code execution, filesystem access, MCP servers, and project config all stay on your machine. The web/mobile interfaces are just control surfaces.

### CLI Commands

**Start a Remote Control session (server mode):**
```bash
claude remote-control
```

**Or interactive mode (full session + remote access):**
```bash
claude --remote-control "Optional Session Name"
```

**Or from existing CLI session:**
```
/remote-control "Optional Session Name"
```

**For VS Code:**
```
/rc
```

**Resume a specific Remote Control session:**
```bash
claude remote-control --session-id <id>
claude remote-control --continue  # Resume most recent
```

### Prerequisites

1. **Subscription**: Pro, Max, Team, or Enterprise plans. API keys are **not** supported.
2. **Authentication**: `claude /login` to sign in via claude.ai (not an API key).
3. **Workspace trust**: Run `claude` in your project directory at least once to accept the workspace trust dialog. Start from a project directory, not home.
4. **No telemetry-disabling env vars**: Unset `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_GROWTHBOOK` if set.
5. **API endpoint**: Must use `api.anthropic.com`. **Not** available on Bedrock, Vertex AI, Foundry, or custom `ANTHROPIC_BASE_URL`.

### Configuration

**settings.json keys:**
- `remoteControlAtStartup: true` — Auto-connect Remote Control for all interactive sessions
- `disableRemoteControl: true` — Turn off Remote Control entirely
- `dialogExpiry: <milliseconds>` — How long to keep permission dialogs open for remote connection (default 5 min; requires v2.1.224+)

**Flags for `claude remote-control`:**
- `--name "Title"` — Custom session name visible in claude.ai/code
- `--sandbox` / `--no-sandbox` — Enable filesystem/network sandboxing (off by default)
- `--verbose` — Show detailed connection and session logs
- `--capacity <N>` — Max concurrent sessions (default 32)
- `--spawn <mode>` — Session isolation: `same-dir` (default), `worktree` (git), or `session` (single)
- `--[no-]create-session-in-dir` — Pre-create one session at startup (on by default)

### Network & Security

- **Outbound only**: Claude Code makes outbound HTTPS requests only. No inbound ports open.
- **Transport**: All traffic over TLS through Anthropic API (api.anthropic.com:443).
- **Authentication**: Uses multiple short-lived, scoped credentials expiring independently.
- **Transcript storage**: While connected, conversation transcript stored on Anthropic servers (to sync across devices and survive network drops). Execution and filesystem access remain local.
- **Trusted Devices** (Team/Enterprise only): Can require device enrollment + 18-hour reauthentication for web/mobile access.

### Session Persistence & Interruptions

- **Session survives network drops**: Automatically reconnects when machine comes online.
- **Local process must keep running**: If you close the terminal or quit VS Code, the session ends.
- **Extended outage (>~10 min)**: Session times out and process exits.
- **Workaround for SSH**: Use `tmux` or `screen` to keep sessions alive after disconnect.

### Limitations

- One remote session per interactive process (use server mode for multiple concurrent).
- Local machine must stay awake and connected.
- Extended network outage (>10 min) causes timeout.
- Some CLI commands local-only: `/plugin`, `/resume`, `/compact` (text form works remotely).
- Forwarded dialogs expire after 5 minutes by default (configurable via `dialogExpiry`).

### Comparison: Remote Control vs Claude Code on the Web

| Feature | Remote Control | Claude Code on Web |
|---------|---|---|
| Where session runs | Local machine | Anthropic cloud (or self-hosted) |
| Filesystem access | Local | Cloned from GitHub or bundled |
| MCP servers | Local | Cloud-provided or self-hosted setup |
| Network setup | Outbound to api.anthropic.com:443 | Managed by Anthropic |
| Best for | Continuing in-progress local work from another device | Starting tasks without local setup; parallel execution |
| Daemon requirement | Local process must run | None (Anthropic-managed) |

---

## 2. Teleport — Move Cloud Sessions to Terminal

**Opposite direction of Remote Control.** Pull a cloud session down to your terminal.

### CLI Commands

```bash
# Interactive picker
claude --teleport

# Specific session
claude --teleport <session-id>

# From within a session
/teleport
/tp
```

### Requirements for Teleporting

- **Clean git state**: No uncommitted changes (prompts to stash).
- **Correct repository**: Same repo, not a fork.
- **Branch available**: Must be pushed to remote.
- **Same account**: claude.ai account that owns the cloud session.
- **Claude.ai authentication**: Not available with API keys.

### When `--teleport` Is Unavailable

- API key authentication (run `/login` with claude.ai account)
- Bedrock, Vertex AI, Foundry (cloud sessions not available)
- Organization policy disables cloud sessions

---

## 3. Self-Hosted Environments — Org-Level Infrastructure

**Not for personal laptops.** For organizations that want cloud sessions running on their own infrastructure.

### What It Offers

- Sessions run on your infrastructure (Kubernetes, Docker Compose, EC2 instances)
- Network, variables, setup scripts configured per environment
- Multiple runners for scale
- Session token claims and credential scoping
- Health monitoring, Prometheus metrics

### Prerequisites

- Team or Enterprise plan
- Kubernetes or Docker Compose deployment
- Runner infrastructure (you host)
- On-demand runner capability if desired

**CLI invocation:** Not for end-users to "make my laptop a daemon." Requires deploying runners and registering them with Anthropic backend.

---

## Key Documentation URLs

**Remote Control (primary for your use case):**
- https://code.claude.com/docs/en/remote-control.md

**Claude Code on the Web (teleport, cloud environments, sessions):**
- https://code.claude.com/docs/en/claude-code-on-the-web.md

**Cloud Environments (configuration):**
- https://code.claude.com/docs/en/cloud-environments.md (large; covers network access, env vars, setup scripts)

**Self-hosted Environments (org infrastructure):**
- https://code.claude.com/docs/en/self-hosted-environments.md
- https://code.claude.com/docs/en/self-hosted-environments-quickstart.md
- https://code.claude.com/docs/en/self-hosted-environments-configuration.md

---

## Answer to User's Five Questions

### 1. Is there a supported way? What's it called?

**Yes.** Called **Remote Control**. Local session, web/mobile steering. No daemon or registration—just run `claude remote-control` on your machine.

### 2. Prerequisites?

- Claude Code CLI (any recent version)
- `claude /login` with claude.ai account (Pro/Max/Team/Enterprise plan; API keys not supported)
- macOS Darwin 25.3.0 (your OS) — no special platform restrictions
- Workspace trust dialog (run `claude` in project dir once)
- No telemetry-disabling env vars
- Must use api.anthropic.com (unset custom ANTHROPIC_BASE_URL or provider env vars)

### 3. Configuration files/settings?

**settings.json keys:**
- `remoteControlAtStartup: true` — auto-enable at session start
- `disableRemoteControl: true` — turn off entirely
- `dialogExpiry: <ms>` — permission dialog timeout (v2.1.224+)

**Environment variables:**
- None required; just avoid `DISABLE_TELEMETRY`, `DO_NOT_TRACK`, etc.

**No special CLI flags for teardown**—just close the process or run `/remote-control` again to toggle.

### 4. Security & teardown?

**Security model:**
- Outbound HTTPS only to api.anthropic.com:443
- Multiple scoped, short-lived credentials
- Transcript stored on Anthropic servers (syncing); execution stays local
- Trusted Devices available (Team/Enterprise) for device enrollment + biometric reauthentication

**Teardown / revoke:**
- Close the terminal / quit process — session ends immediately
- No persistent daemon to kill or credential to revoke (session-scoped)
- Can enable Trusted Devices to require device enrollment for mobile/web access

### 5. Limitations?

- **Session lifetime**: Survives network drops; expires on extended outage (>~10 min)
- **Local machine must stay awake** and running the process
- **Git repo requirement**: None for Remote Control itself; git needed for some `--spawn` modes
- **One remote session per interactive process** (use server mode for multiple)
- **Some CLI commands local-only** (`/plugin`, `/resume`)
- **No inbound ports opened** (safe for laptops on public networks)

---

## Quick Start for Your Use Case

```bash
# 1. Sign in
claude /login

# 2. From your project directory
claude remote-control

# 3. From claude.ai/code or mobile app, find the session and connect
# Or press spacebar in terminal for QR code to scan from phone

# 4. Continue local work from web/mobile while machine runs
# 5. To end: close terminal or Ctrl+C
```

No special configuration needed for basic use. Session appears in claude.ai/code's session list with auto-generated name (hostname-based) or custom name via `--name`.
