/**
 * bundled-skills.ts
 *
 * The daemon ships its own setup skills (claude-login-setup,
 * git-credentials-setup, 1password-vault-setup) under this repo's
 * `.claude/skills/`. These are distinct from the user's settings-repo
 * symlink farm in settings-repo-sync.ts — bundled skills come from THIS
 * repo, not from CLAUDE_DAEMON_SETTINGS_REPO.
 *
 * TODO(release-packaging.md): once the Formula actually packages a release,
 * it needs to install `.claude/skills/` alongside the binary (e.g. into
 * `#{pkgshare}/skills`) and set CLAUDE_DAEMON_SKILLS_DIR in the launchd
 * plist's EnvironmentVariables. Not wired yet — the dev-mode fallback below
 * only works when running from a checkout, not an installed binary with no
 * source tree nearby.
 */

import { existsSync, mkdirSync, readdirSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const BUNDLED_SKILL_NAMES = [
  "claude-login-setup",
  "git-credentials-setup",
  "1password-vault-setup",
] as const;

/**
 * Resolves the directory containing this repo's `.claude/skills/`.
 * Prefers CLAUDE_DAEMON_SKILLS_DIR (the packaged-install path, once wired);
 * falls back to walking up from this module's own location to find a
 * `.claude/skills` directory, which works when running from a checkout
 * (`bun run src/cli.ts` or a compiled binary run from within the repo) but
 * NOT for an installed binary with no source tree nearby.
 */
export function resolveBundledSkillsDir(): string | undefined {
  const override = process.env.CLAUDE_DAEMON_SKILLS_DIR;
  if (override && existsSync(override)) return override;

  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".claude", "skills");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Symlinks the daemon's bundled setup skills into the isolated
 * CLAUDE_CONFIG_DIR/skills/ so they're discoverable in a `claude` session
 * running under the isolated env. Silently no-ops (with a log line) if the
 * bundled skills dir can't be resolved — matches this scaffold's
 * fail-visible-not-fail-crashing posture for known-incomplete packaging.
 */
export function syncBundledSkills(claudeConfigDir: string): void {
  const sourceDir = resolveBundledSkillsDir();
  if (!sourceDir) {

    console.error(
      "[bundled-skills] could not resolve bundled skills dir (set " +
        "CLAUDE_DAEMON_SKILLS_DIR, or run from within a checkout) — setup " +
        "skills will not be available in this session",
    );
    return;
  }

  const targetDir = join(claudeConfigDir, "skills");
  mkdirSync(targetDir, { recursive: true });

  for (const name of BUNDLED_SKILL_NAMES) {
    const source = join(sourceDir, name);
    if (!existsSync(source)) continue;
    const target = join(targetDir, name);
    if (existsSync(target)) unlinkSync(target);
    symlinkSync(source, target);
  }

  // Surface anything present on disk but not in our known list, for
  // visibility if this repo's skill set drifts from BUNDLED_SKILL_NAMES.
  const onDisk = readdirSync(sourceDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const unknown = onDisk.filter((n) => !(BUNDLED_SKILL_NAMES as readonly string[]).includes(n));
  if (unknown.length > 0) {

    console.error(`[bundled-skills] found undeclared skill dirs, not synced: ${unknown.join(", ")}`);
  }
}
