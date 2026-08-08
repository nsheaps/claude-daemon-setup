import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { launchdLabel, parseAgentYaml } from "../settings-repo-sync.js";

describe("launchdLabel", () => {
  test("slugifies a simple name", () => {
    expect(launchdLabel("my-agent")).toBe("com.nsheaps.claude-daemon.my-agent");
  });

  test("lowercases and strips invalid characters", () => {
    expect(launchdLabel("My Cool Agent!!")).toBe("com.nsheaps.claude-daemon.my-cool-agent");
  });

  test("trims leading/trailing separators produced by slugification", () => {
    expect(launchdLabel("__leading and trailing__")).toBe(
      "com.nsheaps.claude-daemon.leading-and-trailing",
    );
  });
});

describe("parseAgentYaml", () => {
  const scratch = `${import.meta.dir}/.scratch-agent-yaml`;

  test("parses name and description", () => {
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(scratch, { recursive: true });
    writeFileSync(
      `${scratch}/agent.yaml`,
      ['agent:', '  name: my-agent', '  description: "does things"', ""].join("\n"),
    );
    const config = parseAgentYaml(scratch);
    expect(config).toEqual({ name: "my-agent", description: "does things" });
    rmSync(scratch, { recursive: true, force: true });
  });

  test("throws when agent.name is missing", () => {
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(scratch, { recursive: true });
    writeFileSync(scratch + "/agent.yaml", "agent:\n  description: no name here\n");
    expect(() => parseAgentYaml(scratch)).toThrow(/missing required field agent.name/);
    rmSync(scratch, { recursive: true, force: true });
  });

  test("throws when agent.yaml is absent", () => {
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(scratch, { recursive: true });
    expect(() => parseAgentYaml(scratch)).toThrow(/agent.yaml not found/);
    rmSync(scratch, { recursive: true, force: true });
  });
});
