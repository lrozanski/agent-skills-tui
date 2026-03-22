# Skill Eval for Codex — Implementation Spec

A Codex-native system for dynamically testing skills against their own stated criteria by running a skill-oriented prompt in a non-interactive Codex subprocess, capturing its JSONL event stream, and judging the observed behavior against the skill specification.

---

## Overview

Static review of a skill file can catch vague criteria, contradictory instructions, and missing edge cases, but it cannot verify runtime behavior. This system executes a skill-oriented prompt in a Codex subprocess under controlled conditions, records the full JSONL event stream, normalizes that stream into an analysis-friendly step log, and then produces a report comparing actual behavior against the skill's own Completion Criteria and Critical Rules.

The implementation does not rely on runtime hooks such as `PostToolUse` or `Stop`. The outer evaluator owns the entire run lifecycle:

1. Read and parse the target skill.
2. Launch `codex exec --json` for the test run.
3. Convert raw Codex events into a normalized chronological step log.
4. Run a judge prompt over the criteria plus the normalized trace.
5. Present a structured Markdown report.

This keeps the runtime model simple, avoids hook recursion, and makes the evaluator reproducible in local scripts and CI.

---

## Components

### 1. `/eval-skill` skill (`SKILL.md`)

The orchestrator. Reads and parses the target skill, determines a scenario, launches the Codex subprocess, invokes the parser and judge steps, then reads and presents the final report.

**Frontmatter:**

```yaml
name: eval-skill
description: >-
  Evaluate a Codex skill by running it against a test scenario and checking
  its behavior against its own Completion Criteria and Critical Rules. Produces
  a structured report with pass/fail per criterion and concrete improvement
  suggestions. Use for requests like: "eval skill commit", "eval skill commit
  --scenario 'commit my changes'", and "eval skill commit --runs 3". Trigger
  phrases: eval skill; test skill; review skill behavior; check skill; debug
  skill.
```

Codex skills should not rely on structured `argument-hint` frontmatter. Instead, the skill should document its expected invocation pattern in the description and parse arguments directly from the user's request text.

Tool access will depend on how the skill is implemented in this repository, but the evaluator needs enough capability to:

- Read the target `SKILL.md`
- Execute `codex exec`
- Run a local parser script
- Read generated artifacts

**Inputs:**

Expected invocation pattern in the user message:

`eval skill <skill-name> [--scenario "<user message>"] [--runs N]`

Parameters:

- `skill-name` (required): target skill to evaluate
- `--scenario` (optional): exact user request to test
- `--runs` (optional): number of runs; default `1`

If `--scenario` is omitted, derive one from the skill's Purpose and Inputs sections. If `--runs` is omitted, default to `1`. If `skill-name` is missing, ask for it.

**Workflow:**

1. Parse the user message for:
   - target skill name
   - optional `--scenario`
   - optional `--runs`
2. Apply defaults for any optional inputs not provided.
3. Locate the target skill file.
   - For repo-local skills, prefer a repository path such as `.agents/skills/<name>/SKILL.md`.
   - For user-installed skills, support a configurable external path such as `$CODEX_HOME/skills/<name>/SKILL.md`.
4. Read the skill file in full.
5. Extract structured sections:
   - `Completion Criteria`
   - `Critical Rules`
   - `Workflow`
   - tool constraints such as `allowed-tools`, if present
6. Write these into a machine-readable file such as `.agents/.tmp/skill-eval/criteria-<skill>-<timestamp>.json`.
7. Determine the test scenario:
   - If `--scenario` was provided, use it verbatim.
   - Otherwise, derive a minimal plausible scenario from the skill's Purpose and Inputs sections.
   - Prefer a scenario that exercises the most important rules with the fewest moving parts.
8. Determine run count.
   - Default to `1`
   - Support `--runs N` to detect non-determinism
9. For each run:
   - Launch the subprocess described in section 2
   - Normalize the raw JSONL stream into a step log as described in section 3
   - Judge the run as described in section 4
10. If `--runs N` is greater than `1`, compare the per-run reports and note behavioral differences.
11. Present the report to the user, highlighting unmet criteria and the most valuable improvement suggestions.

### 2. Codex subprocess invocation

The evaluator launches the inner run via `codex exec --json` and captures stdout to a JSONL artifact.

```bash
codex exec \
  --json \
  --skip-git-repo-check \
  --sandbox workspace-write \
  --cd "$PROJECT_ROOT" \
  "$(cat "$TARGET_SKILL")

User request: $SCENARIO" \
  > "$LOG_DIR/stream-$TIMESTAMP.jsonl"
```

