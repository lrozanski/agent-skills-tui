import type { SelectionState, SkillNode, SkillTree, VisibleNode } from "./types.js";

function cloneNodes(nodes: Record<string, SkillNode>): Record<string, SkillNode> {
  const cloned: Record<string, SkillNode> = {};

  for (const [id, node] of Object.entries(nodes)) {
    cloned[id] = {
      ...node,
      childIds: [...node.childIds],
    };
  }

  return cloned;
}

function getDescendantSkillIds(nodeId: string, nodes: Record<string, SkillNode>): string[] {
  const node = nodes[nodeId];

  if (!node) {
    return [];
  }

  if (node.kind === "skill") {
    return node.skillMeta ? [node.id] : [];
  }

  const skills: string[] = [];
  for (const childId of node.childIds) {
    skills.push(...getDescendantSkillIds(childId, nodes));
  }

  return skills;
}

function recomputeSelectionFrom(
  nodeId: string,
  nodes: Record<string, SkillNode>,
  visited = new Set<string>(),
): SelectionState {
  if (visited.has(nodeId)) {
    return nodes[nodeId]?.selection ?? "unchecked";
  }

  visited.add(nodeId);
  const node = nodes[nodeId];

  if (!node) {
    return "unchecked";
  }

  if (node.kind === "skill") {
    return node.skillMeta ? node.selection : "unchecked";
  }

  const childSelections = node.childIds
    .filter((childId) => {
      const childNode = nodes[childId];
      return childNode?.kind !== "skill" || Boolean(childNode.skillMeta);
    })
    .map((childId) => recomputeSelectionFrom(childId, nodes, visited));

  if (childSelections.length === 0) {
    node.selection = "unchecked";
    return node.selection;
  }

  const allChecked = childSelections.every((selection) => selection === "checked");
  const allUnchecked = childSelections.every((selection) => selection === "unchecked");

  if (allChecked) {
    node.selection = "checked";
  } else if (allUnchecked) {
    node.selection = "unchecked";
  } else {
    node.selection = "partial";
  }

  return node.selection;
}

export function toggleSelection(
  tree: SkillTree,
  nodeId: string,
  visibleNodeIds?: Set<string>,
): SkillTree {
  const nextNodes = cloneNodes(tree.nodes);
  const node = nextNodes[nodeId];

  if (!node || (node.kind === "skill" && !node.skillMeta)) {
    return tree;
  }

  const targetSkillIds =
    node.kind === "skill" ? [node.id] : getDescendantSkillIds(node.id, nextNodes);
  const scopedSkillIds =
    visibleNodeIds === undefined
      ? targetSkillIds
      : targetSkillIds.filter((skillId) => visibleNodeIds.has(skillId));

  if (scopedSkillIds.length === 0) {
    return tree;
  }

  const allChecked = scopedSkillIds.every((skillId) => nextNodes[skillId]?.selection === "checked");
  const nextSelection: SelectionState = allChecked ? "unchecked" : "checked";

  for (const skillId of scopedSkillIds) {
    const skillNode = nextNodes[skillId];
    if (skillNode && skillNode.kind === "skill") {
      skillNode.selection = nextSelection;
    }
  }

  recomputeSelectionFrom(tree.rootId, nextNodes);

  return {
    ...tree,
    nodes: nextNodes,
  };
}

export function setExpanded(tree: SkillTree, nodeId: string, expanded: boolean): SkillTree {
  const node = tree.nodes[nodeId];
  if (!node || node.kind !== "group" || node.expanded === expanded) {
    return tree;
  }

  const nextNodes = cloneNodes(tree.nodes);
  const updateExpanded = (currentNodeId: string): void => {
    const currentNode = nextNodes[currentNodeId];
    if (!currentNode || currentNode.kind !== "group") {
      return;
    }

    currentNode.expanded = expanded;

    if (!expanded) {
      for (const childId of currentNode.childIds) {
        updateExpanded(childId);
      }
    }
  };

  updateExpanded(nodeId);

  return {
    ...tree,
    nodes: nextNodes,
  };
}

export function setAllExpanded(tree: SkillTree, expanded: boolean): SkillTree {
  const nextNodes = cloneNodes(tree.nodes);
  let changed = false;

  for (const node of Object.values(nextNodes)) {
    if (node.kind !== "group" || node.id === tree.rootId) {
      continue;
    }

    if (node.expanded !== expanded) {
      node.expanded = expanded;
      changed = true;
    }
  }

  if (!changed) {
    return tree;
  }

  return {
    ...tree,
    nodes: nextNodes,
  };
}

export interface SelectedSkill {
  name: string;
  canonicalPath: string;
}

export function getSelectedSkills(tree: SkillTree): SelectedSkill[] {
  const selected = Object.values(tree.nodes).filter(
    (node) => node.kind === "skill" && node.selection === "checked" && node.skillMeta,
  );
  const deduped = new Map<string, SelectedSkill>();

  for (const node of selected) {
    const name = node.skillMeta?.name;
    if (!name) {
      continue;
    }

    const key = `${node.canonicalPath}::${name}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        name,
        canonicalPath: node.canonicalPath,
      });
    }
  }

  return [...deduped.values()];
}

export function flattenVisibleTree(
  tree: SkillTree,
  visibleNodeIds: Set<string>,
  forcedExpandedNodeIds?: Set<string>,
): VisibleNode[] {
  const flattened: VisibleNode[] = [];
  const root = tree.nodes[tree.rootId];

  if (!root) {
    return flattened;
  }

  const walk = (nodeId: string, depth: number): void => {
    const node = tree.nodes[nodeId];
    if (!node || (nodeId !== tree.rootId && !visibleNodeIds.has(nodeId))) {
      return;
    }

    if (nodeId !== tree.rootId) {
      flattened.push({ id: node.id, depth });
    }

    if (node.kind === "group") {
      const shouldTraverse =
        nodeId === tree.rootId || node.expanded || Boolean(forcedExpandedNodeIds?.has(nodeId));
      if (!shouldTraverse) {
        return;
      }

      for (const childId of node.childIds) {
        walk(childId, nodeId === tree.rootId ? depth : depth + 1);
      }
    }
  };

  walk(tree.rootId, 0);
  return flattened;
}

export function getAncestorIds(tree: SkillTree, nodeId: string): string[] {
  const ancestorIds: string[] = [];
  let currentId = tree.nodes[nodeId]?.parentId ?? null;

  while (currentId) {
    ancestorIds.push(currentId);
    currentId = tree.nodes[currentId]?.parentId ?? null;
  }

  return ancestorIds;
}
