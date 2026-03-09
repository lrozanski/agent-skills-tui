import { useCallback, useMemo } from "react";

import { getSearchResults } from "../../domain/search.js";
import { flattenVisibleTree, getSelectedSkills } from "../../domain/tree.js";
import type { SkillTree } from "../../domain/types.js";

interface UseVisibleSkillRowsParams {
  tree: SkillTree | null;
  query: string;
  cursorIndex: number;
  searchExpandedOverrides?: {
    collapsedGroupIds: Set<string>;
    expandedGroupIds: Set<string>;
  };
}

export function resolveForcedExpandedNodeIds(
  query: string,
  autoExpandedGroupIds: Set<string>,
  searchExpandedOverrides?: {
    collapsedGroupIds: Set<string>;
    expandedGroupIds: Set<string>;
  },
): Set<string> | undefined {
  if (query.trim().length === 0) {
    return undefined;
  }

  const nextForcedExpanded = new Set(autoExpandedGroupIds);

  for (const groupId of searchExpandedOverrides?.expandedGroupIds ?? []) {
    nextForcedExpanded.add(groupId);
  }

  for (const groupId of searchExpandedOverrides?.collapsedGroupIds ?? []) {
    nextForcedExpanded.delete(groupId);
  }

  return nextForcedExpanded;
}

export function useVisibleSkillRows({
  tree,
  query,
  cursorIndex,
  searchExpandedOverrides,
}: UseVisibleSkillRowsParams) {
  const searchResults = useMemo(() => {
    if (!tree) {
      return {
        autoExpandedGroupIds: new Set<string>(),
        visibleNodeIds: new Set<string>(),
      };
    }

    return getSearchResults(tree, query);
  }, [tree, query]);
  const { autoExpandedGroupIds, visibleNodeIds } = searchResults;

  const forcedExpandedNodeIds = useMemo(() => {
    return resolveForcedExpandedNodeIds(query, autoExpandedGroupIds, searchExpandedOverrides);
  }, [autoExpandedGroupIds, query, searchExpandedOverrides]);

  const visibleRows = useMemo(() => {
    if (!tree) {
      return [];
    }

    return flattenVisibleTree(tree, visibleNodeIds, forcedExpandedNodeIds);
  }, [tree, visibleNodeIds, forcedExpandedNodeIds]);

  const selectedSkills = useMemo(() => {
    if (!tree) {
      return [];
    }

    return getSelectedSkills(tree);
  }, [tree]);

  const activeRow = visibleRows[cursorIndex];
  const activeNode = tree && activeRow ? tree.nodes[activeRow.id] : undefined;
  const previewEntries =
    activeNode?.kind === "skill" && activeNode.skillMeta
      ? Object.entries(activeNode.skillMeta.frontmatter)
      : [];

  const getRowIndexForQuery = useCallback(
    (nodeId: string, nextQuery: string): number => {
      if (!tree) {
        return -1;
      }

      const nextSearchResults = getSearchResults(tree, nextQuery);
      const nextVisibleNodeIds = nextSearchResults.visibleNodeIds;
      const nextForcedExpandedNodeIds =
        nextQuery.trim().length > 0 ? nextSearchResults.autoExpandedGroupIds : undefined;
      const nextVisibleRows = flattenVisibleTree(tree, nextVisibleNodeIds, nextForcedExpandedNodeIds);
      return nextVisibleRows.findIndex((row) => row.id === nodeId);
    },
    [tree],
  );

  return {
    visibleNodeIds,
    visibleRows,
    forcedExpandedNodeIds,
    selectedSkills,
    activeRow,
    activeNode,
    previewEntries,
    getRowIndexForQuery,
  };
}
