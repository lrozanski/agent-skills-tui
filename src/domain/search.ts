import fuzzysort from "fuzzysort";

import type { SkillNode, SkillTree } from "./types.js";

export interface SearchResults {
  autoExpandedGroupIds: Set<string>;
  visibleNodeIds: Set<string>;
}

function isMatchingNode(node: SkillNode, query: string): boolean {
  const candidate = node.kind === "skill" ? (node.skillMeta?.name ?? node.label) : node.label;
  return fuzzysort.single(query, candidate) !== null;
}

export function getSearchResults(tree: SkillTree, query: string): SearchResults {
  const visible = new Set<string>();
  const autoExpandedGroupIds = new Set<string>();
  const trimmedQuery = query.trim();

  if (trimmedQuery.length === 0) {
    for (const id of Object.keys(tree.nodes)) {
      visible.add(id);
    }

    return {
      autoExpandedGroupIds,
      visibleNodeIds: visible,
    };
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

  const addAncestorGroups = (nodeId: string): void => {
    let currentId = tree.nodes[nodeId]?.parentId ?? null;

    while (currentId) {
      const currentNode = tree.nodes[currentId];
      if (currentNode?.kind === "group") {
        autoExpandedGroupIds.add(currentId);
      }

      currentId = currentNode?.parentId ?? null;
    }
  };

  for (const node of Object.values(tree.nodes)) {
    if (!isMatchingNode(node, trimmedQuery)) {
      continue;
    }

    addAncestors(node.id);
    addAncestorGroups(node.id);

    if (node.kind === "group") {
      addDescendants(node.id);
      autoExpandedGroupIds.add(node.id);
    }
  }

  visible.add(tree.rootId);
  return {
    autoExpandedGroupIds,
    visibleNodeIds: visible,
  };
}

export function filterTreeBySkillName(tree: SkillTree, query: string): Set<string> {
  return getSearchResults(tree, query).visibleNodeIds;
}

export function getSearchExpandedGroupIds(tree: SkillTree, query: string): Set<string> {
  return getSearchResults(tree, query).autoExpandedGroupIds;
}