If the evaluator wants the inner run to be more constrained, it may also set:

- `--sandbox read-only` for purely analytical skills
- `--sandbox workspace-write` for implementation skills
- a profile or config override when a skill depends on a specific model or execution policy

**Key parameters:**

| Parameter | Value | Reason |
|---|---|---|
| `codex exec` | non-interactive subprocess | Runs the skill evaluation target in an isolated inner session |
| `--json` | structured event stream | Emits machine-readable events that can be parsed deterministically |
| `--cd "$PROJECT_ROOT"` | working root | Keeps the run anchored to the expected repo |
| `--sandbox ...` | explicit sandbox choice | Keeps test conditions stable across runs |
| stdout redirect | JSONL capture | Persists the full trace for later parsing and debugging |

The exact Codex event schema may evolve over time. The evaluator should therefore treat the raw JSONL as an external protocol and normalize it into its own stable internal step format before analysis.

**Timeout guidance:**

Long-running orchestrator skills can reasonably take several minutes. The outer shell command that launches `codex exec` should use a generous timeout such as 10 minutes. If the run times out, the evaluator should record that as a finding rather than silently failing.

### 3. Trace normalization script

The implementation uses a parser step that converts the raw event stream into a stable chronological log of meaningful steps.

Suggested implementation:

- `.agents/skills/eval-skill/scripts/parse-codex-skill-eval.ts`
- Input: `stream-<timestamp>.jsonl`
- Output: `steps-<timestamp>.jsonl`

Run the parser with Node 24's native TypeScript execution support, for example:

```bash
node .agents/skills/eval-skill/scripts/parse-codex-skill-eval.ts \
  "$LOG_DIR/stream-$TIMESTAMP.jsonl" \
  > "$LOG_DIR/steps-$TIMESTAMP.jsonl"
```

Each normalized step should include as much of the following as is available:

- timestamp
- event index
- event type
- tool name
- tool input
- tool output summary
- assistant message fragments
- error details
- turn boundaries

Example normalized output line:

```json
{
  "index": 12,
  "timestamp": "2026-03-22T10:24:36Z",
  "kind": "tool_call",
  "tool_name": "functions.exec_command",
  "tool_input": {
    "cmd": "rg -n \"TODO\" ."
  },
  "tool_output_summary": "Command exited with code 0"
}
```

The parser should be deliberately conservative:

- Preserve unknown event types in a generic form instead of dropping them
- Never assume a single event name is permanent unless validated by tests
- Prefer a best-effort log over a brittle schema-specific parser

This parser layer is the main compatibility boundary between Codex runtime behavior and the evaluator.

### 4. Judge step

After normalization, the evaluator runs a second Codex invocation that reads the criteria file plus the normalized steps log and writes a Markdown report.

```bash
codex exec \
  --skip-git-repo-check \
  --sandbox read-only \
  "$(cat "$JUDGE_PROMPT_FILE")" \
  > "$LOG_DIR/report-$SKILL-$TIMESTAMP.md"
```

The judge prompt should include:

- the parsed criteria JSON
- the normalized step log
- the expected report format
- instructions to avoid speculation when evidence is missing

Suggested judge prompt:

```text
You are evaluating whether a Codex skill behaved correctly during a test run.

## Skill criteria
<criteria json here>

## Observed steps
<normalized steps jsonl here>

## Your task
Produce a structured evaluation report in Markdown with these sections:

### Summary
One paragraph: did the skill complete its stated purpose?

### Completion Criteria
For each criterion listed in the criteria file, mark it as:
- PASS
- FAIL
- PARTIAL
- NOT EXERCISED

For FAIL and PARTIAL, cite the specific step index or indices that show the problem.

### Critical Rules
Same pass/fail/not-exercised breakdown for each Critical Rule.

### Workflow Adherence
Did the steps execute in the documented order? Note any skipped or reordered steps.

### Tool Usage
Were all tool calls within the skill's documented tool constraints? Note any unauthorized tool use or missing tool declarations.

### Failure Points
List specific moments in the step log where the skill deviated from its specification, with the step index and what should have happened instead.

### Improvement Suggestions
Concrete, targeted edits to the SKILL.md text that would prevent each failure point. Quote the current text and propose replacement text.

### Skill Structure
Evaluate whether the skill's scope is appropriate. Only suggest structural changes when the evidence from the run supports them.

### AGENTS.md Suggestions
Only include this section if skill-file edits alone cannot fix the problem and the missing behavior clearly belongs in repository-wide defaults.
```

