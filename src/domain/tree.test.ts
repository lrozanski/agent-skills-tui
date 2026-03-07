import { describe, expect, it } from "vitest";

import { flattenVisibleTree, getSelectedSkills, setExpanded, toggleSelection } from "./tree.js";
import type { SkillTree } from "./types.js";

function buildTree(): SkillTree {
  return {
    rootId: "root",
    warnings: [],
    nodes: {
      root: {
        id: "root",
        kind: "group",
        label: "root",
        absPath: "/root",
        canonicalPath: "/root",
        parentId: null,
        childIds: ["g1"],
        expanded: true,
        selection: "unchecked",
      },
      g1: {
        id: "g1",
        kind: "group",
        label: "group",
        absPath: "/root/group",
        canonicalPath: "/real/group",
        parentId: "root",
        childIds: ["s1", "s2"],
        expanded: true,
        selection: "unchecked",
      },
      s1: {
        id: "s1",
        kind: "skill",
        label: "skill-a",
        absPath: "/root/group/skill-a",
        canonicalPath: "/real/shared",
        parentId: "g1",
        childIds: [],
        expanded: false,
        selection: "unchecked",
        skillMeta: {
          name: "skill-a",
          description: "",
        },
      },
      s2: {
        id: "s2",
        kind: "skill",
        label: "skill-a-link",
        absPath: "/root/group/skill-a-link",
        canonicalPath: "/real/shared",
        parentId: "g1",
        childIds: [],
        expanded: false,
        selection: "unchecked",
        skillMeta: {
          name: "skill-a",
          description: "",
        },
      },
    },
  };
}

describe("toggleSelection", () => {
  it("selects all descendants for a group toggle", () => {
    const tree = buildTree();
    const updated = toggleSelection(tree, "g1");

    expect(updated.nodes.s1.selection).toBe("checked");
    expect(updated.nodes.s2.selection).toBe("checked");
    expect(updated.nodes.g1.selection).toBe("checked");
  });

  it("applies group selection only to visible descendants during filtering", () => {
    const tree = buildTree();
    const visible = new Set(["root", "g1", "s1"]);
    const updated = toggleSelection(tree, "g1", visible);

    expect(updated.nodes.s1.selection).toBe("checked");
    expect(updated.nodes.s2.selection).toBe("unchecked");
    expect(updated.nodes.g1.selection).toBe("partial");
  });
});

describe("getSelectedSkills", () => {
  it("dedupes selected skills by canonical path and name", () => {
    let tree = buildTree();
    tree = toggleSelection(tree, "s1");
    tree = toggleSelection(tree, "s2");

    const selected = getSelectedSkills(tree);

    expect(selected).toEqual([
      {
        name: "skill-a",
        canonicalPath: "/real/shared",
      },
    ]);
  });
});

describe("flattenVisibleTree", () => {
  it("respects expanded state outside search mode", () => {
    const tree = setExpanded(buildTree(), "g1", false);
    const visible = new Set(["root", "g1", "s1", "s2"]);

    const rows = flattenVisibleTree(tree, visible, false);
    expect(rows.map((row) => row.id)).toEqual(["g1"]);
  });

  it("forces expanded traversal while filtering", () => {
    const tree = setExpanded(buildTree(), "g1", false);
    const visible = new Set(["root", "g1", "s1"]);

    const rows = flattenVisibleTree(tree, visible, true);
    expect(rows.map((row) => row.id)).toEqual(["g1", "s1"]);
  });
});
