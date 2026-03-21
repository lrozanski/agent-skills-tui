# Skill Eval — Implementation Spec

A system for dynamically testing Claude skills against their own stated criteria, using a hook-based observer that runs silently alongside the skill under test.

---

## Overview

Static code review of skill files catches structural problems (vague criteria, contradictory rules, missing edge cases) but cannot verify runtime behavior. This system executes a skill in a subprocess under controlled conditions, observes every tool call in real time via hooks, and produces a report comparing actual behavior against the skill's own Completion Criteria and Critical Rules.

The outer eval session is never contaminated by the inner session's observations: a single `SKILL_DEBUG` environment variable gates all hook activity, and it is only set on the subprocess.

---

## Components

### 1. `/eval-skill` skill (`SKILL.md`)

The orchestrator. Reads and parses the target skill, launches the subprocess, then reads and presents the report written by the Stop hook.

**Frontmatter:**

```yaml
name: eval-skill
description: >-
  Evaluate a Claude skill by running it against a test scenario and checking
  its behavior against its own Completion Criteria and Critical Rules. Produces
  a structured report with pass/fail per criterion and concrete improvement
  suggestions. Trigger phrases: eval skill; test skill; review skill behavior;
  check skill; debug skill.
argument-hint: "<skill-name> [--scenario \"user message\"] [--runs N]"
allowed-tools: Read Glob Bash(cat:*) Bash(claude:*) Bash(date:*)
```

**Workflow:**

1. Locate the target skill file at `~/.claude/skills/<name>/SKILL.md`.
2. Read the skill file in full.
3. Extract structured sections: **Completion Criteria**, **Critical Rules**, **Workflow** steps, **allowed-tools**. Write these to `~/.claude/skill-eval/criteria.json`.
4. Determine the test scenario:
   - If `--scenario` was provided, use it verbatim.
   - Otherwise, derive a minimal plausible scenario from the skill's Purpose and Inputs sections. Prefer a scenario that exercises the most critical rules.
5. Determine run count (default 1, or `--runs N`). Multiple runs detect non-determinism.
6. For each run, execute the subprocess (see section 2). Wait for completion.
7. Read `~/.claude/skill-eval/report-<skill>-<timestamp>.md`.
8. If `--runs N` was > 1, read all report files and note any behavioral differences across runs.
9. Present the report to the user, highlighting unmet criteria and top improvement suggestions.

### 2. Subprocess invocation

The eval skill launches the inner session via the Bash tool:

```bash
SKILL_DEBUG=1 claude \
  --output-format stream-json \
  --max-turns 50 \
  -p "$(cat /path/to/SKILL.md)

User request: <scenario>" \
  2>&1 | tee ~/.claude/skill-eval/stream-<timestamp>.jsonl
```

**Key parameters:**

| Parameter | Value | Reason |
|---|---|---|
| `SKILL_DEBUG=1` | env var prefix | Gates hook activity; inner hooks fire, outer hooks skip |
| `--output-format stream-json` | format | Emits every tool call and response as newline-delimited JSON, not just the final message |
| `--max-turns 50` | turn cap | Prevents runaway orchestrator skills from blocking indefinitely |
| `2>&1` | stderr merge | Captures hook errors and Claude warnings together |
| `tee` | dual output | Writes to file for hook analysis while also making output visible to the Bash tool |

**Bash tool timeout:** Set `timeout: 600000` (10 minutes) on this call. Orchestrator skills routinely spawn sub-agents, run tests, or perform multi-step code generation and can easily exceed the default 2-minute limit. 10 minutes is the max the Bash tool supports.

If the subprocess exceeds 10 minutes, the eval skill should note the timeout as a finding (the skill may have no turn limit or is calling expensive tools without bounds).

### 3. `PostToolUse` hook script (`skill-eval-post-tool.sh`)

Fires after every tool call in any Claude session. Exits immediately if `SKILL_DEBUG` is not set.

