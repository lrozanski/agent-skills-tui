#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: judge-codex-skill-eval.sh <criteria-json> <steps-jsonl> <report-md> [--subagent-logs <json>] [--sandbox <mode>]" >&2
  exit 1
fi

CRITERIA_FILE="$1"
STEPS_FILE="$2"
REPORT_FILE="$3"
shift 3

SANDBOX_MODE="read-only"
SUBAGENT_LOGS_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --subagent-logs)
      SUBAGENT_LOGS_FILE="${2:-}"
      shift 2
      ;;
    --sandbox)
      SANDBOX_MODE="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

SUBAGENT_LOGS_CONTENT="null"
if [[ -n "$SUBAGENT_LOGS_FILE" && -f "$SUBAGENT_LOGS_FILE" ]]; then
  SUBAGENT_LOGS_CONTENT="$(cat "$SUBAGENT_LOGS_FILE")"
fi

PROMPT_FILE="$(mktemp)"
REPORT_TMP_FILE="$(mktemp)"
trap 'rm -f "$PROMPT_FILE" "$REPORT_TMP_FILE"' EXIT

cat >"$PROMPT_FILE" <<EOF
You are evaluating whether a Codex skill behaved correctly during a test run.

## Skill criteria
$(cat "$CRITERIA_FILE")

## Observed steps
$(cat "$STEPS_FILE")

## Subagent logs
$SUBAGENT_LOGS_CONTENT

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

### Required Outputs
For each required output listed in the criteria file, mark whether it was:
- PASS
- FAIL
- PARTIAL
- NOT EXERCISED

Judge based on whether the run actually produced or surfaced that output.

### Final User Response Requirements
For each final response requirement listed in the criteria file, mark whether the observed final user-facing response satisfied it:
- PASS
- FAIL
- PARTIAL
- NOT EXERCISED

For FAIL and PARTIAL, cite the specific step index or indices that show the problem.

### Critical Rules
Same pass/fail/not-exercised breakdown for each Critical Rule.

### Workflow Adherence
Did the steps execute in the documented order? Note any skipped or reordered steps.

### Observed Tools And Commands
Produce a deduplicated list of the tools and commands that were actually used during the run.
Prefer the full-session view from subagent logs when those logs are present.
If subagent logs are missing or incomplete, say so explicitly and fall back to the parent-thread-only evidence from the observed steps.
Group closely related usages when helpful, but stay concrete.
Call out any surprising or risky usage that seems inconsistent with the skill's written rules.

### Failure Points
List specific moments in the step log where the skill deviated from its specification, with the step index and what should have happened instead.

### Improvement Suggestions
Concrete, targeted edits to the SKILL.md text that would prevent each failure point. Quote the current text and propose replacement text.

### Skill Structure
Evaluate whether the skill's scope is appropriate. Only suggest structural changes when the evidence from the run supports them.

### AGENTS.md Suggestions
Only include this section if skill-file edits alone cannot fix the problem and the missing behavior clearly belongs in repository-wide defaults.

For conditional requirements that only apply when a condition occurs, such as "include blocker evidence for failed criteria",
mark them as NOT EXERCISED when the condition never occurred. Do not treat that as a defect by itself.

Do not speculate beyond the evidence in the criteria file and observed steps.
EOF

codex exec \
  --skip-git-repo-check \
  --sandbox "$SANDBOX_MODE" \
  - \
  <"$PROMPT_FILE" \
  >"$REPORT_TMP_FILE"

mv "$REPORT_TMP_FILE" "$REPORT_FILE"
