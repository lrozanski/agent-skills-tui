export interface FooterShortcut {
  label: string;
  action: string;
}

export const SIDEBAR_WIDTH = 46;

export const FOOTER_SHORTCUTS: FooterShortcut[] = [
  { label: "space", action: "toggle" },
  { label: "/", action: "search" },
  { label: "r", action: "refresh" },
  { label: "enter", action: "install" },
  { label: "q", action: "quit" },
];

export const HELP_SHORTCUT: FooterShortcut = { label: "?", action: "shortcuts" };
