import { basename } from "node:path";

interface MatterData {
  [key: string]: unknown;
}

export interface ParsedSkillCriteria {
  skill_name: string;
  description?: string;
  purpose?: string;
  inputs: string[];
  workflow: string[];
  required_outputs?: string[];
  final_response_requirements?: string[];
  critical_rules: string[];
  completion_criteria: string[];
  raw_sections: Record<string, string>;
}

const CANONICAL_SECTION_ALIASES = {
  purpose: ["Purpose", "Goal", "Objective", "Overview"],
  inputs: ["Inputs", "Input", "Parameters"],
  workflow: ["Workflow", "Process", "Steps"],
  required_outputs: ["Required Outputs", "Outputs", "Artifacts"],
  final_response_requirements: ["Final User Response", "Final Response", "User Response"],
  critical_rules: ["Critical Rules", "Rules", "Guardrails"],
  completion_criteria: [
    "Completion Criteria",
    "Done Criteria",
    "Success Criteria",
    "Definition of Done",
  ],
} as const;

export function parseSkillCriteria(markdown: string, fallbackPath?: string): ParsedSkillCriteria {
  const { data, content } = parseFrontmatter(markdown);
  const skillName =
    getFrontmatterString(data.name) ?? (fallbackPath ? basename(fallbackPath, ".md") : "unknown-skill");

  const sections = extractSections(content);
  const rawSections = Object.fromEntries(sections.map((section) => [section.name, section.content]));

  const purposeSection = findSection(sections, CANONICAL_SECTION_ALIASES.purpose)?.content ?? "";
  const inputsSection = findSection(sections, CANONICAL_SECTION_ALIASES.inputs)?.content ?? "";
  const workflowSection = findSection(sections, CANONICAL_SECTION_ALIASES.workflow)?.content ?? "";
  const requiredOutputsSection =
    findSection(sections, CANONICAL_SECTION_ALIASES.required_outputs)?.content ?? "";
  const finalResponseSection =
    findSection(sections, CANONICAL_SECTION_ALIASES.final_response_requirements)?.content ?? "";
  const criticalRulesMatch = findSection(sections, CANONICAL_SECTION_ALIASES.critical_rules);
  const criticalRulesSection = criticalRulesMatch?.content ?? "";
  const completionCriteriaSection =
    findSection(sections, CANONICAL_SECTION_ALIASES.completion_criteria)?.content ?? "";
  const criticalRules = extractListItems(criticalRulesSection);
  const requiredOutputs = extractListItems(requiredOutputsSection);
  const finalResponseRequirements = extractListItems(finalResponseSection);

  const parsed: ParsedSkillCriteria = {
    skill_name: skillName,
    description: getFrontmatterString(data.description),
    purpose: cleanParagraph(purposeSection),
    inputs: extractListItems(inputsSection),
    workflow: extractListItems(workflowSection),
    critical_rules: criticalRules,
    completion_criteria: extractListItems(completionCriteriaSection),
    raw_sections: rawSections,
  };

  if (requiredOutputs.length > 0) {
    parsed.required_outputs = requiredOutputs;
  }

  if (finalResponseRequirements.length > 0) {
    parsed.final_response_requirements = finalResponseRequirements;
  }

  return parsed;
}

function parseFrontmatter(markdown: string): { data: MatterData; content: string } {
  if (!markdown.startsWith("---\n")) {
    return { data: {}, content: markdown };
  }

  const closingIndex = markdown.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return { data: {}, content: markdown };
  }

  const frontmatter = markdown.slice(4, closingIndex);
  const content = markdown.slice(closingIndex + 5);
  const data: MatterData = {};
  let pendingKey: string | null = null;
  let pendingFolded: string[] = [];

  const flushPending = (): void => {
    if (!pendingKey) {
      return;
    }

    data[pendingKey] = pendingFolded.join(" ").trim();
    pendingKey = null;
    pendingFolded = [];
  };

  for (const rawLine of frontmatter.split(/\r?\n/u)) {
    if (pendingKey) {
      if (/^\s+/u.test(rawLine)) {
        pendingFolded.push(rawLine.trim());
        continue;
      }

      flushPending();
    }

    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(rawLine);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (rawValue === ">-") {
      pendingKey = key;
      pendingFolded = [];
      continue;
    }

    data[key] = stripWrappingQuotes(rawValue.trim());
  }

  flushPending();
  return { data, content };
}

function extractSections(content: string): Array<{ name: string; content: string }> {
  const lines = content.split(/\r?\n/u);
  const sections: Array<{ name: string; content: string }> = [];
  let currentName: string | null = null;
  let currentLines: string[] = [];
  let inFence = false;

  const flush = (): void => {
    if (!currentName) {
      return;
    }
    sections.push({
      name: currentName,
      content: currentLines.join("\n").trim(),
    });
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      if (currentName) {
        currentLines.push(line);
      }
      continue;
    }

    if (inFence) {
      if (currentName) {
        currentLines.push(line);
      }
      continue;
    }

    const headingMatch = /^##\s+(.+?)\s*$/u.exec(line.trim());
    if (headingMatch) {
      flush();
      currentName = headingMatch[1];
      currentLines = [];
      continue;
    }

    if (currentName) {
      currentLines.push(line);
    }
  }

  flush();
  return sections;
}

function findSection(
  sections: Array<{ name: string; content: string }>,
  aliases: readonly string[],
): { name: string; content: string } | undefined {
  for (const alias of aliases) {
    const match = sections.find((section) => section.name.trim().toLowerCase() === alias.toLowerCase());
    if (match) {
      return match;
    }
  }

  return undefined;
}

function extractListItems(section: string): string[] {
  if (!section.trim()) {
    return [];
  }

  const items: string[] = [];
  let current: string | null = null;
  let topLevelIndent: number | null = null;

  for (const rawLine of section.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    const markerMatch = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/u.exec(rawLine);

    if (markerMatch) {
      const indent = markerMatch[1].length;

      if (topLevelIndent === null) {
        topLevelIndent = indent;
      }

      if (indent === topLevelIndent) {
        if (current) {
          items.push(cleanParagraph(current));
        }
        current = markerMatch[2].trim();
        continue;
      }

      if (current) {
        current = `${current} ${markerMatch[2].trim()}`;
        continue;
      }
    }

    if (!current) {
      continue;
    }

    if (line.trim().length === 0) {
      items.push(cleanParagraph(current));
      current = null;
      continue;
    }

    current = `${current} ${line.trim()}`;
  }

  if (current) {
    items.push(cleanParagraph(current));
  }

  return items.filter((item) => item.length > 0);
}

function cleanParagraph(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function getFrontmatterString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
