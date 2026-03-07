export type NodeKind = "group" | "skill";

export type SelectionState = "checked" | "unchecked" | "partial";

export interface SkillMeta {
  name: string;
  description: string;
}

export interface SymlinkMeta {
  isSymlink: boolean;
  realPath: string;
}

export interface SkillNode {
  id: string;
  kind: NodeKind;
  label: string;
  absPath: string;
  canonicalPath: string;
  parentId: string | null;
  childIds: string[];
  expanded: boolean;
  selection: SelectionState;
  skillMeta?: SkillMeta;
  symlinkMeta?: SymlinkMeta;
}

export interface SkillTree {
  rootId: string;
  nodes: Record<string, SkillNode>;
  warnings: string[];
}

export interface VisibleNode {
  id: string;
  depth: number;
}
