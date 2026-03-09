import type { Key } from "ink";
import { useCallback } from "react";

interface UseAppInputHandlerParams {
  searchMode: boolean;
  searchInput: string;
  query: string;
  showHelp: boolean;
  busy: boolean;
  hasTree: boolean;
  clearSearch: () => void;
  hideHelp: () => void;
  setSearchMode: (enabled: boolean) => void;
  setSearchInput: (value: string | ((current: string) => string)) => void;
  setQuery: (value: string | ((current: string) => string)) => void;
  setShowHelp: (value: boolean | ((current: boolean) => boolean)) => void;
  setStatus: (value: string) => void;
  quit: () => void;
  refresh: () => void;
  moveCursor: (delta: number) => void;
  moveCursorToBoundary: (boundary: "start" | "end") => void;
  pageJumpSize: number;
  confirmInstall: () => void;
  toggleAtCursor: () => void;
  collapseAtCursor: () => void;
  expandAtCursor: () => void;
  collapseAll: () => void;
  expandAll: () => void;
}

interface SearchModeActions {
  clearSearch: () => void;
  hideHelp: () => void;
  setSearchMode: (enabled: boolean) => void;
  setSearchInput: (value: string | ((current: string) => string)) => void;
  setQuery: (value: string | ((current: string) => string)) => void;
  setStatus: (value: string) => void;
}

interface GlobalShortcutActions {
  clearSearch: () => void;
  setSearchMode: (enabled: boolean) => void;
  setSearchInput: (value: string) => void;
  setShowHelp: (value: boolean | ((current: boolean) => boolean)) => void;
  setStatus: (value: string) => void;
  quit: () => void;
  refresh: () => void;
}

interface TreeNavigationActions {
  moveCursor: (delta: number) => void;
  moveCursorToBoundary: (boundary: "start" | "end") => void;
  pageJumpSize: number;
  confirmInstall: () => void;
  toggleAtCursor: () => void;
  collapseAtCursor: () => void;
  expandAtCursor: () => void;
  collapseAll: () => void;
  expandAll: () => void;
}

function handleSearchModeInput(
  input: string,
  key: Key,
  searchInput: string,
  actions: SearchModeActions,
): boolean {
  if (key.escape) {
    actions.clearSearch();
    actions.hideHelp();
    return true;
  }

  if (key.return) {
    actions.setSearchMode(false);
    actions.setStatus(searchInput ? `Search active: "${searchInput}"` : "Search cleared.");
    return true;
  }

  if (key.backspace || key.delete) {
    actions.setSearchInput((current) => {
      const next = current.slice(0, -1);
      actions.setQuery(next);
      return next;
    });
    return true;
  }

  if (!key.ctrl && !key.meta && input.length > 0) {
    actions.setSearchInput((current) => {
      const next = `${current}${input}`;
      actions.setQuery(next);
      return next;
    });
    return true;
  }

  return true;
}

function handleGlobalShortcuts(
  input: string,
  key: Key,
  query: string,
  searchInput: string,
  showHelp: boolean,
  busy: boolean,
  actions: GlobalShortcutActions,
): boolean {
  if (input === "q") {
    actions.quit();
    return true;
  }

  if (key.escape && (query.length > 0 || searchInput.length > 0)) {
    actions.clearSearch();
    return true;
  }

  if (input === "/") {
    actions.setSearchMode(true);
    actions.setSearchInput(query);
    actions.setShowHelp(false);
    actions.setStatus("Search mode active.");
    return true;
  }

  if (input === "?") {
    actions.setShowHelp((current) => !current);
    actions.setStatus(showHelp ? "Shortcuts hidden." : "Shortcuts visible.");
    return true;
  }

  if (input === "r") {
    if (!busy) {
      actions.refresh();
    }
    return true;
  }

  return false;
}

export function handleTreeNavigationInput(
  input: string,
  key: Key,
  actions: TreeNavigationActions,
): boolean {
  if (key.upArrow) {
    actions.moveCursor(-1);
    return true;
  }

  if (key.downArrow) {
    actions.moveCursor(1);
    return true;
  }

  if (key.pageUp) {
    actions.moveCursor(-actions.pageJumpSize);
    return true;
  }

  if (key.pageDown) {
    actions.moveCursor(actions.pageJumpSize);
    return true;
  }

  if (key.home) {
    actions.moveCursorToBoundary("start");
    return true;
  }

  if (key.end) {
    actions.moveCursorToBoundary("end");
    return true;
  }

  if (key.return) {
    actions.confirmInstall();
    return true;
  }

  if (input === " ") {
    actions.toggleAtCursor();
    return true;
  }

  if (key.leftArrow || input === "h") {
    actions.collapseAtCursor();
    return true;
  }

  if (key.rightArrow || input === "l") {
    actions.expandAtCursor();
    return true;
  }

  if (input === "[") {
    actions.collapseAll();
    return true;
  }

  if (input === "]") {
    actions.expandAll();
    return true;
  }

  return false;
}

export function useAppInputHandler({
  searchMode,
  searchInput,
  query,
  showHelp,
  busy,
  hasTree,
  clearSearch,
  hideHelp,
  setSearchMode,
  setSearchInput,
  setQuery,
  setShowHelp,
  setStatus,
  quit,
  refresh,
  moveCursor,
  moveCursorToBoundary,
  pageJumpSize,
  confirmInstall,
  toggleAtCursor,
  collapseAtCursor,
  expandAtCursor,
  collapseAll,
  expandAll,
}: UseAppInputHandlerParams) {
  return useCallback(
    (input: string, key: Key) => {
      if (searchMode) {
        handleSearchModeInput(input, key, searchInput, {
          clearSearch,
          hideHelp,
          setSearchMode,
          setSearchInput,
          setQuery,
          setStatus,
        });
        return;
      }

      const handledGlobalShortcut = handleGlobalShortcuts(
        input,
        key,
        query,
        searchInput,
        showHelp,
        busy,
        {
          clearSearch,
          setSearchMode,
          setSearchInput: (value) => setSearchInput(value),
          setShowHelp,
          setStatus,
          quit,
          refresh,
        },
      );
      if (handledGlobalShortcut || !hasTree || busy) {
        return;
      }

      handleTreeNavigationInput(input, key, {
        moveCursor,
        moveCursorToBoundary,
        pageJumpSize,
        confirmInstall,
        toggleAtCursor,
        collapseAtCursor,
        expandAtCursor,
        collapseAll,
        expandAll,
      });
    },
    [
      searchMode,
      searchInput,
      query,
      showHelp,
      busy,
      hasTree,
      clearSearch,
      hideHelp,
      setSearchMode,
      setSearchInput,
      setQuery,
      setShowHelp,
      setStatus,
      quit,
      refresh,
      moveCursor,
      moveCursorToBoundary,
      pageJumpSize,
      confirmInstall,
      toggleAtCursor,
      collapseAtCursor,
      expandAtCursor,
      collapseAll,
      expandAll,
    ],
  );
}
