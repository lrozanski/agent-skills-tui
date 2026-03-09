import fuzzysort from "fuzzysort";

import type { SkillNode, SkillTree } from "./types.js";

function isMatchingNode(node: SkillNode, query: string): boolean {
  const candidate = node.kind === "skill" ? (node.skillMeta?.name ?? node.label) : node.label;
  return fuzzysort.single(query, candidate) !== null;
}

export function filterTreeBySkillName(tree: SkillTree, query: string): Set<string> {
  const visible = new Set<string>();
  const trimmedQuery = query.trim();

  if (trimmedQuery.length === 0) {
    for (const id of Object.keys(tree.nodes)) {
      visible.add(id);
    }

    return visible;
  }

  const addAncestors = (nodeId: string): void => {
    let currentId: string | null = nodeId;
    while (currentId) {
      visible.add(currentId);
      currentId = tree.nodes[currentId]?.parentId ?? null;
    }
  };

  const addDescendants = (nodeId: string): void => {
    visible.add(nodeId);

    const node = tree.nodes[nodeId];
    if (!node || node.kind !== "group") {
      return;
    }

    for (const childId of node.childIds) {
      addDescendants(childId);
    }
  };

  for (const node of Object.values(tree.nodes)) {
    if (!isMatchingNode(node, trimmedQuery)) {
      continue;
    }

    addAncestors(node.id);

    if (node.kind === "group") {
      addDescendants(node.id);
    }
  }

  visible.add(tree.rootId);
  return visible;
}

export function getSearchExpandedGroupIds(tree: SkillTree, query: string): Set<string> {
  const expandedGroupIds = new Set<string>();
  const trimmedQuery = query.trim();

  if (trimmedQuery.length === 0) {
    return expandedGroupIds;
  }

  const addAncestorGroups = (nodeId: string): void => {
    let currentId = tree.nodes[nodeId]?.parentId ?? null;

    while (currentId) {
      const currentNode = tree.nodes[currentId];
      if (currentNode?.kind === "group") {
        expandedGroupIds.add(currentId);
      }

      currentId = currentNode?.parentId ?? null;
    }
  };

  for (const node of Object.values(tree.nodes)) {
    if (!isMatchingNode(node, trimmedQuery)) {
      continue;
    }

    addAncestorGroups(node.id);

    if (node.kind === "group") {
      expandedGroupIds.add(node.id);
    }
  }

  return expandedGroupIds;
}
