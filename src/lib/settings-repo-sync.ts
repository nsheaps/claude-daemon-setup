/**
 * settings-repo-sync.ts
 *
 * Implements docs/specs/draft/settings-repo-sync.md:
 *   - clone-or-pull CLAUDE_DAEMON_SETTINGS_REPO into ~/.claude-daemon/config-repo/
 *   - parse agent.yaml (agent.name required)
 *   - sync the one-symlink-per-item farm under
 *     ~/.claude-daemon/claude/{skills,agents,rules}/, tracked via a manifest
 *     so "never touch items the daemon didn't create" is enforceable.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync, unlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { DAEMON_ROOT, type IsolatedEnv } from "./config-isolation.js";

export const CONFIG_REPO_DIR = join(DAEMON_ROOT, "config-repo");

const FARM_CATEGORIES = ["skills", "agents", "rules"] as const;
export type FarmCategory = (typeof FARM_CATEGORIES)[number];

export interface AgentConfig {
  name: string;
  description?: string;
}

/**
 * Clones CLAUDE_DAEMON_SETTINGS_REPO into CONFIG_REPO_DIR if absent, or
 * fast-forward pulls it if present. Accepts either a full git remote URL or
 * an `owner/repo` GitHub shorthand.
 */
export function cloneOrPullSettingsRepo(
  repoRef: string,
  env: IsolatedEnv,
  dir: string = CONFIG_REPO_DIR,
): void {
  const url = toGitUrl(repoRef);
  mkdirSync(DAEMON_ROOT, { recursive: true });

  const gitEnv = { ...process.env, ...env };

  if (existsSync(join(dir, ".git"))) {
    execFileSync("git", ["-C", dir, "fetch", "--quiet", "origin"], { env: gitEnv });
    // TODO: assumes a simple fast-forward; pin to a ref/tag instead of
    // always tracking HEAD once the repo's trust model is settled.
    execFileSync("git", ["-C", dir, "pull", "--ff-only", "--quiet"], { env: gitEnv });
    return;
  }

  execFileSync("git", ["clone", "--quiet", url, dir], { env: gitEnv });
}

function toGitUrl(repoRef: string): string {
  if (repoRef.includes("://") || repoRef.startsWith("git@")) {
    return repoRef;
  }
  // owner/repo shorthand -> GitHub HTTPS URL.
  if (/^[\w.-]+\/[\w.-]+$/.test(repoRef)) {
    return `https://github.com/${repoRef}.git`;
  }
  return repoRef;
}

/**
 * Parses agent.yaml at the settings repo root. `agent.name` is required.
 *
 * TODO: minimal hand-rolled parser for the flat two-key schema this repo
 * itself defines (settings-repo-sync.md: "no prior art"). Replace with a
 * real YAML dependency once one is approved — not added in this scaffold.
 */
export function parseAgentYaml(repoDir: string = CONFIG_REPO_DIR): AgentConfig {
  const path = join(repoDir, "agent.yaml");
  if (!existsSync(path)) {
    throw new Error(`agent.yaml not found at ${path} — settings repo is malformed`);
  }
  const raw = readFileSync(path, "utf8");

  let name: string | undefined;
  let description: string | undefined;
  let inAgentBlock = false;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;

    if (/^agent:\s*$/.test(line)) {
      inAgentBlock = true;
      continue;
    }
    if (!inAgentBlock) continue;
    if (!/^\s/.test(line)) {
      // dedent back to top level -> agent block ended.
      inAgentBlock = false;
      continue;
    }

    const match = /^\s+(\w+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = stripQuotes(rawValue.trim());
    if (key === "name") name = value;
    if (key === "description") description = value;
  }

  if (!name) {
    throw new Error(`agent.yaml at ${path} is missing required field agent.name`);
  }
  return { name, description };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** `com.nsheaps.claude-daemon.<agent.name>`, slugified: lowercase, [a-z0-9-] only. */
export function launchdLabel(agentName: string): string {
  const slug = agentName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `com.nsheaps.claude-daemon.${slug}`;
}

// ---------------------------------------------------------------------------
// Symlink farm sync
// ---------------------------------------------------------------------------

interface FarmManifest {
  // category -> item names the daemon created symlinks for.
  [category: string]: string[];
}

function manifestPath(claudeConfigDir: string): string {
  return join(claudeConfigDir, ".symlink-farm-manifest.json");
}

function readManifest(claudeConfigDir: string): FarmManifest {
  try {
    return JSON.parse(readFileSync(manifestPath(claudeConfigDir), "utf8")) as FarmManifest;
  } catch {
    return {};
  }
}

function writeManifest(claudeConfigDir: string, manifest: FarmManifest): void {
  writeFileSync(manifestPath(claudeConfigDir), JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

/**
 * Syncs ~/.claude-daemon/claude/{skills,agents,rules}/ against the settings
 * repo's .claude/{skills,agents,rules}/ contents: one symlink per top-level
 * item. Adds new items, removes items the daemon previously created that no
 * longer exist upstream, and NEVER touches anything not recorded in the
 * manifest as daemon-owned (per settings-repo-sync.md's explicit
 * "never touch items the daemon didn't create").
 */
export function syncSymlinkFarm(
  claudeConfigDir: string,
  repoDir: string = CONFIG_REPO_DIR,
): void {
  const manifest = readManifest(claudeConfigDir);

  for (const category of FARM_CATEGORIES) {
    const farmDir = join(claudeConfigDir, category);
    const sourceDir = join(repoDir, ".claude", category);
    mkdirSync(farmDir, { recursive: true });

    const desired = existsSync(sourceDir)
      ? readdirSync(sourceDir, { withFileTypes: true })
          .filter((e) => e.isDirectory() || e.isFile())
          .map((e) => e.name)
      : [];
    const owned = new Set(manifest[category] ?? []);

    // Add/refresh.
    for (const item of desired) {
      const linkPath = join(farmDir, item);
      const target = join(sourceDir, item);
      if (existsSync(linkPath) || isDanglingSymlink(linkPath)) {
        if (!owned.has(item)) {
          // Something with this name exists that we didn't create — don't
          // touch it, per spec. Skip and leave a log line for visibility.
           
          console.error(
            `[settings-repo-sync] skipping ${linkPath}: not daemon-owned, refusing to overwrite`,
          );
          continue;
        }
        unlinkSync(linkPath);
      }
      symlinkSync(target, linkPath);
      owned.add(item);
    }

    // Remove farm entries that disappeared upstream — only ones we own.
    for (const item of [...owned]) {
      if (!desired.includes(item)) {
        const linkPath = join(farmDir, item);
        if (isDanglingSymlink(linkPath) || existsSync(linkPath)) {
          unlinkSync(linkPath);
        }
        owned.delete(item);
      }
    }

    manifest[category] = [...owned];
  }

  writeManifest(claudeConfigDir, manifest);
}

function isDanglingSymlink(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}
