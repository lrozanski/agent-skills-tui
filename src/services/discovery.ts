import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

import type { SkillMeta, SkillNode, SkillTree } from "../domain/types.js";

const SKILL_FILE_NAME = "SKILL.md";
const ROOT_ID = "__root__";

async function parseSkillMeta(skillFilePath: string): Promise<SkillMeta> {
  const raw = await readFile(skillFilePath, "utf-8");
  const parsed = matter(raw);
  const frontmatter =
    parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
      ? { ...parsed.data }
      : {};

  const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
  const description =
    typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";

  if (!name) {
    throw new Error(
      `Malformed ${SKILL_FILE_NAME}: missing required frontmatter field "name" at ${skillFilePath}`,
    );
  }

  return { name, description, frontmatter };
}

interface BuildContext {
  nodes: Record<string, SkillNode>;
  warnings: string[];
}

async function buildNodeTree(
  absDirPath: string,
  parentId: string | null,
  context: BuildContext,
): Promise<string | null> {
  const dirEntries = await readdir(absDirPath, { withFileTypes: true });
  dirEntries.sort((a, b) => a.name.localeCompare(b.name));

  const hasSkillFile = dirEntries.some((entry) => entry.isFile() && entry.name === SKILL_FILE_NAME);
  const lstatResult = await lstat(absDirPath);
  const canonicalPath = await realpath(absDirPath);
  const symlinkMeta = {
    isSymlink: lstatResult.isSymbolicLink(),
    realPath: canonicalPath,
  };

  if (hasSkillFile) {
    let skillMeta: SkillMeta | undefined;
    let errorMessage: string | undefined;

    try {
      skillMeta = await parseSkillMeta(path.join(absDirPath, SKILL_FILE_NAME));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.warnings.push(message);
      errorMessage = message;
    }

    const nodeId = absDirPath;

    context.nodes[nodeId] = {
      id: nodeId,
      kind: "skill",
      label: path.basename(absDirPath),
      absPath: absDirPath,
      canonicalPath,
      parentId,
      childIds: [],
      expanded: false,
      selection: "unchecked",
      skillMeta,
      errorMessage,
      symlinkMeta,
    };

    return nodeId;
  }

  const childIds: string[] = [];

  for (const entry of dirEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const childAbsPath = path.join(absDirPath, entry.name);
    const childStat = await lstat(childAbsPath);
    if (!childStat.isDirectory() && !childStat.isSymbolicLink()) {
      continue;
    }

    const maybeNodeId = await buildNodeTree(childAbsPath, absDirPath, context);
    if (maybeNodeId) {
      childIds.push(maybeNodeId);
    }
  }

  if (childIds.length === 0) {
    return null;
  }

  const nodeId = absDirPath;
  context.nodes[nodeId] = {
    id: nodeId,
    kind: "group",
    label: path.basename(absDirPath),
    absPath: absDirPath,
    canonicalPath,
    parentId,
    childIds,
    expanded: true,
    selection: "unchecked",
    symlinkMeta,
  };

  for (const childId of childIds) {
    const child = context.nodes[childId];
    if (child) {
      child.parentId = nodeId;
    }
  }

  return nodeId;
}

export async function discoverSkills(rootPath: string): Promise<SkillTree> {
  const absoluteRootPath = path.resolve(rootPath);
  const context: BuildContext = { nodes: {}, warnings: [] };

  const discoveredRoot = await buildNodeTree(absoluteRootPath, ROOT_ID, context);
  if (!discoveredRoot) {
    if (context.warnings.length === 0) {
      throw new Error(`No skills found under source path: ${absoluteRootPath}`);
    }

    const canonicalRootPath = await realpath(absoluteRootPath);
    context.nodes[ROOT_ID] = {
      id: ROOT_ID,
      kind: "group",
      label: path.basename(absoluteRootPath),
      absPath: absoluteRootPath,
      canonicalPath: canonicalRootPath,
      parentId: null,
      childIds: [],
      expanded: true,
      selection: "unchecked",
    };

    return {
      rootId: ROOT_ID,
      nodes: context.nodes,
      warnings: context.warnings,
    };
  }

  const canonicalRootPath = await realpath(absoluteRootPath);
  const rootChildIds =
    discoveredRoot === absoluteRootPath
      ? (context.nodes[discoveredRoot]?.childIds ?? [])
      : [discoveredRoot];

  if (discoveredRoot === absoluteRootPath) {
    delete context.nodes[discoveredRoot];
    for (const childId of rootChildIds) {
      const childNode = context.nodes[childId];
      if (childNode) {
        childNode.parentId = ROOT_ID;
      }
    }
  }

  context.nodes[ROOT_ID] = {
    id: ROOT_ID,
    kind: "group",
    label: path.basename(absoluteRootPath),
    absPath: absoluteRootPath,
    canonicalPath: canonicalRootPath,
    parentId: null,
    childIds: rootChildIds,
    expanded: true,
    selection: "unchecked",
  };

  return {
    rootId: ROOT_ID,
    nodes: context.nodes,
    warnings: context.warnings,
  };
}
