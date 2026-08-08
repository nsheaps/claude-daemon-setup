/**
 * auto-update.ts
 *
 * Implements docs/specs/draft/auto-update.md: an interval loop that
 * (a) checks GitHub releases for a newer claude-daemon binary, smoke-checks
 * it (--version) before swapping, and logs outcomes with NO rollback (MVP
 * scope cut); and (b) re-invokes settings-repo sync on its own interval.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, renameSync } from "node:fs";

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

export interface AutoUpdateConfig {
  /** `owner/repo` slug for the daemon binary's GitHub releases. */
  releaseRepoSlug: string;
  /** Currently running binary version, e.g. from a baked-in constant. */
  currentVersion: string;
  /** Absolute path to the currently-running binary on disk. */
  binaryPath: string;
  /** Binary update check interval. Configurable for testing. */
  binaryIntervalMs?: number;
  /** Settings-repo resync interval. Configurable for testing. */
  settingsSyncIntervalMs?: number;
  /** Called on the settings-sync interval. */
  onSettingsSync: () => void | Promise<void>;
  /** Called after a successful, smoke-checked binary swap. Caller is
   * responsible for actually restarting the child process — this module
   * does not supervise the remote-control process itself. */
  onBinarySwapped: (newVersion: string) => void | Promise<void>;
}

function readIntervalEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function resolveIntervals(config: AutoUpdateConfig): {
  binaryIntervalMs: number;
  settingsSyncIntervalMs: number;
} {
  return {
    binaryIntervalMs:
      config.binaryIntervalMs ?? readIntervalEnv("CLAUDE_DAEMON_UPDATE_INTERVAL_MS", FIVE_HOURS_MS),
    settingsSyncIntervalMs:
      config.settingsSyncIntervalMs ??
      readIntervalEnv("CLAUDE_DAEMON_SETTINGS_SYNC_INTERVAL_MS", FIVE_HOURS_MS),
  };
}

/**
 * Queries GitHub for the latest release tag via the `gh` CLI (preferred
 * external-service integration per repo tooling conventions — see
 * docs/research/patterns-index.md). Returns undefined on any failure
 * (network, auth, no releases) — auto-update is explicitly fail-open per
 * spec, so a check failure should never crash the daemon.
 */
export function fetchLatestReleaseTag(repoSlug: string): string | undefined {
  try {
    const out = execFileSync(
      "gh",
      ["release", "view", "--repo", repoSlug, "--json", "tagName", "--jq", ".tagName"],
      { encoding: "utf8" },
    );
    return out.trim() || undefined;
  } catch (err) {
    logUpdate(`release check failed: ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * Smoke check: does `<binaryPath> --version` exit 0? Per auto-update.md,
 * this is the ONLY gate before swapping — no deeper validation in MVP.
 */
export function smokeCheckBinary(binaryPath: string): boolean {
  try {
    execFileSync(binaryPath, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads the new binary asset to a staging path, smoke-checks it, and
 * only then swaps it into place at `binaryPath`. No rollback: if the swap
 * itself succeeds but the daemon later crash-loops, that is visible via
 * `brew services` / launchd logs per spec — not masked here.
 *
 * TODO: asset name/platform-triple resolution is unimplemented — this
 * assumes a pre-downloaded `stagedBinaryPath` for now. Wiring `gh release
 * download` for the correct target triple is genuinely unresolved (depends
 * on release-packaging.md's per-target artifact naming, not yet finalized).
 */
export function swapBinaryIfSafe(stagedBinaryPath: string, binaryPath: string): boolean {
  if (!existsSync(stagedBinaryPath)) {
    logUpdate(`staged binary missing at ${stagedBinaryPath}, skipping swap`);
    return false;
  }
  chmodSync(stagedBinaryPath, 0o755);
  if (!smokeCheckBinary(stagedBinaryPath)) {
    logUpdate(`smoke check failed for staged binary at ${stagedBinaryPath}, not swapping`);
    return false;
  }

  const backupPath = `${binaryPath}.previous`;
  try {
    if (existsSync(binaryPath)) {
      copyFileSync(binaryPath, backupPath); // kept only for forensic purposes; no auto-rollback reads this.
    }
    renameSync(stagedBinaryPath, binaryPath);
    logUpdate(`swapped binary at ${binaryPath}`);
    return true;
  } catch (err) {
    logUpdate(`swap failed: ${(err as Error).message}`);
    return false;
  }
}

function logUpdate(message: string): void {
   
  console.error(`[auto-update] ${new Date().toISOString()} ${message}`);
}

/**
 * Starts the two independent interval loops described in auto-update.md.
 * Returns a stop function for graceful shutdown (used by service teardown).
 */
export function startAutoUpdateLoop(config: AutoUpdateConfig): () => void {
  const { binaryIntervalMs, settingsSyncIntervalMs } = resolveIntervals(config);

  const binaryTimer = setInterval(() => {
    const latestTag = fetchLatestReleaseTag(config.releaseRepoSlug);
    if (!latestTag) return;
    if (latestTag === config.currentVersion) {
      logUpdate(`up to date (${config.currentVersion})`);
      return;
    }
    logUpdate(`newer release available: ${latestTag} (current: ${config.currentVersion})`);
    // TODO: download step intentionally not wired here yet — see
    // swapBinaryIfSafe's TODO. When implemented, call it and then:
    //   void config.onBinarySwapped(latestTag);
    logUpdate(
      "download/swap not yet implemented in this scaffold — see swapBinaryIfSafe TODO",
    );
  }, binaryIntervalMs);

  const settingsTimer = setInterval(() => {
    logUpdate("resyncing settings repo");
    Promise.resolve(config.onSettingsSync()).catch((err: unknown) => {
      logUpdate(`settings resync failed: ${(err as Error).message}`);
    });
  }, settingsSyncIntervalMs);

  // TODO(auto-update.md): "must not update mid-remote-session in a way that
  // drops an active connection without warning — at minimum, log a notice."
  // No session-awareness exists yet; the swap path above is unimplemented
  // so this is moot for now, but must be addressed once swapping is real.

  return () => {
    clearInterval(binaryTimer);
    clearInterval(settingsTimer);
  };
}