```bash
#!/bin/bash
set -euo pipefail

# Exit immediately if not in an eval session
[ -z "${SKILL_DEBUG:-}" ] && exit 0

LOG_DIR="$HOME/.claude/skill-eval"
STEPS_FILE="$LOG_DIR/steps.jsonl"

mkdir -p "$LOG_DIR"

# PostToolUse hook receives the tool call context on stdin as JSON:
# { "tool_name": "...", "tool_input": {...}, "tool_response": "..." }
STEP=$(cat)
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "{\"timestamp\":\"$TIMESTAMP\",\"step\":$STEP}" >> "$STEPS_FILE"
```

The hook appends one JSON line per tool call. No Claude subprocess is spawned here — logging is cheap and fast to avoid adding latency to each step.

**Settings.json configuration** (`.claude/settings.json` in the project root, committed to the repository):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/skill-eval-post-tool.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/skill-eval-stop.sh"
          }
        ]
      }
    ]
  }
}
```

The hooks live in `.claude/hooks/` in the repository and are committed alongside the skill. The `SKILL_DEBUG` gate ensures they are inert in normal sessions — the only overhead is bash process startup (~5–20ms per tool call), which is negligible in practice. If this becomes a concern, switch the shebang to `#!/bin/sh`; the early-exit logic is POSIX-compatible.

### 4. `Stop` hook script (`skill-eval-stop.sh`)

Fires when the inner Claude session ends. Reads the accumulated steps log and the extracted criteria, then calls `claude` once to produce the evaluation report.

```bash
#!/bin/bash
set -euo pipefail

[ -z "${SKILL_DEBUG:-}" ] && exit 0

LOG_DIR="$HOME/.claude/skill-eval"
STEPS_FILE="$LOG_DIR/steps.jsonl"
CRITERIA_FILE="$LOG_DIR/criteria.json"

# Both files must exist for analysis to proceed
[ -f "$STEPS_FILE" ] || exit 0
[ -f "$CRITERIA_FILE" ] || exit 0

SKILL_NAME=$(jq -r '.skill_name' "$CRITERIA_FILE")
TIMESTAMP=$(date -u +%Y%m%dT%H%M%S)
REPORT_FILE="$LOG_DIR/report-${SKILL_NAME}-${TIMESTAMP}.md"

# Run the analysis agent once against the full log
claude -p "
You are evaluating whether a Claude skill behaved correctly during a test run.

## Skill criteria (from SKILL.md)
$(cat "$CRITERIA_FILE")

## Observed tool calls (chronological)
$(cat "$STEPS_FILE")

## Your task
Produce a structured evaluation report in Markdown with these sections:

### Summary
One paragraph: did the skill complete its stated purpose?

### Completion Criteria
For each criterion listed in the criteria file, mark it as:
- PASS — behavior clearly satisfied it
- FAIL — behavior clearly violated it
- PARTIAL — partially satisfied or ambiguous
- NOT EXERCISED — the test scenario did not trigger this criterion

For FAIL and PARTIAL, quote the specific tool call(s) that show the problem.

### Critical Rules
Same pass/fail/not-exercised breakdown for each Critical Rule.

### Workflow Adherence
Did the steps execute in the documented order? Note any skipped or reordered steps.

### Tool Usage
Were all tool calls within the allowed-tools list? Note any unauthorized tool use.

### Failure Points
List specific moments in the steps log where the skill deviated from its specification, with the step index and what should have happened instead.

### Improvement Suggestions
Concrete, targeted edits to the SKILL.md text that would prevent each failure point. Quote the current text and propose replacement text.

### Skill Structure
Evaluate whether the skill's scope is appropriate. Flag if any of these apply:

- **Should split:** the skill has two or more distinct purposes that each have their own coherent Completion Criteria and could be invoked independently. Propose where the boundary should be and what each resulting skill's purpose would be.
- **Orchestrator boundary is wrong:** the skill orchestrates sub-tasks but one or more sub-tasks is complex enough to warrant its own SKILL.md with explicit criteria. Name the sub-task and describe what its criteria would look like.
- **Nested orchestrator redundancy:** if this skill is itself called by a parent orchestrator, check whether responsibilities overlap. Note any criteria that are duplicated or contradicted between levels.
- **Should merge:** the skill is too narrow and only makes sense as part of a larger workflow. This is rare but worth flagging.

Only suggest structural changes when the evidence from the run supports it — do not speculate.

### CLAUDE.md Suggestions
Only include this section if skill-file edits alone cannot fix the problem — for example, when the model repeatedly ignores an explicit rule in the skill file, or when the desired behavior is a universal default that all skills should inherit.

For each suggestion:
- State the proposed addition (one or two short lines, not a workflow)
- Explain why the skill file cannot enforce this on its own
- Flag any category of skill that might need the opposite behavior, so the author can check for conflicts before applying

Do not suggest adding skill-specific workflow steps to CLAUDE.md. CLAUDE.md is a global signal and must only contain behavioral defaults that are safe for every session.
" --output-format text > "$REPORT_FILE"

# Clean up step log so the next run starts fresh
rm -f "$STEPS_FILE"

echo "skill-eval: report written to $REPORT_FILE"
```

