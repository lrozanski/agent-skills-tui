import path from "node:path";

import { renderToString } from "ink";
import { describe, expect, it } from "vitest";

import { flattenVisibleTree } from "../../domain/tree.js";
import { discoverSkills } from "../../services/discovery.js";
import { useAppLayout } from "../hooks/useAppLayout.js";
import { ThemeProvider } from "../theme/ThemeProvider.js";
import { AppLayout } from "./AppLayout.js";
import { DetailsPanel } from "./DetailsPanel.js";
import { SkillTreePanel } from "./SkillTreePanel.js";
import { StatusFooter } from "./StatusFooter.js";

const EXPECTED_FULL_LAYOUT = ` Skills                            0 selected                                    Details

   - [ ] frontend                              Move to a skill to preview its details.
     - [ ] design
       - [ ] systems
 ›         [ ] enterprise-content-authoring-…
        [ ] form-primitives
        [ ] theme-tokens
        [ ] ui-foundation
   - [ ] platform
        [ ] observability-basics
        [ ] performance-budgets
   - [ ] security
        [ ] auth-hardening
        [ ] secrets-handling








 space toggle · / search · r refresh · enter install · ? shortcuts      Source: ./testdata · Source loaded with 2 warnings.`;

describe("AppLayout", () => {
  it("renders the full layout with the long fixture-backed skill truncated in the sidebar", async () => {
    const tree = await discoverSkills(path.resolve(process.cwd(), "testdata/local-nested-skills"));
    const visibleNodeIds = new Set(Object.keys(tree.nodes));
    const visibleRows = flattenVisibleTree(tree, visibleNodeIds);
    const cursorIndex = visibleRows.findIndex((row) => {
      const node = tree.nodes[row.id];
      return node?.kind === "skill" && node.skillMeta?.name === "enterprise-content-authoring-workflow-optimization";
    });

    expect(cursorIndex).toBeGreaterThanOrEqual(0);

    function TestLayout() {
      const {
        stdoutWidth,
        stdoutHeight,
        mainHeight,
        sidebarWidth,
        listWindowStart,
        visibleListRows,
        showFooterSource,
        footerSourceText,
        footerStatusText,
        footerStatusMaxLength,
        visibleFooterShortcuts,
      } = useAppLayout({
        stdoutColumns: 124,
        stdoutRows: 24,
        searchMode: false,
        query: "",
        status: "Source loaded with 2 warnings.",
        activeSourceArg: "./testdata",
        cursorIndex,
        visibleRowsCount: visibleRows.length,
        visibleRows,
      });

      return (
        <ThemeProvider>
          <AppLayout
            details={<DetailsPanel previewEntries={[]} />}
            footer={
              <StatusFooter
                footerSourceText={footerSourceText}
                footerStatusMaxLength={footerStatusMaxLength}
                footerStatusText={footerStatusText}
                query=""
                shortcuts={visibleFooterShortcuts}
                showFooterSource={showFooterSource}
                status="Source loaded with 2 warnings."
              />
            }
            mainHeight={mainHeight}
            sidebar={
              <SkillTreePanel
                busy={false}
                cursorIndex={cursorIndex}
                listWindowStart={listWindowStart}
                selectedCount={0}
                tree={tree}
                visibleListRows={visibleListRows}
              />
            }
            sidebarWidth={sidebarWidth}
            stdoutHeight={stdoutHeight}
            stdoutWidth={stdoutWidth}
          />
        </ThemeProvider>
      );
    }

    const output = renderToString(<TestLayout />, { columns: 124 });

    expect(output).toBe(EXPECTED_FULL_LAYOUT);
  });
});
