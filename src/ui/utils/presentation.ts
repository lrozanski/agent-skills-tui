import type { SkillNode, SkillTree } from "../../domain/types.js";
import type { FooterShortcut } from "../constants.js";
import type { AppTheme } from "../theme/theme.js";

export function rowPrefix(isCursor: boolean): string {
  return isCursor ? "›" : " ";
}

export function selectionMark(selection: SkillTree["nodes"][string]["selection"]): string {
  if (selection === "checked") {
    return "[x]";
  }
  if (selection === "partial") {
    return "[-]";
  }
  return "[ ]";
}

export function nodeIcon(node: SkillNode): string {
  if (node.kind === "group") {
    return node.expanded ? "-" : "+";
  }
  return "";
}

export function rowIndent(depth: number, node: SkillNode): string {
  const extraSkillPadding = node.kind === "skill" ? " " : "";
  return `${"  ".repeat(depth)}${extraSkillPadding}`;
}

export function getStatusColor(theme: AppTheme, status: string): string {
  const lower = status.toLowerCase();

  if (lower.includes("failed") || lower.includes("error")) {
    return theme.colors.danger;
  }
  if (lower.includes("search") || lower.includes("loading") || lower.includes("refresh")) {
    return theme.colors.warning;
  }
  if (lower.includes("loaded")) {
    return theme.colors.success;
  }
  return theme.colors.muted;
}

export function getSelectionBackground(theme: AppTheme, node: SkillNode): string {
  if (node.errorMessage) {
    return theme.colors.selectionError;
  }
  return node.kind === "group" ? theme.colors.selectionGroup : theme.colors.selectionSkill;
}

export function footerShortcutWidth(shortcut: FooterShortcut): number {
  return shortcut.label.length + 1 + shortcut.action.length;
}
