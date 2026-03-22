#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";

interface SubagentLog {
  file: string;
  skill_or_task?: string;
  status?: string;
  tools_used?: string[];
  commands_used?: string[];
  artifacts?: string[];
  final_message?: string;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const directoryArg = process.argv[2];
  if (!directoryArg) {
    console.error("Usage: node collect-subagent-logs.ts <directory>");
    process.exitCode = 1;
    return;
  }

  const directory = resolve(directoryArg);
  let entries: string[] = [];

  try {
    entries = (await readdir(directory))
      .filter((entry) => entry.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    process.stdout.write(
      JSON.stringify(
        {
          directory,
          logs: [],
          deduplicated_tools: [],
          deduplicated_commands: [],
        },
        null,
        2,
      ),
    );
    return;
  }

  const logs: SubagentLog[] = [];
  const toolSet = new Set<string>();
  const commandSet = new Set<string>();

  for (const entry of entries) {
    const filePath = join(directory, entry);
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as SubagentLog;
      const log: SubagentLog = {
        file: basename(filePath),
        ...parsed,
      };
      log.tools_used = normalizeStringArray(parsed.tools_used);
      log.commands_used = normalizeStringArray(parsed.commands_used);
      log.artifacts = normalizeStringArray(parsed.artifacts);
      logs.push(log);

      for (const tool of log.tools_used) {
        toolSet.add(tool);
      }

      for (const command of log.commands_used) {
        commandSet.add(command);
      }
    } catch {
      logs.push({
        file: basename(filePath),
        status: "invalid",
        final_message: "Failed to parse subagent log JSON.",
      });
    }
  }

  process.stdout.write(
    JSON.stringify(
      {
        directory,
        logs,
        deduplicated_tools: [...toolSet].sort((left, right) => left.localeCompare(right)),
        deduplicated_commands: [...commandSet].sort((left, right) => left.localeCompare(right)),
      },
      null,
      2,
    ),
  );
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

void main();
