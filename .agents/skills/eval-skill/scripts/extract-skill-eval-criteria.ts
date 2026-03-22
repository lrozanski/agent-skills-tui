#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";

import { parseSkillCriteria } from "./lib/skill-criteria.ts";

async function main(): Promise<void> {
  const skillPath = process.argv[2];

  if (!skillPath) {
    console.error("Usage: node extract-skill-eval-criteria.ts <skill-markdown-path>");
    process.exitCode = 1;
    return;
  }

  const markdown = await readFile(skillPath, "utf8");
  const parsed = parseSkillCriteria(markdown, skillPath);
  process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
}

void main();
