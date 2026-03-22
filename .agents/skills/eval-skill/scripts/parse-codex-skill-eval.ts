#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";

import { normalizeCodexSkillEvalStream } from "./lib/parse-codex-skill-eval.ts";

async function main(): Promise<void> {
  const inputPath = process.argv[2];

  if (!inputPath) {
    console.error("Usage: node parse-codex-skill-eval.ts <stream-jsonl-path>");
    process.exitCode = 1;
    return;
  }

  const stream = await readFile(inputPath, "utf8");
  const steps = normalizeCodexSkillEvalStream(stream);
  for (const step of steps) {
    process.stdout.write(`${JSON.stringify(step)}\n`);
  }
}

void main();
