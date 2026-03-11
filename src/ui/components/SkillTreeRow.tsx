import { Box, Text } from "ink";

import type { SkillNode, VisibleNode } from "../../domain/types.js";
import { useTheme } from "../theme/ThemeProvider.js";
import {
  getSelectionBackground,
  nodeIcon,
  rowIndent,
  rowPrefix,
  selectionMark,
} from "../utils/presentation.js";

interface SkillTreeRowProps {
  row: VisibleNode;
  node: SkillNode;
  isActive: boolean;
}

export function SkillTreeRow({ row, node, isActive }: SkillTreeRowProps) {
  const theme = useTheme();
  let rowColor = theme.colors.skill;

  if (node.errorMessage) {
    rowColor = theme.colors.danger;
  } else if (node.kind === "group") {
    rowColor = theme.colors.group;
  }
  const activeBackground = getSelectionBackground(theme, node);
  let activeTextColor = theme.colors.skill;

  if (node.errorMessage) {
    activeTextColor = theme.colors.danger;
  } else if (node.kind === "group") {
    activeTextColor = theme.colors.group;
  }
  const mark = selectionMark(node.selection);
  const indent = rowIndent(row.depth, node);
  const icon = nodeIcon(node);
  let skillLabel = node.label;

  if (node.kind === "skill" && node.skillMeta) {
    skillLabel = node.skillMeta.name;
  }
  const isSplitSkillRow = !isActive && node.kind === "skill";
  let contentBackground = activeBackground;

  if (!isActive) {
    contentBackground = node.kind === "skill" ? theme.colors.panelMuted : theme.colors.panelHelp;
  }
  const prefixBackground = isActive ? activeBackground : theme.colors.panelHelp;
  const checkboxColor = node.errorMessage ? theme.colors.danger : rowColor;
  const defaultTextColor = isActive ? activeTextColor : theme.colors.muted;
  const groupIconColor = isActive ? activeTextColor : rowColor;
  const checkboxTextColor = isActive ? activeTextColor : checkboxColor;
  const labelTextColor = isActive ? activeTextColor : rowColor;
  let selectionText = `${mark} `;

  if (node.errorMessage) {
    selectionText = "[!] ";
  }
  let iconText = "  ";

  if (node.kind === "group") {
    iconText = `${icon} `;
  }

  return (
    <Box>
      <Box backgroundColor={prefixBackground} width={2}>
        <Text color={defaultTextColor}>{`${rowPrefix(isActive)} `}</Text>
      </Box>
      <Box backgroundColor={contentBackground} flexGrow={1}>
        <Box width={indent.length} flexGrow={0} flexShrink={0}>
          <Text color={defaultTextColor}>{indent}</Text>
        </Box>
        <Box width={2} flexGrow={0} flexShrink={0}>
          <Text
            color={
              node.kind === "group"
                ? groupIconColor
                : isSplitSkillRow
                  ? theme.colors.panelMuted
                  : defaultTextColor
            }
          >
            {iconText}
          </Text>
        </Box>
        <Box width={4} flexGrow={0} flexShrink={0}>
          <Text color={checkboxTextColor}>{selectionText}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Text bold={node.kind === "group"} color={labelTextColor} wrap="truncate-end">
            {skillLabel}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
