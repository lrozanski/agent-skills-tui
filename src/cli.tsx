#!/usr/bin/env node
import { Command } from "commander";
import { render } from "ink";

import { runInstall } from "./services/install.js";
import { App, type AppExitResult } from "./ui/App.js";

async function runCli(): Promise<void> {
  const program = new Command();

  program
    .name("agent-skills-tui")
    .description("Browse and install skills from a local or remote source repository.")
    .argument("<source>", "Source path, GitHub shorthand (owner/repo), or git URL")
    .parse(process.argv);

  const sourceArg = program.args[0];
  const targetCwd = process.cwd();

  console.clear();
  const appInstance = render(<App sourceArg={sourceArg} targetCwd={targetCwd} />);
  const waitResult = await appInstance.waitUntilExit();
  const result = isAppExitResult(waitResult) ? waitResult : { kind: "quit" as const };

  if (result.kind !== "install") {
    return;
  }

  try {
    await runInstall({
      originalSourceArg: result.sourceArg ?? sourceArg,
      selectedSkillNames: result.selectedSkillNames ?? [],
      cwd: targetCwd,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

function isAppExitResult(value: unknown): value is AppExitResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value.kind === "quit" || value.kind === "install")
  );
}

void runCli().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
