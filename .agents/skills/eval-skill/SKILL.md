---
name: eval-skill
description: >-
  Evaluate a Codex skill by running it against a test scenario and checking
  behavior against its own Completion Criteria and Critical Rules. Use for
  requests like: "eval skill commit", "eval skill commit --scenario 'commit my
  changes'", and "eval skill commit --runs 3". Trigger phrases: eval skill;
  test skill; review skill behavior; check skill; debug skill.
license: Apache-2.0
compatibility: Requires the Codex CLI with `codex exec --json` and Node 24+.
allowed-tools: Read Bash(node:*) Bash(codex exec:*) Bash(bash .agents/skills/eval-skill/scripts/*:*)
---

# Eval Skill

## Purpose

Evaluate a Codex skill by running a realistic test scenario in a non-interactive
Codex subprocess, normalizing the resulting JSONL event stream, and judging the
observed behavior against the skill's own specification.

## Inputs

Expected invocation pattern in the user message:

`eval skill <skill-name> [--scenario "<user message>"] [--runs N] [--eval-profile <standard|runtime-full>]`

Parameters:

- `skill-name` (required): the target skill to evaluate
- `--scenario` (optional): the exact user request to test
- `--runs` (optional): the number of runs to perform; default `1`
- `--eval-profile` (optional): evaluator runtime profile override. Supported values:
  - `standard`: sandboxed local evaluation for file-oriented skills
  - `runtime-full`: full-runtime evaluation for skills that need network access, app launch, port binding, MCP sessions, or process cleanup

If `--scenario` is omitted, derive one from the target skill's Purpose and
Inputs sections. If `skill-name` is missing, ask the user for it.

If `--eval-profile` is omitted, resolve it from a repo-local evaluator mapping
for known runtime-heavy skills; otherwise default to `standard`.

## Critical Rules

- Parse the requested `skill-name`, `--scenario`, and `--runs` from the user's
  message before starting the evaluator
- Prefer a repo-local skill at `.agents/skills/<name>/SKILL.md` before falling
  back to `$CODEX_HOME/skills/<name>/SKILL.md`
- Clear stale artifacts from `.agents/.tmp/skill-eval/` before generating new
  evaluator outputs for the requested run
- Write evaluator artifacts under `.agents/.tmp/skill-eval/`
- Run the parser with Node's native TypeScript execution support
- Cite concrete step indexes when judging failures
- Preserve the full prompt text when invoking `codex exec`; do not let leading
  `---` front matter get parsed as CLI flags
- When evaluating inside a Git repo under `workspace-write`, grant
  `codex exec` explicit write access to the repo's `.git` directory
- Use `runtime-full` when the target skill launches apps, binds local ports,
  uses MCP driver sessions, requires network access, or manages long-running
  processes
- During evaluation, instruct the subprocess that it may directly create,
  modify, or delete files only inside the current repository. It must not
  directly target paths outside the repository, though side effects from repo
  commands or runtime tools are allowed
- When the evaluated skill spawns subagents, inject eval-only instructions that
  ask each subagent to write a repo-local execution log under
  `.agents/.tmp/skill-eval/`; use those logs to report full-session tools and
  commands without changing the standalone skill contract
- Treat the run as incomplete until the final Markdown report for each run has
  been fully written and then read back from disk
- Do not report success based only on intermediate artifacts such as a stream
  log, steps log, verification report, or the existence of a report path
- If the subprocess times out or the trace is incomplete, report that as a
  finding rather than hiding it

## Workflow

1. Parse the user request for the target skill, optional scenario override, and
   optional run count and eval-profile override.
1. Resolve the target skill path, preferring `.agents/skills/<name>/SKILL.md`
   inside the current repository.
1. Resolve the evaluation profile from the explicit override, the evaluator's
   repo-local skill mapping, or the `standard` default.
1. If no scenario was supplied, derive a minimal plausible one from the skill's
   Purpose and Inputs sections.
1. Clear `.agents/.tmp/skill-eval/` so the upcoming run starts from a clean
   artifact directory.
1. Run `bash .agents/skills/eval-skill/scripts/run-codex-skill-eval.sh ...`
   with the resolved inputs.
1. Ensure the subprocess prompt includes the repository-only direct file-write
   boundary before the target skill text.
1. When the evaluated skill uses subagents, collect the eval-only subagent log
   artifacts and aggregate them into a full-session tool/command manifest.
1. Wait until the final Markdown report file for each run exists and has
   non-empty contents. This step may take a long time because the judge model
   still has to finish writing the final report after the evaluated skill run is
   over.
1. Read the generated report or reports from `.agents/.tmp/skill-eval/` only
   after that non-empty report check passes.
1. Return the full generated Markdown report inline in the final user-facing
   response for each run, not just a summary or artifact path.
1. Add a short lead-in before the inline report that names the skill, the run
   result, and the report artifact path.

## Final User Response

Return, for each run:

1. A short lead-in naming the evaluated skill, overall outcome, and report path.
2. The full generated Markdown report inline, preserving its section headings
   and criterion-level PASS/FAIL/PARTIAL/NOT EXERCISED lines.

Do not replace the report with a paraphrased summary unless the user explicitly
asks for a shorter answer. The inline report is the default output.

## Completion Criteria

- The evaluator resolves the correct target skill file
- The evaluator resolves the intended evaluation profile
- The evaluator clears stale artifacts from `.agents/.tmp/skill-eval/` before
  writing new run outputs
- The run produces a criteria JSON artifact, a raw JSONL stream, a normalized
  steps log, and a Markdown report in `.agents/.tmp/skill-eval/`
- When subagents are used, the run also produces per-subagent eval logs and an
  aggregated full-session tool/command manifest in `.agents/.tmp/skill-eval/`
- The report evaluates completion criteria, critical rules, workflow adherence,
  observed tools and commands, failure points, and improvement suggestions
- The evaluator does not finish early; it waits for the final report to exist
  and have non-empty contents, even if that final report write takes a while,
  then reads that final report before responding
- The final user-facing response includes the full generated report inline for
  each run, not only the artifact path or a compressed summary
- When the user requests multiple runs, the evaluator produces separate
  artifacts per run
