/**
 * remote-control.ts
 *
 * Thin wrapper that spawns `claude remote-control` inside the isolated env
 * from config-isolation.ts. Uses child_process.spawn (not execSync) because
 * this process must stay running and be supervised by the caller (the
 * daemon-service entrypoint / auto-update loop), not run-to-completion.
 *
 * Verified workaround per docs/research/host-setup-notes.md §3: the global
 * settings.json's `env` block (custom ANTHROPIC_BASE_URL gateway) breaks
 * Remote Control unless user-scope settings are excluded via
 * `--setting-sources`. That doc's live verification used exactly
 * `--setting-sources project`. daemon-service.md / config-isolation.md both
 * specify `project,local`. We follow the specs here (project,local) since
 * `local` only adds project-local overrides on top of `project` and should
 * be harmless, but this delta from the verified command is flagged as a
 * TODO: re-verify `--setting-sources project,local` actually starts Remote
 * Control on this host before relying on it in production.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { IsolatedEnv } from "./config-isolation.js";

export interface RemoteControlOptions {
  /** Isolated env map merged on top of a minimal base env for the child. */
  isolatedEnv: IsolatedEnv;
  /** agent.yaml's agent.name, used for `--name` if/once that flag exists. */
  agentName?: string;
  /** Working directory for the claude process. See config-isolation.md's
   * "known, accepted limitation" re: CLAUDE.md discovery recursing upward
   * from cwd regardless of CLAUDE_CONFIG_DIR — default to an isolated
   * scratch dir to minimize (not eliminate) that leak. */
  cwd: string;
  /** Base env to merge the isolated vars on top of. Defaults to process.env. */
  baseEnv?: NodeJS.ProcessEnv;
}

/**
 * Spawns `claude --setting-sources project,local remote-control` as a
 * detached-from-shell child process, returning the ChildProcess handle so
 * the caller can supervise it (wait, kill, restart on auto-update, etc).
 *
 * Does NOT itself retry, restart, or wait — that's the entrypoint's job
 * (daemon-service.md step 5/6 + auto-update.ts).
 */
export function spawnRemoteControl(opts: RemoteControlOptions): ChildProcess {
  const args = ["--setting-sources", "project,local", "remote-control"];

  // TODO(settings-repo-sync.md): `claude remote-control --name "<agent.name>"`
  // does not exist on the verified install (2.1.220, see
  // docs/research/remote-control-mechanism.md) — only `-h` is a valid flag.
  // Re-check `claude remote-control --help` on version bumps and wire
  // opts.agentName through once the flag ships. Falling back to default
  // session naming until then (agentName is currently unused).
  void opts.agentName;

  const env: NodeJS.ProcessEnv = {
    ...(opts.baseEnv ?? process.env),
    ...opts.isolatedEnv,
  };

  const child = spawn("claude", args, {
    cwd: opts.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group so daemon-service.md's teardown requirement
    // ("process-group kill, not a bare kill $PID") is possible via
    // `process.kill(-child.pid, signal)` from the caller.
    detached: true,
  });

  return child;
}

/**
 * Kills the remote-control child's whole process group, per daemon-service.md
 * teardown requirement: "must actually stop the claude remote-control child
 * process, not just the wrapper."
 */
export function killRemoteControlGroup(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Process group may already be gone; fall back to a direct kill attempt.
    child.kill(signal);
  }
}
