/**
 * config-isolation.ts
 *
 * Implements docs/specs/draft/config-isolation.md: builds the isolated env-var
 * map the daemon runs every child process under, and does the one-time git
 * identity copy (user.name/user.email) from the invoking user's ~/.gitconfig
 * into the isolated $GIT_CONFIG_GLOBAL.
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
}

/**
 * Builds the env-var map described in config-isolation.md's "env vars the
 * service process sets" section. Deliberately does NOT set HOME or
 * GIT_COMMITTER_* — see the spec's "identity split" section.
 */
export function buildIsolatedEnv(root: string = DAEMON_ROOT): IsolatedEnv {
  return {
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    GH_CONFIG_DIR: join(root, "gh"),
    GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
    XDG_CONFIG_HOME: join(root, "xdg", "config"),
    XDG_DATA_HOME: join(root, "xdg", "data"),
    XDG_STATE_HOME: join(root, "xdg", "state"),
    XDG_CACHE_HOME: join(root, "xdg", "cache"),
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
  mkdirSync(join(DAEMON_ROOT), { recursive: true });
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

  mkdirSync(join(DAEMON_ROOT), { recursive: true });
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
