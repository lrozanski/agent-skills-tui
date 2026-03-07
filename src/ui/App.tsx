import { Box, type Key, Text, useApp, useInput, useStdout } from "ink";
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { filterTreeBySkillName } from "../domain/search.js";
import {
  flattenVisibleTree,
  getSelectedSkills,
  setExpanded,
  toggleSelection,
} from "../domain/tree.js";
import type { SkillTree } from "../domain/types.js";
import { discoverSkills } from "../services/discovery.js";
import { resolveSource, syncSource } from "../services/source.js";

const SIDEBAR_WIDTH = 46;
const COLORS = {
  shell: "#171925",
  panel: "#20263d",
  panelMuted: "#101422",
  panelHelp: "#171c2d",
  accent: "#f3d38b",
  accentSoft: "#6c7086",
  text: "#c7cee5",
  muted: "#8890ad",
  footerText: "#8890ad",
  footerAccent: "#f3d38b",
  footerSeparator: "#6c7086",
  group: "#89adcb",
  skill: "#b8d0b0",
  success: "#a6da95",
  warning: "#f2cdcd",
  danger: "#ed8796",
  selectionGroup: "#30465c",
  selectionSkill: "#314337",
  selectionError: "#4b2932",
} as const;

export interface AppExitResult {
  kind: "quit" | "install";
  selectedSkillNames?: string[];
  sourceArg?: string;
}

