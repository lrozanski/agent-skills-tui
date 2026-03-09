# Agent Skills TUI (TypeScript)

Terminal UI for browsing and installing skills from a local or remote source repository.

## Requirements

- Node.js 20+
- pnpm
- `git` (for remote sources)
- `npx` (for install handoff)

## Usage

```bash
pnpm install
pnpm dev -- <source>
```

Examples:

```bash
pnpm dev -- ./path/to/skills-repo
pnpm dev -- owner/repo
pnpm dev -- https://github.com/owner/repo.git
```

## Keybindings

- `up` / `down`: move
- `pgup` / `pgdn`: jump by one visible page
- `home` / `end`: jump to the first or last visible row
- `left` / `h`: collapse
- `right` / `l`: expand
- `[` / `]`: collapse or expand all groups
- `space`: toggle selection
- `enter`: install selected skills
- `/`: search mode
- `r`: refresh
- `q`: quit

## Quality checks

```bash
pnpm typecheck
pnpm test
pnpm check
```
