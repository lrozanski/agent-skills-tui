import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

import type { SkillMeta, SkillNode, SkillTree } from "../domain/types.js";
import { logErrorToStdout } from "../utils/logging.js";

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
  activeCanonicalPaths: Set<string>;
  nodes: Record<string, SkillNode>;
  warnings: string[];
}

function compareChildNodeIds(
  leftId: string,
  rightId: string,
  nodes: Record<string, SkillNode>,
): number {
  const leftNode = nodes[leftId];
  const rightNode = nodes[rightId];

  if (!leftNode || !rightNode) {
    return leftId.localeCompare(rightId);
  }

  if (leftNode.kind !== rightNode.kind) {
    return leftNode.kind === "group" ? -1 : 1;
  }

  return leftNode.label.localeCompare(rightNode.label);
}

function hasValidDescendantSkill(nodeId: string, nodes: Record<string, SkillNode>): boolean {
  const node = nodes[nodeId];

  if (!node) {
    return false;
  }

  if (node.kind === "skill") {
    return Boolean(node.skillMeta);
  }

  return node.childIds.some((childId) => hasValidDescendantSkill(childId, nodes));
}

async function resolveDirectoryMetadata(absPath: string): Promise<{
  canonicalPath: string;
  isDirectory: boolean;
  isSymlink: boolean;
}> {
  const lstatResult = await lstat(absPath);
  const canonicalPath = await realpath(absPath);
  const statResult = lstatResult.isSymbolicLink() ? await stat(absPath) : lstatResult;

  return {
    canonicalPath,
    isDirectory: statResult.isDirectory(),
    isSymlink: lstatResult.isSymbolicLink(),
  };
}

async function buildNodeTree(
  absDirPath: string,
  parentId: string | null,
  context: BuildContext,
): Promise<string | null> {
  const { canonicalPath, isDirectory, isSymlink } = await resolveDirectoryMetadata(absDirPath);

  if (!isDirectory) {
    return null;
  }

  if (context.activeCanonicalPaths.has(canonicalPath)) {
    context.warnings.push(`Skipped cyclic symlink directory: ${absDirPath} -> ${canonicalPath}`);
    return null;
  }

  context.activeCanonicalPaths.add(canonicalPath);

  try {
    const dirEntries = await readdir(absDirPath, { withFileTypes: true });
    dirEntries.sort((a, b) => a.name.localeCompare(b.name));

    const hasSkillFile = dirEntries.some(
      (entry) => entry.name === SKILL_FILE_NAME && (entry.isFile() || entry.isSymbolicLink()),
    );
  const symlinkMeta = {
    isSymlink,
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
        logErrorToStdout(error, { includeStack: false });
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

      if (entry.isSymbolicLink()) {
        try {
          const childStat = await stat(childAbsPath);
          if (!childStat.isDirectory()) {
            continue;
          }
        } catch (error) {
          const message = `Skipped unreadable symlink: ${childAbsPath}`;
          context.warnings.push(message);
          logErrorToStdout(error, { context: message, includeStack: false });
          continue;
        }
      }

      const maybeNodeId = await buildNodeTree(childAbsPath, absDirPath, context);
      if (maybeNodeId) {
        childIds.push(maybeNodeId);
      }
    }

    childIds.sort((leftId, rightId) => compareChildNodeIds(leftId, rightId, context.nodes));

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

    if (!hasValidDescendantSkill(nodeId, context.nodes)) {
      context.nodes[nodeId].errorMessage = "All descendant skills are malformed.";
    }

    for (const childId of childIds) {
      const child = context.nodes[childId];
      if (child) {
        child.parentId = nodeId;
      }
    }

    return nodeId;
  } finally {
    context.activeCanonicalPaths.delete(canonicalPath);
  }
}

export async function discoverSkills(rootPath: string): Promise<SkillTree> {
  const absoluteRootPath = path.resolve(rootPath);
  const context: BuildContext = { activeCanonicalPaths: new Set(), nodes: {}, warnings: [] };
  let discoveredRoot: string | null;

  try {
    discoveredRoot = await buildNodeTree(absoluteRootPath, ROOT_ID, context);
  } catch (error) {
    logErrorToStdout(error, `Failed to build skill tree for ${absoluteRootPath}:`);
    throw error;
  }
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
