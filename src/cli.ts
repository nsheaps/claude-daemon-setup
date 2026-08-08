#!/usr/bin/env node
/**
 * cli.ts — claude-daemon entrypoint.
 *
 * Minimal subcommand dispatch on process.argv[2]; deliberately no arg-parsing
 * dependency per task scope ("minimal arg-parsing approach").
 *
 * Subcommands:
 *   setup    — interactive first-run config (docs/specs/draft/config-isolation.md).
 *   service  — the long-running daemon (docs/specs/draft/daemon-service.md,
 *              entrypoint contract steps 1-6).
 */

import { createInterface } from "node:readline/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DAEMON_ROOT,
  buildIsolatedEnv,
  ensureIsolatedDirs,
  seedGitIdentity,
} from "./lib/config-isolation.js";
import {
  CONFIG_REPO_DIR,
  cloneOrPullSettingsRepo,
  parseAgentYaml,
  syncSymlinkFarm,
  launchdLabel,
} from "./lib/settings-repo-sync.js";
import { spawnRemoteControl } from "./lib/remote-control.js";
import { startAutoUpdateLoop } from "./lib/auto-update.js";

const CONFIG_FILE = join(DAEMON_ROOT, "config.json");

// TODO(config-isolation.md): setup should also resolve/record the gh-auth
// path chosen ("gh auth login" vs inherited GH_TOKEN — spec requires exactly
// one) and confirm `claude auth login` has been run. Neither is implemented
// in this scaffold; both are interactive, TTY-only steps that belong here.
interface DaemonConfig {
  settingsRepo: string;
}

async function main(): Promise<void> {
  const subcommand = process.argv[2];

  switch (subcommand) {
    case "setup":
      await runSetup();
      return;
    case "service":
      await runService();
      return;
    case "--version":
    case "-v":
      // Required by src/lib/auto-update.ts's smokeCheckBinary() and the
      // Formula's `test do` block — both gate on this exiting 0.
      console.log(readOwnVersion());
      process.exit(0);
      return;
    case "--help":
    case "-h":
      printUsage();
      process.exit(0);
      return;
    default:
      printUsage();
      process.exit(subcommand ? 1 : 0);
  }
}

function printUsage(): void {
  console.error("usage: claude-daemon <setup|service|--version|--help>");
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

async function runSetup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const existing = readConfig();
    const answer = await rl.question(
      `CLAUDE_DAEMON_SETTINGS_REPO${existing ? ` [${existing.settingsRepo}]` : ""}: `,
    );
    const settingsRepo = answer.trim() || existing?.settingsRepo;
    if (!settingsRepo) {
      console.error("A settings repo (owner/repo or git URL) is required.");
      process.exit(1);
    }

    // TODO: also prompt for/confirm gh auth and `claude auth login` here
    // (interactive, setup-time-only per config-isolation.md). Not implemented.

    const config: DaemonConfig = { settingsRepo };
    mkdirSync(DAEMON_ROOT, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
    console.error(`Wrote ${CONFIG_FILE}`);

    // TODO(daemon-service.md): post_install also needs this written into the
    // launchd plist's EnvironmentVariables (service has no shell profile) —
    // that's release-packaging.md's scope, flagging the seam here.
  } finally {
    rl.close();
  }
}

function readConfig(): DaemonConfig | undefined {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as DaemonConfig;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// service
// ---------------------------------------------------------------------------

async function runService(): Promise<void> {
  // Step 1: CLAUDE_DAEMON_SETTINGS_REPO unset (env or config.json) -> error, exit 1.
  const settingsRepo = process.env.CLAUDE_DAEMON_SETTINGS_REPO ?? readConfig()?.settingsRepo;
  if (!settingsRepo) {
    console.error(
      "claude-daemon service: CLAUDE_DAEMON_SETTINGS_REPO is not set and no " +
        `config was found at ${CONFIG_FILE}. Run 'claude-daemon setup' first, ` +
        "or set the env var directly (e.g. in the launchd plist).",
    );
    process.exit(1);
  }

  const isolatedEnv = buildIsolatedEnv();

  try {
    // Step 3: set up ~/.claude-daemon/ isolation dirs + git identity seed.
    ensureIsolatedDirs(isolatedEnv);
    seedGitIdentity(isolatedEnv);

    // Step 2: clone/sync settings repo.
    cloneOrPullSettingsRepo(settingsRepo, isolatedEnv, CONFIG_REPO_DIR);
    const agent = parseAgentYaml(CONFIG_REPO_DIR);
    console.error(`[service] agent.name=${agent.name} label=${launchdLabel(agent.name)}`);

    // Step 4: sync skills/agents/rules symlink farm.
    syncSymlinkFarm(isolatedEnv.CLAUDE_CONFIG_DIR, CONFIG_REPO_DIR);

    // Step 5: invoke `claude remote-control` inside the isolated env.
    const scratchCwd = join(DAEMON_ROOT, "scratch");
    mkdirSync(scratchCwd, { recursive: true });
    const child = spawnRemoteControl({
      isolatedEnv,
      agentName: agent.name,
      cwd: scratchCwd,
    });
    child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[remote-control] ${chunk}`));
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[remote-control] ${chunk}`));
    child.on("exit", (code, signal) => {
      console.error(`[service] remote-control exited (code=${code} signal=${signal})`);
      // TODO: no restart/backoff logic yet — MVP only requires the wrapper
      // itself to stay up under `brew services`.
    });

    // Step 6: auto-update loop (binary + settings-repo resync).
    const stopAutoUpdate = startAutoUpdateLoop({
      releaseRepoSlug: "nsheaps/claude-daemon-setup",
      currentVersion: readOwnVersion(),
      binaryPath: process.execPath,
      onSettingsSync: () => {
        cloneOrPullSettingsRepo(settingsRepo, isolatedEnv, CONFIG_REPO_DIR);
        syncSymlinkFarm(isolatedEnv.CLAUDE_CONFIG_DIR, CONFIG_REPO_DIR);
      },
      onBinarySwapped: (version) => {
        console.error(`[service] binary swapped to ${version}, TODO: restart child process`);
      },
    });

    const shutdown = (): void => {
      stopAutoUpdate();
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (err) {
    // Per daemon-service.md's MVP checkpoint, crashing here (steps 3-6) is
    // acceptable/expected — but log clearly so crash-looping is diagnosable.
    console.error(`[service] fatal: ${(err as Error).stack ?? err}`);
    process.exit(1);
  }
}

// TODO: release-packaging.md's `after:bump` hook should seed a real version
// constant into source at release time. Not wired yet.
function readOwnVersion(): string {
  return "0.0.0-dev";
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
