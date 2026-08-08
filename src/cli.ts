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
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DAEMON_ROOT,
  buildIsolatedEnv,
  ensureIsolatedDirs,
  mergeIsolatedEnv,
  seedGitIdentity,
} from "./lib/config-isolation.js";
import {
  CONFIG_REPO_DIR,
  cloneOrPullSettingsRepo,
  parseAgentYaml,
  syncSymlinkFarm,
  launchdLabel,
} from "./lib/settings-repo-sync.js";
import { syncBundledSkills } from "./lib/bundled-skills.js";
import { spawnRemoteControl } from "./lib/remote-control.js";
import { startAutoUpdateLoop } from "./lib/auto-update.js";

const CONFIG_FILE = join(DAEMON_ROOT, "config.json");

interface DaemonConfig {
  settingsRepo: string;
}

// Individual setup steps live as their own context:fork skills under
// .claude/skills/ in this repo (see docs/specs/draft/config-isolation.md
// "Setup skills") rather than being inlined here — each is independently
// testable/invocable and forks into an isolated context so the credential
// flow (browser OAuth, 1Password web console steps, etc.) doesn't bloat the
// setup session's own context.
const SETUP_SKILLS = ["claude-login-setup", "git-credentials-setup", "1password-vault-setup"] as const;

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
  let settingsRepo: string | undefined;
  try {
    const existing = readConfig();
    const answer = await rl.question(
      `CLAUDE_DAEMON_SETTINGS_REPO${existing ? ` [${existing.settingsRepo}]` : ""}: `,
    );
    settingsRepo = answer.trim() || existing?.settingsRepo;
    if (!settingsRepo) {
      console.error("A settings repo (owner/repo or git URL) is required.");
      process.exit(1);
    }
  } finally {
    rl.close();
  }

  const config: DaemonConfig = { settingsRepo };
  mkdirSync(DAEMON_ROOT, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.error(`Wrote ${CONFIG_FILE}`);

  // TODO(daemon-service.md): post_install also needs this written into the
  // launchd plist's EnvironmentVariables (service has no shell profile) —
  // that's release-packaging.md's scope, flagging the seam here.

  const isolatedEnv = buildIsolatedEnv();
  ensureIsolatedDirs(isolatedEnv);
  seedGitIdentity(isolatedEnv);
  syncBundledSkills(isolatedEnv.CLAUDE_CONFIG_DIR);

  console.error(
    "\nHanding off to an interactive claude session to run the credential " +
      `setup skills (${SETUP_SKILLS.join(", ")}) inside the isolated ` +
      `CLAUDE_CONFIG_DIR=${isolatedEnv.CLAUDE_CONFIG_DIR}.\n` +
      "Each is a context:fork skill — see .claude/skills/ in this repo. " +
      "Follow its prompts (browser login, 1Password web console steps, " +
      "etc.) — this step is interactive and cannot be fully automated.\n",
  );

  const scratchCwd = join(DAEMON_ROOT, "scratch");
  mkdirSync(scratchCwd, { recursive: true });
  const setupPrompt =
    `Run the ${SETUP_SKILLS.join(", ")} skills in order to finish configuring ` +
    "this claude-daemon instance. Ask me for whatever input each one needs, " +
    "and give me a short report after each skill completes.";

  const result = spawnSync("claude", [setupPrompt], {
    cwd: scratchCwd,
    env: mergeIsolatedEnv(process.env, isolatedEnv),
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(
      `\n[setup] the interactive claude session exited with status ${String(result.status)} ` +
        "(or was interrupted). Re-run 'claude-daemon setup' to continue where you left off — " +
        "the skills are idempotent (they check current state before acting).",
    );
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

  let isolatedEnv = buildIsolatedEnv();

  try {
    // Step 3: set up ~/.claude-daemon/ isolation dirs + git identity seed.
    ensureIsolatedDirs(isolatedEnv);
    seedGitIdentity(isolatedEnv);
    syncBundledSkills(isolatedEnv.CLAUDE_CONFIG_DIR);

    // Step 2: clone/sync settings repo.
    cloneOrPullSettingsRepo(settingsRepo, isolatedEnv, CONFIG_REPO_DIR);
    const agent = parseAgentYaml(CONFIG_REPO_DIR);
    console.error(`[service] agent.name=${agent.name} label=${launchdLabel(agent.name)}`);
    // Rebuild with the real agent name now known, for CLAUDE_CODE_TASK_LIST_ID
    // continuity across restarts — directory paths are unaffected, so the
    // dirs set up above stay valid.
    isolatedEnv = buildIsolatedEnv(DAEMON_ROOT, agent.name);

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