---

## File layout

```text
<project-root>/
  .claude/
    settings.json               # hook configuration (committed)
    hooks/
      skill-eval-post-tool.sh   # PostToolUse hook (committed)
      skill-eval-stop.sh        # Stop hook (committed)

~/.claude/
  skill-eval/
    criteria.json               # written by eval skill before subprocess launch
    steps.jsonl                 # written by PostToolUse hook during inner session
    stream-<timestamp>.jsonl    # raw stream-json output from inner session
    report-<skill>-<ts>.md      # final report written by Stop hook
```

---

## Environment variable reference

| Variable | Set by | Read by | Purpose |
|---|---|---|---|
| `SKILL_DEBUG` | eval skill (subprocess prefix) | both hook scripts | master gate; hooks are inert without it |

No other env vars are needed. The hooks derive all context from files in `~/.claude/skill-eval/`.

---

## Scenarios and edge cases

### Orchestrator skills (multi-agent, slow)

Set `--max-turns 50` on the subprocess and `timeout: 600000` on the Bash tool call. If the run times out, the report should note this as a finding: the skill lacks explicit turn or time bounds.

### Non-determinism detection

Run with `--runs 3`. The eval skill reads all three report files at the end and notes any criterion that flips between PASS and FAIL across runs. This is a strong signal of underspecified behavior in the skill.

### Skills that require user interaction

Some skills prompt the user mid-run. In non-interactive subprocess mode (`-p`), these will stall or produce unexpected behavior. The eval skill should detect a `Stop` with no final tool completion and flag this as a finding: the skill may be over-relying on user clarification rather than documenting required inputs.

### Hook recursion

The Stop hook spawns `claude -p` for analysis. This inner-inner claude session does NOT have `SKILL_DEBUG=1` (it is not prefixed), so its own hooks will exit immediately. No recursion.

---

## Static pre-flight check (optional fast path)

Before running the subprocess, the eval skill can perform a quick static analysis pass on the SKILL.md:

- Are all Completion Criteria measurable (avoid words like "appropriate", "reasonable", "correct" without a definition)?
- Does every Workflow step map to at least one Completion Criterion?
- Are there Critical Rules with no corresponding Completion Criterion to verify them?
- Does `allowed-tools` cover all tools used in the Workflow steps?

This takes one LLM call with no subprocess and catches structural problems instantly. Present static findings before the dynamic run, not after.

---

## Installation steps (when implementing)

1. Write `.claude/hooks/skill-eval-post-tool.sh` and `skill-eval-stop.sh`. Make both executable (`chmod +x`) and commit them.
2. Add the `PostToolUse` and `Stop` hook entries to `.claude/settings.json` in the project root (use the `/update-config` skill or edit manually) and commit it.
3. Write the `eval-skill` SKILL.md into your skills directory.
4. Run `/eval-skill commit --scenario "commit my changes"` as a smoke test against a known-good skill.
