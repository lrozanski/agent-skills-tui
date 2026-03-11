import { describe, expect, it } from "vitest";

import type { SkillNode } from "../../domain/types.js";
import { defaultTheme } from "../theme/theme.js";
import {
  footerShortcutWidth,
  getSelectionBackground,
  getStatusColor,
  nodeIcon,
  rowIndent,
  rowPrefix,
  selectionMark,
} from "./presentation.js";

function createNode(overrides: Partial<SkillNode>): SkillNode {
  return {
    id: "node",
    kind: "skill",
    label: "Node",
    absPath: "/tmp/node",
    canonicalPath: "/tmp/node",
    parentId: null,
    childIds: [],
    expanded: false,
    selection: "unchecked",
    ...overrides,
  };
}

describe("presentation utils", () => {
  it("formats row chrome values", () => {
    expect(rowPrefix(true)).toBe("›");
    expect(selectionMark("checked")).toBe("[x]");
    expect(selectionMark("partial")).toBe("[-]");
    expect(selectionMark("unchecked")).toBe("[ ]");
  });

  it("chooses group icons", () => {
    expect(nodeIcon(createNode({ kind: "group", expanded: true }))).toBe("-");
    expect(nodeIcon(createNode({ kind: "group", expanded: false }))).toBe("+");
    expect(nodeIcon(createNode({ kind: "skill" }))).toBe("");
  });

  it("adds one extra space of indentation for skill rows", () => {
    expect(rowIndent(1, createNode({ kind: "group" }))).toBe("  ");
    expect(rowIndent(1, createNode({ kind: "skill" }))).toBe("   ");
  });

  it("derives theme-aware colors", () => {
    expect(getStatusColor(defaultTheme, "Loading source...")).toBe(defaultTheme.colors.warning);
    expect(getStatusColor(defaultTheme, "Source loaded.")).toBe(defaultTheme.colors.success);
    expect(getStatusColor(defaultTheme, "Unhandled issue")).toBe(defaultTheme.colors.muted);
    expect(
      getSelectionBackground(defaultTheme, createNode({ kind: "group", errorMessage: "bad" })),
    ).toBe(defaultTheme.colors.selectionError);
    expect(getSelectionBackground(defaultTheme, createNode({ kind: "group" }))).toBe(
      defaultTheme.colors.selectionGroup,
    );
    expect(getSelectionBackground(defaultTheme, createNode({ kind: "skill" }))).toBe(
      defaultTheme.colors.selectionSkill,
    );
  });

  it("measures footer shortcut width", () => {
    expect(footerShortcutWidth({ label: "q", action: "quit" })).toBe(6);
  });
});