The judge should cite normalized step indexes rather than raw event blobs so the report remains readable even when the underlying event schema changes.

---

## File layout

```text
<project-root>/
  specs/
    skill-eval-codex.md
  .agents/
    skills/
      eval-skill/
        SKILL.md
        scripts/
          parse-codex-skill-eval.ts    # normalize raw Codex JSONL into stable steps via `node`
          run-codex-skill-eval.sh      # optional convenience wrapper
          judge-codex-skill-eval.sh    # optional convenience wrapper
    .tmp/
      skill-eval/
        criteria-<skill>-<ts>.json
        stream-<skill>-<ts>.jsonl
        steps-<skill>-<ts>.jsonl
        report-<skill>-<ts>.md
```

If the repository prefers persistent evaluator artifacts outside the working tree, a user-scoped directory such as `~/.codex/skill-eval/` is also acceptable. Repo-local storage under `.agents/.tmp/` is usually easier for debugging and CI artifact collection without introducing a loose top-level temp directory.

---

## Environment and configuration

No special environment variable is required.

Recommended evaluator inputs:

| Input | Set by | Used by | Purpose |
|---|---|---|---|
| target skill path | eval skill | parser and judge stages | identifies the skill under test |
| scenario | eval skill or user | inner Codex run | defines the behavior being exercised |
| run count | eval skill or user | orchestrator | enables non-determinism detection |
| sandbox mode | evaluator config | inner Codex run | stabilizes runtime conditions |

If a future Codex feature introduces a stable event or trace export format that is better than `--json`, the evaluator should switch to that and keep the same normalized `steps.jsonl` contract.

---

## Scenarios and edge cases

### Orchestrator skills

Skills that delegate, run tests, or perform long code-edit cycles may take several minutes. The evaluator should set a generous timeout for the subprocess and surface timeouts as first-class findings.

### Non-determinism detection

Run with `--runs 3` and compare the resulting reports. Any criterion that flips between `PASS` and `FAIL`, or between `PASS` and `PARTIAL`, is a strong sign that the skill is underspecified or too dependent on unstated context.

### Skills that require user interaction

Some skills assume an interactive back-and-forth with the user. In non-interactive `codex exec` mode, these may stall, terminate early, or ask questions instead of proceeding. The evaluator should flag this explicitly as a finding: the skill may depend on clarification that should instead be encoded as required inputs, explicit assumptions, or a narrower trigger surface.

### Event schema drift

The raw JSONL event format may change between Codex versions. The parser should:

- preserve unrecognized events
- keep parser tests with representative fixtures
- fail loudly only when the stream is completely unusable

Schema drift is expected; that is why the evaluator owns a normalization layer.

### Nested evaluator runs

The judge itself may also be implemented with `codex exec`, but it should analyze normalized artifacts only. The judge should not recursively re-run the target skill unless explicitly requested, otherwise the evaluator becomes difficult to reason about and expensive to run.

---

## Static pre-flight check (optional fast path)

Before running the subprocess, the evaluator can perform a quick static analysis pass on the target `SKILL.md`:

- Are all Completion Criteria measurable?
- Does every Workflow step map to at least one Completion Criterion?
- Are there Critical Rules with no corresponding Completion Criterion?
- Do the documented tool constraints cover the tools implied by the Workflow?
- Does the skill appear to assume hidden repo-wide defaults that belong in `AGENTS.md` instead?

This should be presented as a pre-flight pass, not as a substitute for the dynamic run.

---

## Installation steps (when implementing)

1. Use this spec as the design reference for the evaluator.
2. Implement a parser script that converts `codex exec --json` output into a stable normalized step log.
3. Implement a small runner script that:
   - builds the prompt
   - launches the inner Codex run
   - stores raw artifacts
   - invokes the parser
   - invokes the judge
4. Implement the `/eval-skill` skill so users can run the flow ergonomically.
5. Add fixture-based tests for the parser using saved JSONL samples.
6. Smoke-test the evaluator against a known-good skill and a deliberately flawed skill.

---

## Design rationale

This design keeps trace capture, parsing, and judging in explicit scripts and artifacts. That tradeoff is worthwhile because it:

- reduces hidden runtime coupling
- makes the evaluation flow easier to debug
- gives CI a stable set of files to archive
- provides a single normalization point for future Codex event format changes
- keeps the skill focused on orchestration rather than low-level trace handling
