---
name: claude-login-setup
description: Use during claude-daemon first-run setup to authenticate the isolated CLAUDE_CONFIG_DIR with claude.ai. Forks into an isolated context so the interactive login flow doesn't pollute the parent setup session. Trigger phrases — "set up claude login for the daemon", "authenticate this daemon instance", "run claude-login-setup".
context: fork
allowed-tools: Bash(claude auth login:*), Bash(claude auth status:*)
---

# claude-login-setup

You are forked into an isolated context to authenticate this `claude-daemon` instance's isolated `CLAUDE_CONFIG_DIR`. The parent does not see your reasoning — only your final short report.

1. Run `claude auth status`. If it already reports `"loggedIn": true` for a `claude.ai` account, skip straight to step 3.
2. If not logged in, run `claude auth login` and walk the human through it — this opens a browser-based OAuth flow. Wait for it to complete; do not proceed until `claude auth status` confirms `loggedIn: true`.
3. Confirm the account's `subscriptionType` supports Remote Control (Pro, Max, Team, or Enterprise — API-key auth is explicitly NOT supported for Remote Control, per `docs/research/remote-control-mechanism.md` in this repo). If the account is on a plan that doesn't qualify, say so plainly and stop — do not silently proceed with a broken setup.
4. Report back to the parent in under 5 sentences: whether login succeeded, the account email, and the subscription type. If it failed, say exactly what failed and why.

This skill assumes `CLAUDE_CONFIG_DIR` (and the rest of the isolation env from `src/lib/config-isolation.ts`) is already set in your environment before you're invoked — it does not set isolation vars itself, it only authenticates within whatever `CLAUDE_CONFIG_DIR` it's handed.