interface AppProps {
  sourceArg: string;
  targetCwd: string;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function rowPrefix(isCursor: boolean): string {
  return isCursor ? "›" : " ";
}

function selectionMark(selection: "checked" | "unchecked" | "partial"): string {
  if (selection === "checked") {
    return "[x]";
  }

  if (selection === "partial") {
    return "[-]";
  }

  return "[ ]";
}

function nodeIcon(node: SkillTree["nodes"][string]): string {
  if (node.kind === "group") {
    return node.expanded ? "-" : "+";
  }

  return "";
}

function getStatusColor(status: string): string {
  const lower = status.toLowerCase();
  if (lower.includes("failed") || lower.includes("error")) {
    return COLORS.danger;
  }

  if (lower.includes("search") || lower.includes("loading") || lower.includes("refresh")) {
    return COLORS.warning;
  }

  if (lower.includes("loaded")) {
    return COLORS.success;
  }

  return COLORS.muted;
}

function ShortcutKey({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Text color={COLORS.footerAccent}>{children}</Text>;
}

function ShortcutHint({ label, action }: { label: string; action: string }): React.JSX.Element {
  return (
    <Text color={COLORS.footerText}>
      <ShortcutKey>{label}</ShortcutKey> {action}
    </Text>
  );
}

function getSelectionBackground(node: SkillTree["nodes"][string]): string {
  if (node.errorMessage) {
    return COLORS.selectionError;
  }

  return node.kind === "group" ? COLORS.selectionGroup : COLORS.selectionSkill;
}

function formatFrontmatterKey(key: string): string {
  return key
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatFrontmatterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatFrontmatterValue(item)).join(", ");
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function normalizeFrontmatterValue(value: unknown): string {
  return formatFrontmatterValue(value).trim();
}

export function App({ sourceArg, targetCwd }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [tree, setTree] = useState<SkillTree | null>(null);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [status, setStatus] = useState("Loading source...");
  const [busy, setBusy] = useState(true);
  const [activeSourceArg, setActiveSourceArg] = useState(sourceArg);
  const pendingCursorNodeIdRef = useRef<string | null>(null);

  const loadTree = useCallback(
    async (mode: "initial" | "refresh") => {
      setBusy(true);
      setStatus(mode === "initial" ? "Loading source..." : "Refreshing source...");

      try {
        const resolved = await resolveSource(sourceArg, targetCwd);
        const synced = await syncSource(resolved, mode);
        const discovered = await discoverSkills(synced.localPath);

        setTree(discovered);
        setCursorIndex(0);
        setActiveSourceArg(resolved.originalSourceArg);
        if (discovered.warnings.length > 0) {
          setStatus(
            `${mode === "initial" ? "Source loaded" : "Source refreshed"} with ${discovered.warnings.length} warning${discovered.warnings.length === 1 ? "" : "s"}.`,
          );
        } else {
          setStatus(mode === "initial" ? "Source loaded." : "Source refreshed.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(message);
        setTree((currentTree) => currentTree);
      } finally {
        setBusy(false);
      }
    },
    [sourceArg, targetCwd],
  );

  useEffect(() => {
    void loadTree("initial");
  }, [loadTree]);

  const visibleNodeIds = useMemo(() => {
    if (!tree) {
      return new Set<string>();
    }

    return filterTreeBySkillName(tree, query);
  }, [tree, query]);

  const visibleRows = useMemo(() => {
    if (!tree) {
      return [];
    }

    return flattenVisibleTree(tree, visibleNodeIds, query.trim().length > 0);
  }, [tree, visibleNodeIds, query]);

  useLayoutEffect(() => {
    if (visibleRows.length === 0) {
      setCursorIndex(0);
      return;
    }

    const pendingCursorNodeId = pendingCursorNodeIdRef.current;
    if (pendingCursorNodeId) {
      const restoredIndex = visibleRows.findIndex((row) => row.id === pendingCursorNodeId);
      pendingCursorNodeIdRef.current = null;
      if (restoredIndex >= 0) {
        setCursorIndex(restoredIndex);
        return;
      }
    }

    setCursorIndex((currentIndex) => Math.max(0, Math.min(currentIndex, visibleRows.length - 1)));
  }, [visibleRows]);

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

  const clearSearch = useCallback((): void => {
    if (tree && activeRow) {
      const unfilteredNodeIds = filterTreeBySkillName(tree, "");
      const unfilteredRows = flattenVisibleTree(tree, unfilteredNodeIds, false);
      const restoredIndex = unfilteredRows.findIndex((row) => row.id === activeRow.id);

      pendingCursorNodeIdRef.current = null;
      if (restoredIndex >= 0) {
        setCursorIndex(restoredIndex);
      }
    }

    setQuery("");
    setSearchInput("");
    setSearchMode(false);
    setStatus("Search cleared.");
  }, [tree, activeRow]);

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

  const collapseAtCursor = useCallback((): void => {
    if (!tree || !activeNode) {
      return;
    }

    if (activeNode.kind === "group" && activeNode.expanded) {
      setTree(setExpanded(tree, activeNode.id, false));
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
  }, [tree, activeNode, visibleRows, cursorIndex]);

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

    const nextRows = flattenVisibleTree(nextTree, visibleNodeIds, query.trim().length > 0);
    const childIndex = nextRows.findIndex((row) => row.id === firstChildId);
    if (childIndex >= 0) {
      setCursorIndex(childIndex);
    }
  }, [tree, activeNode, visibleNodeIds, query, moveCursor]);

  const toggleAtCursor = useCallback((): void => {
    if (!tree || !activeNode) {
      return;
    }

    const visibleScope = query.trim().length > 0 ? visibleNodeIds : undefined;
    setTree(toggleSelection(tree, activeNode.id, visibleScope));
  }, [tree, activeNode, query, visibleNodeIds]);

  const confirmInstall = useCallback((): void => {
    if (!tree) {
      setStatus("No skill tree loaded.");
      return;
    }

    const chosen = getSelectedSkills(tree).map((skill) => skill.name);
    if (chosen.length === 0) {
      setStatus("Empty selection. Choose at least one skill before install.");
      return;
    }

    exit({
      kind: "install",
      selectedSkillNames: chosen,
      sourceArg: activeSourceArg,
    } satisfies AppExitResult);
  }, [tree, activeSourceArg, exit]);

  const handleInput = useCallback(
    (input: string, key: Key) => {
      if (searchMode) {
        if (key.escape) {
          clearSearch();
          setShowHelp(false);
          return;
        }

        if (key.return) {
          setSearchMode(false);
          setStatus(searchInput ? `Search active: "${searchInput}"` : "Search cleared.");
          return;
        }

        if (key.backspace || key.delete) {
          setSearchInput((current) => {
            const next = current.slice(0, -1);
            setQuery(next);
            return next;
          });
          return;
        }

        if (!key.ctrl && !key.meta && input.length > 0) {
          setSearchInput((current) => {
            const next = `${current}${input}`;
            setQuery(next);
            return next;
          });
        }

        return;
      }

      if (input === "q") {
        exit({ kind: "quit" } satisfies AppExitResult);
        return;
      }

      if (key.escape && (query.length > 0 || searchInput.length > 0)) {
        clearSearch();
        return;
      }

      if (input === "f") {
        setSearchMode(true);
        setSearchInput(query);
        setShowHelp(false);
        setStatus("Search mode active.");
        return;
      }

      if (input === "?") {
        setShowHelp((current) => !current);
        setStatus(showHelp ? "Shortcuts hidden." : "Shortcuts visible.");
        return;
      }

      if (input === "r") {
        if (!busy) {
          void loadTree("refresh");
        }
        return;
      }

      if (!tree || busy) {
        return;
      }

      if (key.upArrow) {
        moveCursor(-1);
        return;
      }

      if (key.downArrow) {
        moveCursor(1);
        return;
      }

      if (key.return) {
        confirmInstall();
        return;
      }

      if (input === " ") {
        toggleAtCursor();
        return;
      }

      if (key.leftArrow || input === "h") {
        collapseAtCursor();
        return;
      }

      if (key.rightArrow || input === "l") {
        expandAtCursor();
      }
    },
    [
      searchMode,
      searchInput,
      query,
      exit,
      busy,
      tree,
      loadTree,
      moveCursor,
      confirmInstall,
      toggleAtCursor,
      collapseAtCursor,
      expandAtCursor,
      showHelp,
      clearSearch,
    ],
  );

  useInput((input, key) => {
    handleInput(input, key);
  });

  const stdoutWidth = stdout.columns ?? 80;
  const stdoutHeight = stdout.rows ?? 24;
  const sidebarWidth = clamp(SIDEBAR_WIDTH, 30, Math.max(30, stdoutWidth - 24));
  const headerHeight = 1;
  const footerHeight = (searchMode ? 1 : 0) + 1;
  const mainHeight = Math.max(8, stdoutHeight - headerHeight - footerHeight);
  const sidebarChromeHeight = 5;
  const listViewportSize = Math.max(1, mainHeight - sidebarChromeHeight);
  const listWindowStart = clamp(
    cursorIndex - Math.floor(listViewportSize / 2),
    0,
    Math.max(0, visibleRows.length - listViewportSize),
  );
  const visibleListRows = visibleRows.slice(listWindowStart, listWindowStart + listViewportSize);
  return (
    <Box
      backgroundColor={COLORS.shell}
      flexDirection="column"
      height={stdoutHeight}
      width={stdoutWidth}
    >
      <Box backgroundColor={COLORS.panel} flexDirection="row" paddingX={1} paddingY={0}>
        <Box flexBasis={0} flexGrow={1} />
        <Box alignItems="center" flexBasis={0} flexGrow={1} justifyContent="center">
          <Text bold color={COLORS.accent}>
            Agent Skills TUI
          </Text>
        </Box>
        <Box alignItems="flex-end" flexBasis={0} flexGrow={1}>
          <Text color={COLORS.muted} wrap="truncate-start">
            {truncateText(`Source: ${activeSourceArg}`, Math.max(24, Math.floor(stdoutWidth / 3)))}
          </Text>
        </Box>
      </Box>

      <Box
        backgroundColor={COLORS.shell}
        flexDirection="row"
        height={mainHeight}
        width={stdoutWidth}
      >
        <Box
          backgroundColor={COLORS.panelMuted}
          flexBasis={sidebarWidth}
          flexDirection="column"
          flexGrow={0}
          flexShrink={0}
          height={mainHeight}
          width={sidebarWidth}
        >
          <Box
            backgroundColor={COLORS.panelHelp}
            flexDirection="column"
            flexGrow={1}
            marginLeft={1}
            marginY={1}
            paddingY={0}
          >
            <Box backgroundColor={COLORS.panel} justifyContent="space-between" paddingX={1}>
              <Text bold color={COLORS.accent}>
                Skills
              </Text>
              <Text color={COLORS.muted}>{selectedSkills.length} selected</Text>
            </Box>

            <Box flexDirection="column" paddingX={1} paddingY={1}>
              {tree === null ? (
                <Text color={COLORS.muted}>
                  {busy
                    ? "Loading skill tree..."
                    : "No skills available. Press r to retry or q to quit."}
                </Text>
              ) : visibleRows.length === 0 ? (
                <Text color={COLORS.muted}>No matching skills.</Text>
              ) : (
                visibleListRows.map((row, rowIndex) => {
                  const actualRowIndex = listWindowStart + rowIndex;
                  const node = tree.nodes[row.id];
                  const isActive = actualRowIndex === cursorIndex;
                  const rowColor =
                    node.kind === "group"
                      ? COLORS.group
                      : node.errorMessage
                        ? COLORS.danger
                        : COLORS.skill;
                  const activeBackground = getSelectionBackground(node);
                  const activeTextColor = node.errorMessage
                    ? COLORS.danger
                    : node.kind === "group"
                      ? COLORS.group
                      : COLORS.skill;
                  const mark = selectionMark(node.selection);
                  const indent = "  ".repeat(row.depth);
                  const icon = nodeIcon(node);
                  const skillLabel =
                    node.kind === "skill" && node.skillMeta ? node.skillMeta.name : node.label;
                  const isSplitSkillRow = !isActive && node.kind === "skill";
                  const contentBackground = isActive
                    ? activeBackground
                    : node.kind === "skill"
                      ? COLORS.panelMuted
                      : COLORS.panelHelp;
                  const prefixBackground = isActive ? activeBackground : COLORS.panelHelp;
                  const checkboxColor = node.errorMessage ? COLORS.danger : rowColor;

                  return (
                    <Box key={row.id}>
                      <Box backgroundColor={prefixBackground} width={2}>
                        <Text color={isActive ? activeTextColor : COLORS.muted}>
                          {`${rowPrefix(isActive)} `}
                        </Text>
                      </Box>
                      <Box backgroundColor={contentBackground} flexGrow={1}>
                        <Text color={isActive ? activeTextColor : COLORS.muted}>{indent}</Text>
                        {node.kind === "group" ? (
                          <Text
                            color={isActive ? activeTextColor : COLORS.group}
                          >{`${icon} `}</Text>
                        ) : isSplitSkillRow ? (
                          <Text color={COLORS.panelMuted}> </Text>
                        ) : (
                          <Text color={isActive ? activeTextColor : COLORS.muted}> </Text>
                        )}
                        <Text color={isActive ? activeTextColor : checkboxColor}>
                          {node.errorMessage ? "[!] " : `${mark} `}
                        </Text>
                        <Text
                          bold={node.kind === "group"}
                          color={isActive ? activeTextColor : rowColor}
                          wrap="truncate-end"
                        >
                          {skillLabel}
                        </Text>
                      </Box>
                    </Box>
                  );
                })
              )}
            </Box>
          </Box>
        </Box>

        <Box
          backgroundColor={COLORS.panelMuted}
          flexDirection="column"
          flexGrow={1}
          flexShrink={1}
          height={mainHeight}
          justifyContent="space-between"
          overflow="hidden"
        >
          <Box
            backgroundColor={COLORS.panelHelp}
            flexDirection="column"
            flexShrink={1}
            marginX={1}
            marginY={1}
            paddingX={1}
            paddingY={0}
          >
            <Box backgroundColor={COLORS.panel} justifyContent="center" marginX={-1} paddingX={1}>
              <Text bold color={COLORS.accent}>
                Details
              </Text>
            </Box>
            <Box flexDirection="column" paddingY={1}>
              {activeNode?.kind === "skill" ? (
                activeNode.errorMessage ? (
                  <Text color={COLORS.danger}>{activeNode.errorMessage}</Text>
                ) : previewEntries.length > 0 ? (
                  previewEntries.map(([key, value]) => (
                    <Text key={key} color={COLORS.footerText}>
                      <Text color={COLORS.footerAccent}>{formatFrontmatterKey(key)}:</Text>{" "}
                      {normalizeFrontmatterValue(value)}
                    </Text>
                  ))
                ) : (
                  <Text color={COLORS.footerText}>(No frontmatter fields)</Text>
                )
              ) : (
                <Text color={COLORS.footerText}>Move to a skill to preview its details.</Text>
              )}
            </Box>
          </Box>
          {showHelp ? (
            <Box
              backgroundColor={COLORS.panelHelp}
              flexDirection="column"
              marginX={1}
              marginBottom={1}
              overflow="hidden"
              paddingX={1}
              paddingY={0}
            >
              <Box backgroundColor={COLORS.panel} justifyContent="center" marginX={-1} paddingX={1}>
                <Text bold color={COLORS.accent}>
                  Keyboard Shortcuts
                </Text>
              </Box>
              <Box
                columnGap={2}
                flexDirection="row"
                flexWrap="wrap"
                justifyContent="space-between"
                overflow="hidden"
              >
                <Box overflow="hidden" paddingRight={2}>
                  <ShortcutHint label="up/down" action="move cursor" />
                </Box>
                <Box overflow="hidden" paddingRight={2}>
                  <ShortcutHint label="left/right" action="collapse/expand" />
                </Box>
                <Box overflow="hidden" paddingRight={2}>
                  <ShortcutHint label="space" action="toggle" />
                </Box>
                <Box overflow="hidden" paddingRight={2}>
                  <ShortcutHint label="f" action="search" />
                </Box>
                <Box overflow="hidden" paddingRight={2}>
                  <ShortcutHint label="r" action="refresh" />
                </Box>
                <Box overflow="hidden" paddingRight={2}>
                  <ShortcutHint label="enter" action="install" />
                </Box>
                <Box overflow="hidden" paddingRight={2}>
                  <ShortcutHint label="q" action="quit" />
                </Box>
                <Box overflow="hidden">
                  <ShortcutHint label="?" action="toggle shortcuts" />
                </Box>
              </Box>
            </Box>
          ) : null}
        </Box>
      </Box>

      {searchMode ? (
        <Box
          backgroundColor={COLORS.panelHelp}
          justifyContent="space-between"
          paddingX={1}
          paddingY={0}
        >
          <Text>
            <Text bold color={COLORS.accent}>
              Search
            </Text>
            <Text color={COLORS.footerSeparator}>: </Text>
            <Text color={COLORS.text}>{searchInput}</Text>
            <Text color={COLORS.footerSeparator}>_</Text>
          </Text>
          <Text color={COLORS.footerText}>
            <ShortcutKey>enter</ShortcutKey> apply <Text color={COLORS.footerSeparator}>·</Text>{" "}
            <ShortcutKey>esc</ShortcutKey> clear
          </Text>
        </Box>
      ) : null}

      <Box backgroundColor={COLORS.panel} justifyContent="space-between" paddingX={1} paddingY={0}>
        <Box flexDirection="row">
          <ShortcutHint label="space" action="toggle" />
          <Text color={COLORS.footerSeparator}> · </Text>
          <ShortcutHint label="f" action="search" />
          <Text color={COLORS.footerSeparator}> · </Text>
          <ShortcutHint label="r" action="refresh" />
          <Text color={COLORS.footerSeparator}> · </Text>
          <ShortcutHint label="enter" action="install" />
          <Text color={COLORS.footerSeparator}> · </Text>
          <ShortcutHint label="q" action="quit" />
          <Text color={COLORS.footerSeparator}> · </Text>
          <ShortcutHint label="?" action="shortcuts" />
        </Box>
        <Text color={query ? COLORS.warning : getStatusColor(status)}>
          {truncateText(query ? `filter: ${query}` : status, 28)}
        </Text>
      </Box>
    </Box>
  );
}
