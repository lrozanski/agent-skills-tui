import { describe, expect, it } from "vitest";

import { resolveForcedExpandedNodeIds } from "./useVisibleSkillRows.js";

describe("resolveForcedExpandedNodeIds", () => {
  it("returns undefined when search is inactive", () => {
    expect(resolveForcedExpandedNodeIds("", new Set(["root"]))).toBeUndefined();
  });

  it("uses auto-expanded search groups by default", () => {
    expect([...resolveForcedExpandedNodeIds("plat", new Set(["root", "platform"])) ?? []].sort())
      .toEqual(["platform", "root"]);
  });

  it("allows collapsed overrides to suppress auto-expanded groups", () => {
    const resolved = resolveForcedExpandedNodeIds("plat", new Set(["root", "platform"]), {
      collapsedGroupIds: new Set(["root", "platform"]),
      expandedGroupIds: new Set(),
    });

    expect([...resolved ?? []]).toEqual([]);
  });

  it("allows explicit expanded overrides to restore groups", () => {
    const resolved = resolveForcedExpandedNodeIds("plat", new Set(["root"]), {
      collapsedGroupIds: new Set(["root"]),
      expandedGroupIds: new Set(["platform"]),
    });

    expect([...resolved ?? []]).toEqual(["platform"]);
  });
});
