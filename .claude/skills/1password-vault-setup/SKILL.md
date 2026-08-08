---
name: 1password-vault-setup
description: Use during claude-daemon first-run setup to provision a dedicated 1Password vault and ENVIRONMENT secrets item for this daemon instance. Forks into an isolated context. Trigger phrases — "set up 1Password for the daemon", "create a vault for claude-daemon", "run 1password-vault-setup".
context: fork
allowed-tools: Bash(op vault:*), Bash(op item:*), Bash(op read:*), Read, Write
---

# 1password-vault-setup

You are forked into an isolated context to provision 1Password storage for this `claude-daemon` instance, following the proven pattern in `nsheaps/agents`' `docs/runbooks/create-1password-vault-and-service-account.md`. The parent does not see your reasoning — only your final short report.

## What you CAN automate via the `op` CLI

1. Ask the human for the agent name (from this instance's `agent.yaml` `agent.name`, if already known — otherwise ask).
2. Create the vault: `op vault create "Agent-<name>"`. If it already exists, that's fine — proceed.
3. Create the `ENVIRONMENT` aggregator item (a Secure Note, title exactly `ENVIRONMENT` — case-sensitive, this is the convention `op-exec`/`op read` callers expect): `op item create --category="Secure Note" --title=ENVIRONMENT --vault="Agent-<name>"`. Leave it empty for now — other steps (`git-credentials-setup`, if it configured a GitHub App) populate fields into it later via `op item edit`.

## What you CANNOT automate — say so plainly, do not fake it

**1Password service accounts cannot be created via the `op` CLI or any API.** This was confirmed by the org's own vetted research (`docs/research/1password-secrets-sync.md` in `nsheaps/agents`: "Human Decisions Required: Create 1Password Service Account for CI/CD — Requires 1Password admin access") and the runbook this skill follows, which is explicitly `audience: human` for exactly this step. Service accounts require the 1Password web admin console because the resulting token is shown exactly once at creation time.

Walk the human through this manually, condensed from the runbook:

1. Open <https://my.1password.com> → avatar/Settings → **Service Accounts** (Business) or the equivalent for their plan.
2. Create a new service account named `sa-agent-<name>`, description "Read-only access to Agent-<name> vault for op-exec".
3. Grant it **Read Items only** access to the `Agent-<name>` vault — no other vaults, no write access.
4. Set a token expiration per their security posture (the runbook suggests 90 days for long-running agents as a balance vs. "Never Expires").
5. Copy the resulting token (starts with `ops_`) — it is shown only once.

Ask the human to paste the token back to you once they have it. **Never echo it back or write it into any log/transcript in full** — mask it in any confirmation output.

## Storing the token

Per the runbook, `OP_SERVICE_ACCOUNT_TOKEN` does NOT go into 1Password itself (chicken-and-egg) and does NOT go into the shared `~/.claude/settings.local.json` (shared across all agents on a machine). For this daemon, write it to the isolated `CLAUDE_CONFIG_DIR/settings.local.json`'s `env.OP_SERVICE_ACCOUNT_TOKEN` — `CLAUDE_CONFIG_DIR` is already this daemon instance's isolated config root (see `src/lib/config-isolation.ts`), which serves the same "per-agent, not shared" isolation property the runbook requires.

Verify it works before finishing: with `OP_SERVICE_ACCOUNT_TOKEN` exported, `op vault list` should show exactly one vault (`Agent-<name>`) — if it shows zero, the token is wrong; if it shows more than one, the service account was over-scoped and should be deleted and recreated with the correct vault scope.

## Report

In under 6 sentences: whether the vault and `ENVIRONMENT` item exist, whether a service account token was obtained and verified, and where it was stored. If the human hasn't gotten to the manual service-account step yet, say that explicitly rather than reporting success.
