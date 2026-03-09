#!/usr/bin/env node
import { Command } from "commander";
import { render, type Instance } from "ink";

import { runInstall } from "./services/install.js";
import { App, type AppExitResult } from "./ui/App.js";
import {
  beginBufferedStdoutLogs,
  flushBufferedStdoutLogs,
  logErrorToStdout,
} from "./utils/logging.js";

let activeAppInstance: Instance | null = null;
let usingAlternateScreen = false;

function writeTerminalEscape(sequence: string): void {
  if (!process.stdout.isTTY) {
    return;
  }

  process.stdout.write(sequence);
}

function enterAlternateScreen(): void {
  if (usingAlternateScreen || !process.stdout.isTTY) {
    return;
  }

  usingAlternateScreen = true;
  writeTerminalEscape("\u001B[?1049h");
}

function exitAlternateScreen(): void {
  if (!usingAlternateScreen || !process.stdout.isTTY) {
    return;
  }

  writeTerminalEscape("\u001B[?1049l");
  usingAlternateScreen = false;
}

function clearRenderedApp(): void {
  activeAppInstance?.clear();
  activeAppInstance?.cleanup();
  activeAppInstance = null;
}

function registerFatalErrorHandlers(): void {
  process.on("uncaughtException", (error) => {
    clearRenderedApp();
    exitAlternateScreen();
    flushBufferedStdoutLogs();
    logErrorToStdout(error, "Uncaught exception:");
    process.exitCode = 1;
  });

  process.on("unhandledRejection", (reason) => {
    clearRenderedApp();
    exitAlternateScreen();
    flushBufferedStdoutLogs();
    logErrorToStdout(reason, "Unhandled rejection:");
    process.exitCode = 1;
  });
}

async function runCli(): Promise<void> {
  const program = new Command();

  program
    .name("agent-skills-tui")
    .description("Browse and install skills from a local or remote source repository.")
    .argument("<source>", "Source path, GitHub shorthand (owner/repo), or git URL")
    .parse(process.argv);

  const sourceArg = program.args[0];
  const targetCwd = process.cwd();

  enterAlternateScreen();
  beginBufferedStdoutLogs();
  const appInstance = render(<App sourceArg={sourceArg} targetCwd={targetCwd} />, {
    stdout: process.stdout,
    stderr: process.stdout,
  });
  activeAppInstance = appInstance;

  let waitResult: unknown;
  try {
    waitResult = await appInstance.waitUntilExit();
  } finally {
    clearRenderedApp();
    exitAlternateScreen();
    flushBufferedStdoutLogs();
  }

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
    logErrorToStdout(error, "Skill installation failed:");
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

registerFatalErrorHandlers();

void runCli().catch((error) => {
  clearRenderedApp();
  exitAlternateScreen();
  flushBufferedStdoutLogs();
  logErrorToStdout(error, "CLI run failed:");
  process.exitCode = 1;
});
