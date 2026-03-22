---
name: markdown-lint
description: Lint and format Markdown changes with rumdl. Use when creating or editing .md files in this repository, especially before finalizing a task that touched documentation, prompts, skills, or configuration docs.
---

# Markdown Lint

Run Markdown quality checks after any Markdown edit.

## Workflow

1. Identify the Markdown files changed in the current task, or explicitly confirm the user-designated Markdown file(s) when the scope is already provided.
2. Run `rumdl fmt` on the confirmed Markdown file list.
3. Fix remaining formatter-reported issues manually in the affected files, including cases where the formatter identifies a fix but cannot write it automatically.
4. Re-run `rumdl fmt` until no relevant violations remain.
5. Mention any unresolved lint constraints in the final handoff if they cannot be fixed safely.

## Command Pattern

- Format: `rumdl fmt <path ...>`

## Manual Fix Guidance

- Preserve author intent while fixing style issues.
- Prefer minimal edits that satisfy lint rules.
- Avoid unnecessary wording changes when fixing structure/format problems.

## Guardrails

- Run formatter before manual fixes.
- Treat formatter output as the primary verification signal; extra checks are optional but must not replace it.
