/**
 * config-isolation.ts
 *
 * Implements docs/specs/draft/config-isolation.md: builds the isolated env-var
 * map the daemon runs every child process under, and does the one-time git
 * identity copy (user.name/user.email) from the invoking user's ~/.gitconfig
 * into the isolated $GIT_CONFIG_GLOBAL.
 *
 * Pattern ported from nsheaps/agents' apps/agent-cli/lib/agent-env.sh (the
 * proven, real-world per-agent isolation mechanism) — pure env vars, no CLI
 * flag (earlier drafts of this file referenced `claude --setting-sources
 * project,local`; that flag does not do what config isolation needs and is
 * NOT used anywhere in this repo).
 */

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/** Root of everything the daemon owns. Nothing under here touches ~/.claude. */
export const DAEMON_ROOT = join(homedir(), ".claude-daemon");

export interface IsolatedEnv {
  CLAUDE_CONFIG_DIR: string;
  GH_CONFIG_DIR: string;
  GIT_CONFIG_GLOBAL: string;
  XDG_CONFIG_HOME: string;
  XDG_DATA_HOME: string;
  XDG_STATE_HOME: string;
  XDG_CACHE_HOME: string;
  XDG_CONFIG_DIRS: string;
  XDG_DATA_DIRS: string;
  // Extra CLAUDE_CODE_* vars adopted from agent-env.sh, limited to ones that
  // are directly justified for an unattended daemon session (not copied
  // wholesale — e.g. agents' CLAUDE_AUTO_BACKGROUND_TASKS/
  // FORCE_AUTOUPDATE_PLUGINS are agents-repo policy choices, not isolation).
  DISABLE_AUTOUPDATER: string;
  CLAUDE_CODE_ATTRIBUTION_HEADER: string;
  CLAUDE_CODE_TASK_LIST_ID: string;
}

/**
 * Builds the env-var map described in config-isolation.md's "env vars the
 * service process sets" section. Deliberately does NOT set HOME or
 * GIT_COMMITTER_* — see the spec's "identity split" section.
 *
 * GH_CONFIG_DIR and GIT_CONFIG_GLOBAL nest under XDG_CONFIG_HOME (matching
 * agent-env.sh: `$XDG_CONFIG_HOME/gh`, `$XDG_CONFIG_HOME/git/config`) rather
 * than being flat siblings — apps that honor XDG find them without a
 * per-app override, and non-XDG-aware apps (gh, git) still get the explicit
 * var. CLAUDE_CONFIG_DIR stays a direct child of `root`, not under XDG —
 * same as agent-env.sh's `$AGENT_HOME_DIR/.claude`.
 */
export function buildIsolatedEnv(root: string = DAEMON_ROOT, agentName?: string): IsolatedEnv {
  const xdgConfigHome = join(root, "xdg", "config");
  const xdgDataHome = join(root, "xdg", "data");
  return {
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    GH_CONFIG_DIR: join(xdgConfigHome, "gh"),
    GIT_CONFIG_GLOBAL: join(xdgConfigHome, "git", "config"),
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_DATA_HOME: xdgDataHome,
    XDG_STATE_HOME: join(root, "xdg", "state"),
    XDG_CACHE_HOME: join(root, "xdg", "cache"),
    // Prepend so isolated config is found first, system defaults remain the
    // fallback — per the XDG Base Directory spec (colon-separated,
    // leftmost = highest precedence), same as agent-env.sh.
    XDG_CONFIG_DIRS: `${xdgConfigHome}:${process.env.XDG_CONFIG_DIRS ?? "/etc/xdg"}`,
    XDG_DATA_DIRS: `${xdgDataHome}:${process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share"}`,
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
    // Pins the task list across restarts/reconnects for this agent instead
    // of a new session UUID getting an empty task list every time.
    CLAUDE_CODE_TASK_LIST_ID: agentName ?? "claude-daemon",
  };
}

/**
 * Merges the isolated env map on top of a base env (typically process.env),
 * suitable for passing to child_process.spawn's `env` option.
 */
export function mergeIsolatedEnv(
  base: NodeJS.ProcessEnv,
  isolated: IsolatedEnv,
): NodeJS.ProcessEnv {
  return { ...base, ...isolated };
}

/** Ensures every directory the isolated env map points at exists. */
export function ensureIsolatedDirs(env: IsolatedEnv): void {
  for (const dir of [
    env.CLAUDE_CONFIG_DIR,
    env.GH_CONFIG_DIR,
    env.XDG_CONFIG_HOME,
    env.XDG_DATA_HOME,
    env.XDG_STATE_HOME,
    env.XDG_CACHE_HOME,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  // GIT_CONFIG_GLOBAL is a file path, not a dir — ensure its parent exists.
  mkdirSync(join(env.GIT_CONFIG_GLOBAL, ".."), { recursive: true });
}

/**
 * Reads the invoking user's real ~/.gitconfig user.name/user.email once and
 * writes them into the isolated git config at env.GIT_CONFIG_GLOBAL, so
 * commits made by the daemon are still attributable to the real person while
 * every other git setting (aliases, credential helpers, etc.) stays isolated.
 *
 * Only writes if the isolated gitconfig doesn't already exist — this is
 * explicitly a first-run, read-once operation per config-isolation.md
 * ("read once, written into the isolated config, not re-read live").
 *
 * TODO(config-isolation.md "open / untested"): unresolved whether Claude
 * Code honors GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL env vars directly or relies
 * purely on GIT_CONFIG_GLOBAL when it shells out to `git commit`. If it does
 * NOT read GIT_CONFIG_GLOBAL (e.g. it always shells to system git which
 * ignores this var in some invocation shapes), this identity split silently
 * fails and commits fall back to no identity / whatever ambient git config
 * exists. Verify before this spec moves out of draft/.
 */
export function seedGitIdentity(env: IsolatedEnv): void {
  if (existsSync(env.GIT_CONFIG_GLOBAL)) {
    return;
  }

  const name = readRealGitConfigValue("user.name");
  const email = readRealGitConfigValue("user.email");

  if (!name || !email) {
     
    console.error(
      "[config-isolation] WARNING: could not read user.name/user.email from " +
        "the invoking user's ~/.gitconfig. Daemon commits will be unattributed " +
        "until this is fixed manually in " +
        env.GIT_CONFIG_GLOBAL,
    );
  }

  mkdirSync(join(env.GIT_CONFIG_GLOBAL, ".."), { recursive: true });
  // Write a minimal gitconfig by hand rather than shelling to `git config
  // --file` in a loop — keeps this readable and dependency-free.
  const lines = ["[user]"];
  if (name) lines.push(`\tname = ${name}`);
  if (email) lines.push(`\temail = ${email}`);
  writeFileSync(env.GIT_CONFIG_GLOBAL, lines.join("\n") + "\n", "utf8");
}

function readRealGitConfigValue(key: string): string | undefined {
  try {
    // Explicitly point at the real ~/.gitconfig, ignoring any
    // GIT_CONFIG_GLOBAL already set in this process's own env, so this
    // always reads the human's config regardless of call order.
    const out = execFileSync("git", ["config", "--get", key], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: join(homedir(), ".gitconfig") },
      encoding: "utf8",
    });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Convenience: read the isolated gitconfig back, for logging/diagnostics. */
export function readIsolatedGitconfig(env: IsolatedEnv): string | undefined {
  try {
    return readFileSync(env.GIT_CONFIG_GLOBAL, "utf8");
  } catch {
    return undefined;
  }
}
