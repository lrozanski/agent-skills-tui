import { useApp, useInput, useStdout } from "ink";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";

import { filterTreeBySkillName } from "../domain/search.js";
import { flattenVisibleTree, setAllExpanded, setExpanded, toggleSelection } from "../domain/tree.js";
import { AppLayout } from "./components/AppLayout.js";
import { DetailsPanel } from "./components/DetailsPanel.js";
import { SearchBar } from "./components/SearchBar.js";
import { ShortcutsPanel } from "./components/ShortcutsPanel.js";
import { SkillTreePanel } from "./components/SkillTreePanel.js";
import { StatusFooter } from "./components/StatusFooter.js";
import { useAppInputHandler } from "./hooks/useAppInputHandler.js";
import { useAppLayout } from "./hooks/useAppLayout.js";
import { useSkillTreeState } from "./hooks/useSkillTreeState.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useVisibleSkillRows } from "./hooks/useVisibleSkillRows.js";
import { ThemeProvider } from "./theme/ThemeProvider.js";
import { clamp } from "./utils/text.js";

export interface AppExitResult {
  kind: "quit" | "install";
  selectedSkillNames?: string[];
  sourceArg?: string;
}

interface AppProps {
  sourceArg: string;
  targetCwd: string;
}

export function App(props: AppProps) {
  return (
    <ThemeProvider>
      <AppContent {...props} />
    </ThemeProvider>
  );
}

