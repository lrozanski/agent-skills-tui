import { Box, type Key, Text, useApp, useInput, useStdout } from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

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

const SIDEBAR_WIDTH = 38;
const COLORS = {
  shell: "#16172b",
  panel: "#1d2140",
  panelAlt: "#22274a",
  panelMuted: "#1a1e39",
  accent: "#8be9fd",
  accentSoft: "#b8c0ff",
  text: "#cfd6f6",
  muted: "#8a90b9",
  group: "#8be9fd",
  skill: "#c7cdea",
  success: "#9fe870",
  warning: "#ffd479",
  danger: "#ff8c8c",
  selection: "#2f3a63",
  selectionText: "#dbe4ff",
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
  return <Text color={COLORS.warning}>{children}</Text>;
}

function ShortcutHint({ label, action }: { label: string; action: string }): React.JSX.Element {
  return (
    <Text color={COLORS.muted}>
      <ShortcutKey>{label}</ShortcutKey> {action}
    </Text>
  );
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

  useEffect(() => {
    if (visibleRows.length === 0) {
      setCursorIndex(0);
      return;
    }

    setCursorIndex((currentIndex) => Math.max(0, Math.min(currentIndex, visibleRows.length - 1)));
  }, [visibleRows.length]);

  const selectedSkills = useMemo(() => {
    if (!tree) {
      return [];
    }

    return getSelectedSkills(tree);
  }, [tree]);

  const activeRow = visibleRows[cursorIndex];
  const activeNode = tree && activeRow ? tree.nodes[activeRow.id] : undefined;
  const previewDescription =
    activeNode?.kind === "skill"
      ? activeNode.skillMeta?.description || "(No description)"
      : "Move to a skill to preview its description.";

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

    if (!activeNode.parentId) {
      return;
    }

    const parentVisibleIndex = visibleRows.findIndex((row) => row.id === activeNode.parentId);
    if (parentVisibleIndex >= 0) {
      setCursorIndex(parentVisibleIndex);
    }
  }, [tree, activeNode, visibleRows]);

  const expandAtCursor = useCallback((): void => {
    if (!tree || !activeNode || activeNode.kind !== "group") {
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
  }, [tree, activeNode, visibleNodeIds, query]);

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
          setQuery("");
          setSearchInput("");
          setSearchMode(false);
          setShowHelp(false);
          setStatus("Search cleared.");
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
    ],
  );

  useInput((input, key) => {
    handleInput(input, key);
  });

  const stdoutWidth = stdout.columns ?? 80;
  const stdoutHeight = stdout.rows ?? 24;
  const sidebarWidth = clamp(SIDEBAR_WIDTH, 30, Math.max(30, stdoutWidth - 24));
  const contentWidth = Math.max(24, stdoutWidth - sidebarWidth - 5);
  const previewLength = clamp(contentWidth * 6, 120, 420);
  const headerHeight = 3;
  const footerHeight = (searchMode ? 1 : 0) + 1;
  const mainHeight = Math.max(8, stdoutHeight - headerHeight - footerHeight);
  const previewBody = truncateText(previewDescription, previewLength);
  const listViewportSize = Math.max(1, mainHeight - 3);
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
      <Box
        backgroundColor={COLORS.panel}
        borderBottom
        borderBottomColor={COLORS.accentSoft}
        borderLeft={false}
        borderRight={false}
        borderStyle="single"
        borderTop={false}
        flexDirection="column"
        paddingX={1}
        paddingY={0}
      >
        <Box justifyContent="space-between">
          <Text bold color={COLORS.accent}>
            Agent Skills TUI
          </Text>
        </Box>
        <Text color={COLORS.muted}>
          {truncateText(`Source: ${activeSourceArg}`, Math.max(40, stdoutWidth - 10))}
        </Text>
      </Box>

      <Box
        backgroundColor={COLORS.shell}
        flexDirection="row"
        height={mainHeight}
        width={stdoutWidth}
      >
        <Box
          backgroundColor={COLORS.panelAlt}
          flexBasis={sidebarWidth}
          flexDirection="column"
          flexGrow={0}
          flexShrink={0}
          height={mainHeight}
          paddingX={1}
          paddingY={0}
          width={sidebarWidth}
        >
          <Box justifyContent="space-between">
            <Text bold color={COLORS.accentSoft}>
              Skills
            </Text>
            <Text color={COLORS.muted}>{selectedSkills.length} selected</Text>
          </Box>

          <Box flexDirection="column">
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
                const rowColor = node?.kind === "group" ? COLORS.group : COLORS.skill;
                const mark = selectionMark(node.selection);
                const prefix = `${rowPrefix(isActive)} ${"  ".repeat(row.depth)}`;
                const branch = node.kind === "group" ? (node.expanded ? "▾" : "▸") : "•";
                const skillLabel =
                  node.kind === "skill" && node.skillMeta ? node.skillMeta.name : node.label;

                return (
                  <Box key={row.id} backgroundColor={isActive ? COLORS.selection : COLORS.panelAlt}>
                    <Text color={isActive ? COLORS.selectionText : rowColor} wrap="truncate-end">
                      {prefix}
                    </Text>
                    <Text color={COLORS.muted}>{mark}</Text>
                    <Text color={isActive ? COLORS.selectionText : rowColor} wrap="truncate-end">
                      {` ${branch} ${skillLabel}`}
                    </Text>
                  </Box>
                );
              })
            )}
          </Box>
        </Box>

        <Box flexDirection="column" flexGrow={1} flexShrink={1} height={mainHeight}>
          <Box
            backgroundColor={COLORS.panelMuted}
            flexDirection="column"
            flexGrow={1}
            paddingX={1}
            paddingY={0}
          >
            <Text bold color={COLORS.warning}>
              Description
            </Text>
            <Text color={COLORS.text}>{previewBody}</Text>
            {showHelp ? (
              <Box flexDirection="column">
                <Text bold color={COLORS.warning}>
                  Keyboard Shortcuts
                </Text>
                <ShortcutHint label="up/down" action="move cursor" />
                <ShortcutHint label="left/right" action="collapse or expand groups" />
                <ShortcutHint label="space" action="toggle selection" />
                <ShortcutHint label="f" action="open search" />
                <ShortcutHint label="r" action="refresh source" />
                <ShortcutHint label="enter" action="install selected skills" />
                <ShortcutHint label="q" action="quit" />
                <ShortcutHint label="?" action="toggle shortcuts" />
              </Box>
            ) : null}
          </Box>
        </Box>
      </Box>

      {searchMode ? (
        <Box backgroundColor={COLORS.panel} paddingX={1} paddingY={0}>
          <Text color={COLORS.muted}>
            Search: {searchInput}| <ShortcutKey>enter</ShortcutKey> apply ·{" "}
            <ShortcutKey>esc</ShortcutKey> clear
          </Text>
        </Box>
      ) : null}

      <Box
        backgroundColor={COLORS.panelAlt}
        justifyContent="space-between"
        paddingX={1}
        paddingY={0}
      >
        <Box flexDirection="row">
          <ShortcutHint label="space" action="toggle" />
          <Text color={COLORS.muted}> · </Text>
          <ShortcutHint label="f" action="search" />
          <Text color={COLORS.muted}> · </Text>
          <ShortcutHint label="r" action="refresh" />
          <Text color={COLORS.muted}> · </Text>
          <ShortcutHint label="enter" action="install" />
          <Text color={COLORS.muted}> · </Text>
          <ShortcutHint label="q" action="quit" />
          <Text color={COLORS.muted}> · </Text>
          <ShortcutHint label="?" action="shortcuts" />
        </Box>
        <Text color={query ? COLORS.warning : getStatusColor(status)}>
          {truncateText(query ? `filter: ${query}` : status, 28)}
        </Text>
      </Box>
    </Box>
  );
}
