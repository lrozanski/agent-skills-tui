import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SkillTree } from "../domain/types.js";
import { discoverSkills } from "./discovery.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (tempDir) => {
      await import("node:fs/promises").then(({ rm }) =>
        rm(tempDir, { recursive: true, force: true }),
      );
    }),
  );
});

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

    expect(names).toEqual([
      "auth-hardening",
      "form-primitives",
      "observability-basics",
      "performance-budgets",
      "secrets-handling",
      "theme-tokens",
      "ui-foundation",
    ]);
  });

  it("stops traversal once a SKILL.md boundary is found", async () => {
    const tree = await discoverSkills(
      path.resolve(process.cwd(), "testdata/local-skill-boundaries"),
    );
    const names = collectSkillNames(tree);

    expect(names).toEqual(["boundary-skill", "grouped-skill"]);
  });

  it("skips malformed skills and reports warnings", async () => {
    const tree = await discoverSkills(
      path.resolve(process.cwd(), "testdata/malformed-frontmatter"),
    );

    expect(collectSkillNames(tree)).toEqual([]);
    expect(tree.warnings).toHaveLength(1);
    expect(tree.warnings[0]).toContain('missing required frontmatter field "name"');
    const malformedNode = Object.values(tree.nodes).find((node) => node.label === "bad-skill");
    expect(malformedNode?.kind).toBe("skill");
    expect(malformedNode?.errorMessage).toContain('missing required frontmatter field "name"');
  });

  it("marks groups with only malformed descendants as malformed", async () => {
    const tree = await discoverSkills(path.resolve(process.cwd(), "testdata"));

    const malformedGroup = Object.values(tree.nodes).find(
      (node) => node.kind === "group" && node.label === "malformed-frontmatter",
    );

    expect(malformedGroup?.errorMessage).toBe("All descendant skills are malformed.");
  });

  it("keeps valid skills visible when siblings are malformed", async () => {
    const tree = await discoverSkills(
      path.resolve(process.cwd(), "testdata/mixed-malformed-skills"),
    );

    expect(collectSkillNames(tree)).toEqual(["good-skill"]);
    expect(tree.warnings).toHaveLength(1);
    expect(tree.warnings[0]).toContain("/testdata/mixed-malformed-skills/bad-skill/SKILL.md");
    const malformedNode = Object.values(tree.nodes).find((node) => node.label === "bad-skill");
    const mixedGroup = Object.values(tree.nodes).find(
      (node) => node.kind === "group" && node.label === "mixed-malformed-skills",
    );
    expect(malformedNode?.kind).toBe("skill");
    expect(malformedNode?.errorMessage).toContain(
      "/testdata/mixed-malformed-skills/bad-skill/SKILL.md",
    );
    expect(mixedGroup?.errorMessage).toBeUndefined();
  });

  it("ignores symlinked files while traversing directories", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-skills-tui-discovery-"));
    tempDirs.push(tempDir);

    const skillDir = path.join(tempDir, "skill-one");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: skill-one\ndescription: Example\n---\n# Skill One\n",
    );
    await writeFile(path.join(tempDir, "CLAUDE-source.md"), "# Claude\n");
    await symlink(path.join(tempDir, "CLAUDE-source.md"), path.join(tempDir, "CLAUDE.md"));

    const tree = await discoverSkills(tempDir);

    expect(collectSkillNames(tree)).toEqual(["skill-one"]);
    expect(tree.warnings).toEqual([]);
  });

  it("skips cyclic symlink directories instead of recursing forever", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-skills-tui-discovery-"));
    tempDirs.push(tempDir);

    const platformDir = path.join(tempDir, "platform");
    const skillDir = path.join(platformDir, "perf-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: perf-skill\ndescription: Example\n---\n# Perf Skill\n",
    );
    await symlink(tempDir, path.join(platformDir, "loop"));

    const tree = await discoverSkills(tempDir);

    expect(collectSkillNames(tree)).toEqual(["perf-skill"]);
    expect(tree.warnings).toContain(
      `Skipped cyclic symlink directory: ${path.join(platformDir, "loop")} -> ${tempDir}`,
    );
  });
});
