---
name: git-credentials-setup
description: Use during claude-daemon first-run setup to configure isolated git commit identity and gh CLI authentication (personal gh login OR a GitHub App installation token). Forks into an isolated context. Trigger phrases — "set up git credentials for the daemon", "configure gh auth for claude-daemon", "run git-credentials-setup".
context: fork
allowed-tools: Bash(git config:*), Bash(gh auth login:*), Bash(gh auth status:*), Bash(gh api:*), Read, Write
---

# git-credentials-setup

You are forked into an isolated context to configure this `claude-daemon` instance's git/GitHub identity. The parent does not see your reasoning — only your final short report.

Assume `GIT_CONFIG_GLOBAL` and `GH_CONFIG_DIR` are already set in your environment to the isolated paths from `src/lib/config-isolation.ts` — you are configuring those isolated files, not the invoking user's real `~/.gitconfig` or `~/.config/gh`.

## 1. Git commit identity

`src/lib/config-isolation.ts`'s `seedGitIdentity()` already copies the host user's `user.name`/`user.email` into the isolated `GIT_CONFIG_GLOBAL` on first run. Verify it worked: `git config --get user.name` and `git config --get user.email` (these will read the isolated config since `GIT_CONFIG_GLOBAL` is set). If either is empty, ask the human for a name/email and set them with `git config user.name "..."` / `git config user.email "..."`.

## 2. GitHub auth — ask the human which mode

Ask the human to choose between two modes. Do not guess.

**Mode A — personal `gh` login.** Simplest. Run `gh auth login` and follow its prompts (browser or device-code flow). Commits/PRs will be attributed to the human's own GitHub account. Fine for a single-user temporary environment.

**Mode B — GitHub App installation token.** For attributing daemon activity to a distinct bot identity (`<name>[bot]`) instead of the human's personal account, matching the pattern in `nsheaps/agents`' `docs/specs/auth-credentials.md`. This mode requires a GitHub App to already exist — **creating a new GitHub App is a human-only, web-console task** (App creation, permission scoping, and installation cannot be done via any CLI or API call available to you — see `nsheaps/agents`' `docs/runbooks/create-github-app.md` for the exact steps). If no App exists yet:
  - Tell the human plainly that you cannot create the GitHub App yourself, and point them at that runbook (or the equivalent steps: https://github.com/settings/apps → New GitHub App → repo permissions: Contents read/write, Metadata read, Pull requests read/write, Issues read/write; uncheck Webhooks; install on the target account).
  - Once they confirm the App exists, ask for: `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and the private key (PEM). These are exactly the three fields the `1password-vault-setup` skill's `ENVIRONMENT` item is designed to hold — if that skill already ran, prefer reading them from `op://Agent-<name>/ENVIRONMENT/{GITHUB_APP_ID,GITHUB_INSTALLATION_ID,GITHUB_APP_PRIVATE_KEY}` via `op read` instead of asking the human to paste them again.
  - Generate a short-lived installation token from the private key (JWT-sign the App ID + exchange via `POST /app/installations/{id}/access_tokens` — `gh api` alone cannot do the JWT-signing step; if no existing script for this is available, tell the human this step needs a small helper script and is not yet automated in this scaffold, per `docs/specs/draft/config-isolation.md`'s explicit MVP scope).
  - Set `GH_TOKEN` to the resulting installation token for the daemon's isolated environment (write it wherever the isolated env is sourced from — do not print the raw token to the transcript; mask it in any output).
  - **Verify identity before finishing**: `env -u GH_TOKEN -u GITHUB_TOKEN gh auth status` should show nothing (confirms no ambient fallback credential leaks in), then with `GH_TOKEN` set, `gh api /user --jq .login` should return the bot's `<name>[bot]` login, not the human's. If it returns the human's login, something fell back incorrectly — stop and report this rather than proceeding.

## 3. Report

In under 6 sentences: which mode was configured, the resulting `gh api /user --jq .login` identity, and whether the git commit identity is set. Flag anything you couldn't complete (e.g. "GitHub App doesn't exist yet — human needs to create it first") rather than pretending it's done.
