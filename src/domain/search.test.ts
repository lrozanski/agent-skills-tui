import { describe, expect, it } from "vitest";

import { filterTreeBySkillName } from "./search.js";
import type { SkillTree } from "./types.js";

const tree: SkillTree = {
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
      childIds: ["g1", "s2"],
      expanded: true,
      selection: "unchecked",
    },
    g1: {
      id: "g1",
      kind: "group",
      label: "group",
      absPath: "/root/group",
      canonicalPath: "/root/group",
      parentId: "root",
      childIds: ["s1"],
      expanded: true,
      selection: "unchecked",
    },
    s1: {
      id: "s1",
      kind: "skill",
      label: "backend",
      absPath: "/root/group/backend",
      canonicalPath: "/root/group/backend",
      parentId: "g1",
      childIds: [],
      expanded: false,
      selection: "unchecked",
      skillMeta: {
        name: "backend-hardening",
        description: "",
        frontmatter: {
          name: "backend-hardening",
          description: "",
        },
      },
    },
    s2: {
      id: "s2",
      kind: "skill",
      label: "frontend",
      absPath: "/root/frontend",
      canonicalPath: "/root/frontend",
      parentId: "root",
      childIds: [],
      expanded: false,
      selection: "unchecked",
      skillMeta: {
        name: "frontend-basics",
        description: "",
        frontmatter: {
          name: "frontend-basics",
          description: "",
        },
      },
    },
  },
};

describe("filterTreeBySkillName", () => {
  it("returns all nodes for an empty query", () => {
    const visible = filterTreeBySkillName(tree, "");
    expect([...visible].sort()).toEqual(["g1", "root", "s1", "s2"]);
  });

  it("returns matching skills and required ancestors", () => {
    const visible = filterTreeBySkillName(tree, "back");
    expect([...visible].sort()).toEqual(["g1", "root", "s1"]);
  });
});
