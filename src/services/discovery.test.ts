import path from "node:path";

import { describe, expect, it } from "vitest";

import type { SkillTree } from "../domain/types.js";
import { discoverSkills } from "./discovery.js";

function collectSkillNames(tree: SkillTree): string[] {
  return Object.values(tree.nodes)
    .filter((node) => node.kind === "skill" && node.skillMeta)
    .map((node) => node.skillMeta?.name ?? "")
    .sort();
}

describe("discoverSkills", () => {
  it("finds skills across nested folders", async () => {
    const tree = await discoverSkills(path.resolve(process.cwd(), "testdata/local-nested-skills"));
    const names = collectSkillNames(tree);

    expect(names).toEqual(["auth-hardening", "observability-basics", "ui-foundation"]);
  });

  it("stops traversal once a SKILL.md boundary is found", async () => {
    const tree = await discoverSkills(
      path.resolve(process.cwd(), "testdata/local-skill-boundaries"),
    );
    const names = collectSkillNames(tree);

    expect(names).toContain("boundary-skill");
    expect(names).toContain("grouped-skill");
    expect(names).not.toContain("should-not-appear");
  });

  it("skips malformed skills and reports warnings", async () => {
    const tree = await discoverSkills(
      path.resolve(process.cwd(), "testdata/malformed-frontmatter"),
    );

    expect(collectSkillNames(tree)).toEqual([]);
    expect(tree.warnings).toHaveLength(1);
    expect(tree.warnings[0]).toContain('missing required frontmatter field "name"');
  });

  it("keeps valid skills visible when siblings are malformed", async () => {
    const tree = await discoverSkills(
      path.resolve(process.cwd(), "testdata/mixed-malformed-skills"),
    );

    expect(collectSkillNames(tree)).toEqual(["good-skill"]);
    expect(tree.warnings).toHaveLength(1);
    expect(tree.warnings[0]).toContain("/testdata/mixed-malformed-skills/bad-skill/SKILL.md");
  });
});