function AppContent({ sourceArg, targetCwd }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalSize = useTerminalSize(stdout);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [collapsedSearchGroupIds, setCollapsedSearchGroupIds] = useState<Set<string>>(new Set());
  const [expandedSearchGroupIds, setExpandedSearchGroupIds] = useState<Set<string>>(new Set());
  const { tree, setTree, busy, status, setStatus, activeSourceArg, loadTree } = useSkillTreeState({
    sourceArg,
    targetCwd,
  });
  const {
    visibleNodeIds,
    visibleRows,
    forcedExpandedNodeIds,
    selectedSkills,
    activeRow,
    activeNode,
    previewEntries,
    getRowIndexForQuery,
  } = useVisibleSkillRows({
    tree,
    query,
    cursorIndex,
    searchExpandedOverrides: {
      collapsedGroupIds: collapsedSearchGroupIds,
      expandedGroupIds: expandedSearchGroupIds,
    },
  });

  useLayoutEffect(() => {
    if (visibleRows.length === 0) {
      setCursorIndex(0);
      return;
    }

    setCursorIndex((currentIndex) => clamp(currentIndex, 0, visibleRows.length - 1));
  }, [visibleRows]);
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
    stdoutColumns: terminalSize.columns,
    stdoutRows: terminalSize.rows,
    searchMode,
    query,
    status,
    activeSourceArg,
    cursorIndex,
    visibleRowsCount: visibleRows.length,
    visibleRows,
  });

  const clearSearch = useCallback((): void => {
    if (tree && activeRow) {
      const restoredIndex = getRowIndexForQuery(activeRow.id, "");
      if (restoredIndex >= 0) {
        setCursorIndex(restoredIndex);
      }
    }

    setQuery("");
    setSearchInput("");
    setSearchMode(false);
    setCollapsedSearchGroupIds(new Set());
    setExpandedSearchGroupIds(new Set());
    setStatus("Search cleared.");
  }, [tree, activeRow, getRowIndexForQuery, setStatus]);

  const moveCursor = useCallback(
    (delta: number): void => {
      if (visibleRows.length === 0) {
        return;
      }

      setCursorIndex((currentIndex) => {
        const nextIndex = currentIndex + delta;
        return Math.max(0, Math.min(visibleRows.length - 1, nextIndex));
      });
    },
    [visibleRows.length],
  );

  const moveCursorToBoundary = useCallback(
    (boundary: "start" | "end"): void => {
      if (visibleRows.length === 0) {
        return;
      }

      setCursorIndex(boundary === "start" ? 0 : visibleRows.length - 1);
    },
    [visibleRows.length],
  );

  const collapseAtCursor = useCallback((): void => {
    if (!tree || !activeNode) {
      return;
    }

    if (
      activeNode.kind === "group" &&
      (activeNode.expanded || forcedExpandedNodeIds?.has(activeNode.id))
    ) {
      setTree(setExpanded(tree, activeNode.id, false));
      if (query.trim().length > 0) {
        setCollapsedSearchGroupIds((current) => {
          const next = new Set(current);
          next.add(activeNode.id);
          return next;
        });
        setExpandedSearchGroupIds((current) => {
          const next = new Set(current);
          next.delete(activeNode.id);
          return next;
        });
      }
      return;
    }

    if (activeNode.kind !== "group") {
      if (!activeNode.parentId) {
        return;
      }

      const parentVisibleIndex = visibleRows.findIndex((row) => row.id === activeNode.parentId);
      if (parentVisibleIndex >= 0) {
        setCursorIndex(parentVisibleIndex);
      }
      return;
    }

    const siblingParentId = activeNode.parentId;
    const siblingGroupIndexes = visibleRows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        const node = tree.nodes[row.id];
        return node?.kind === "group" && node.parentId === siblingParentId;
      });
    const previousGroup = [...siblingGroupIndexes]
      .reverse()
      .find(({ index }) => index < cursorIndex);

    if (previousGroup) {
      setCursorIndex(previousGroup.index);
      return;
    }
    if (!activeNode.parentId) {
      return;
    }
    const parentVisibleIndex = visibleRows.findIndex((row) => row.id === activeNode.parentId);

    if (parentVisibleIndex >= 0) {
      setCursorIndex(parentVisibleIndex);
    }
  }, [tree, activeNode, visibleRows, cursorIndex, query, forcedExpandedNodeIds, setTree]);

  const expandAtCursor = useCallback((): void => {
    if (!tree || !activeNode) {
      moveCursor(1);
      return;
    }
    if (activeNode.kind !== "group") {
      moveCursor(1);
      return;
    }
    const nextTree = setExpanded(tree, activeNode.id, true);
    setTree(nextTree);

    const firstChildId = activeNode.childIds[0];
    if (!firstChildId) {
      return;
    }
    const nextVisibleNodeIds = filterTreeBySkillName(nextTree, query);
    const nextForcedExpandedNodeIds =
      query.trim().length > 0 ? new Set(forcedExpandedNodeIds).add(activeNode.id) : undefined;
    const nextVisibleRows = flattenVisibleTree(nextTree, nextVisibleNodeIds, nextForcedExpandedNodeIds);
    const childIndex = nextVisibleRows.findIndex((row) => row.id === firstChildId);

    if (childIndex >= 0) {
      setCursorIndex(childIndex);
    }
    if (query.trim().length > 0) {
      setExpandedSearchGroupIds((current) => new Set(current).add(activeNode.id));
      setCollapsedSearchGroupIds((current) => {
        const next = new Set(current);
        next.delete(activeNode.id);
        return next;
      });
    }
  }, [tree, activeNode, query, moveCursor, forcedExpandedNodeIds, setTree]);

  const toggleAtCursor = useCallback((): void => {
    if (!tree || !activeNode) {
      return;
    }
    const visibleScope = query.trim().length > 0 ? visibleNodeIds : undefined;

    setTree(toggleSelection(tree, activeNode.id, visibleScope));
  }, [tree, activeNode, query, visibleNodeIds, setTree]);

  const collapseAll = useCallback((): void => {
    if (!tree) {
      return;
    }

    setTree(setAllExpanded(tree, false));
    if (query.trim().length > 0) {
      setCollapsedSearchGroupIds(new Set(forcedExpandedNodeIds ?? []));
      setExpandedSearchGroupIds(new Set());
    } else {
      setCollapsedSearchGroupIds(new Set());
      setExpandedSearchGroupIds(new Set());
    }
    setCursorIndex(0);
  }, [tree, query, forcedExpandedNodeIds, setTree]);

  const expandAll = useCallback((): void => {
    if (!tree) {
      return;
    }

    setTree(setAllExpanded(tree, true));
    if (query.trim().length > 0) {
      setCollapsedSearchGroupIds(new Set());
      setExpandedSearchGroupIds(new Set());
    }
  }, [tree, query, setTree]);

  const confirmInstall = useCallback((): void => {
    if (!tree) {
      setStatus("No skill tree loaded.");
      return;
    }
    const chosen = selectedSkills.map((skill) => skill.name);

    if (chosen.length === 0) {
      setStatus("Empty selection. Choose at least one skill before install.");
      return;
    }
    exit({
      kind: "install",
      selectedSkillNames: chosen,
      sourceArg: activeSourceArg,
    } satisfies AppExitResult);
  }, [tree, selectedSkills, activeSourceArg, exit, setStatus]);

  const handleInput = useAppInputHandler({
    searchMode,
    searchInput,
    query,
    showHelp,
    busy,
    hasTree: tree !== null,
    clearSearch,
    hideHelp: () => setShowHelp(false),
    setSearchMode,
    setSearchInput,
    setQuery,
    setShowHelp,
    setStatus,
    quit: () => exit({ kind: "quit" } satisfies AppExitResult),
    refresh: () => {
      void loadTree("refresh");
    },
    moveCursor,
    moveCursorToBoundary,
    pageJumpSize: Math.max(1, visibleListRows.length),
    confirmInstall,
    toggleAtCursor,
    collapseAtCursor,
    expandAtCursor,
    collapseAll,
    expandAll,
  });

  useInput((input, key) => {
    handleInput(input, key);
  });

  const selectedCount = useMemo(() => selectedSkills.length, [selectedSkills]);
  let searchBar: React.ReactNode = null;

  if (searchMode) {
    searchBar = <SearchBar searchInput={searchInput} />;
  }

  return (
    <AppLayout
      details={<DetailsPanel activeNode={activeNode} previewEntries={previewEntries} />}
      footer={
        <StatusFooter
          footerSourceText={footerSourceText}
          footerStatusMaxLength={footerStatusMaxLength}
          footerStatusText={footerStatusText}
          query={query}
          shortcuts={visibleFooterShortcuts}
          showFooterSource={showFooterSource}
          status={status}
        />
      }
      mainHeight={mainHeight}
      searchBar={searchBar}
      shortcuts={<ShortcutsPanel showHelp={showHelp} />}
      sidebar={
        <SkillTreePanel
          busy={busy}
          cursorIndex={cursorIndex}
          listWindowStart={listWindowStart}
          selectedCount={selectedCount}
          tree={tree}
          visibleListRows={visibleListRows}
        />
      }
      sidebarWidth={sidebarWidth}
      stdoutHeight={stdoutHeight}
      stdoutWidth={stdoutWidth}
    />
  );
}
