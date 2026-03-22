#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
LOG_DIR="$REPO_ROOT/.agents/.tmp/skill-eval"

SKILL_NAME=""
SKILL_PATH=""
SCENARIO=""
RUNS="1"
EVAL_PROFILE=""
INNER_SANDBOX="workspace-write"
JUDGE_SANDBOX="read-only"
TIMEOUT_SECONDS="600"

usage() {
  cat <<EOF >&2
Usage: run-codex-skill-eval.sh --skill <skill-name|skill-path> [--scenario <text>] [--runs <n>] [--eval-profile <standard|runtime-full>] [--sandbox <mode>] [--judge-sandbox <mode>] [--timeout-seconds <n>]
EOF
}

default_eval_profile_for_skill() {
  local skill_name="$1"

  case "$skill_name" in
    review-feature | launch-demo-mode | gather-feature-context | stop-demo-mode | verify-feature)
      printf '%s\n' "runtime-full"
      ;;
    *)
      printf '%s\n' "standard"
      ;;
  esac
}

resolve_skill_path() {
  local skill_ref="$1"

  if [[ -f "$skill_ref" ]]; then
    printf '%s\n' "$skill_ref"
    return 0
  fi

  if [[ -f "$REPO_ROOT/.agents/skills/$skill_ref/SKILL.md" ]]; then
    printf '%s\n' "$REPO_ROOT/.agents/skills/$skill_ref/SKILL.md"
    return 0
  fi

  if [[ -n "${CODEX_HOME:-}" && -f "$CODEX_HOME/skills/$skill_ref/SKILL.md" ]]; then
    printf '%s\n' "$CODEX_HOME/skills/$skill_ref/SKILL.md"
    return 0
  fi

  return 1
}

derive_scenario() {
  local skill_path="$1"
  local skill_name="$2"

  node "$SCRIPT_DIR/extract-skill-eval-criteria.ts" "$skill_path" | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      const parsed = JSON.parse(input);
      const candidates = [
        parsed.purpose,
        ...(Array.isArray(parsed.workflow) ? parsed.workflow : []),
        ...(Array.isArray(parsed.completion_criteria) ? parsed.completion_criteria : []),
      ].filter((value) => typeof value === "string" && value.trim().length > 0);

      if (candidates.length > 0) {
        process.stdout.write(candidates[0]);
        return;
      }

      process.stdout.write(`Please perform the core job of the ${process.argv[1]} skill.`);
    });
  ' "$skill_name"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skill)
      SKILL_NAME="${2:-}"
      shift 2
      ;;
    --skill-path)
      SKILL_PATH="${2:-}"
      shift 2
      ;;
    --scenario)
      SCENARIO="${2:-}"
      shift 2
      ;;
    --runs)
      RUNS="${2:-}"
      shift 2
      ;;
    --eval-profile)
      EVAL_PROFILE="${2:-}"
      shift 2
      ;;
    --sandbox)
      INNER_SANDBOX="${2:-}"
      shift 2
      ;;
    --judge-sandbox)
      JUDGE_SANDBOX="${2:-}"
      shift 2
      ;;
    --timeout-seconds)
      TIMEOUT_SECONDS="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$SKILL_NAME" && -z "$SKILL_PATH" ]]; then
  usage
  exit 1
fi

if [[ -z "$SKILL_PATH" ]]; then
  SKILL_PATH="$(resolve_skill_path "$SKILL_NAME")" || {
    echo "Unable to resolve skill: $SKILL_NAME" >&2
    exit 1
  }
fi

if [[ -z "$SKILL_NAME" ]]; then
  SKILL_NAME="$(basename "$(dirname "$SKILL_PATH")")"
fi

if [[ -z "$EVAL_PROFILE" ]]; then
  EVAL_PROFILE="$(default_eval_profile_for_skill "$SKILL_NAME")"
fi

case "$EVAL_PROFILE" in
  standard)
    INNER_SANDBOX="${INNER_SANDBOX:-workspace-write}"
    ;;
  runtime-full)
    INNER_SANDBOX="danger-full-access"
    ;;
  *)
    echo "Unknown eval profile: $EVAL_PROFILE" >&2
    exit 1
    ;;
esac

mkdir -p "$LOG_DIR"
find "$LOG_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

if [[ -z "$SCENARIO" ]]; then
  SCENARIO="$(derive_scenario "$SKILL_PATH" "$SKILL_NAME")"
fi

CRITERIA_TIMESTAMP="$(date -u +%Y%m%dT%H%M%S)"
CRITERIA_FILE="$LOG_DIR/criteria-$SKILL_NAME-$CRITERIA_TIMESTAMP.json"
node "$SCRIPT_DIR/extract-skill-eval-criteria.ts" "$SKILL_PATH" >"$CRITERIA_FILE"

CODEX_EXEC_EXTRA_ARGS=()
if [[ "$INNER_SANDBOX" == "workspace-write" ]] && [[ -d "$REPO_ROOT/.git" ]]; then
  CODEX_EXEC_EXTRA_ARGS+=(--add-dir "$REPO_ROOT/.git")
fi
if [[ "$EVAL_PROFILE" == "standard" ]]; then
  CODEX_EXEC_EXTRA_ARGS+=(--add-dir /tmp)
fi

CODEX_EXEC_MODE_ARGS=(--sandbox "$INNER_SANDBOX")

for ((run = 1; run <= RUNS; run += 1)); do
  mkdir -p "$LOG_DIR"

  TIMESTAMP="$(date -u +%Y%m%dT%H%M%S)"
  RUN_SUFFIX="$TIMESTAMP-run$run"
  STREAM_FILE="$LOG_DIR/stream-$SKILL_NAME-$RUN_SUFFIX.jsonl"
  STEPS_FILE="$LOG_DIR/steps-$SKILL_NAME-$RUN_SUFFIX.jsonl"
  REPORT_FILE="$LOG_DIR/report-$SKILL_NAME-$RUN_SUFFIX.md"
  SUBAGENT_LOG_DIR="$LOG_DIR/subagents-$SKILL_NAME-$RUN_SUFFIX"
  SUBAGENT_LOG_MANIFEST="$LOG_DIR/subagent-logs-$SKILL_NAME-$RUN_SUFFIX.json"

  mkdir -p "$SUBAGENT_LOG_DIR"
  PROMPT_FILE="$(mktemp)"

  cat >"$PROMPT_FILE" <<EOF
Evaluation Safety Boundary:
- You may directly create, modify, or delete files only inside this repository: $REPO_ROOT
- You may use /tmp for process-owned temporary files when a repo-local tool or runtime command requires it, but do not directly target non-repository paths for file creation, modification, or deletion
- Network access is allowed when needed by the scenario
- If a requested action would directly write outside the repository, refuse it and report the limitation unless it is only an indirect side effect of a repo-local command or runtime tool

Evaluation Subagent Logging Overlay:
- If you spawn any subagents during this evaluated run, include an evaluation-only logging instruction in each spawned subagent prompt.
- Each spawned subagent must write one JSON execution log file under: $SUBAGENT_LOG_DIR
- Use a stable filename such as <step-order>-<skill-or-task>.json
- Each JSON log file must include:
  - "skill_or_task": short task or skill name
  - "status": success, blocked, or failed
  - "tools_used": deduplicated array of tool names used by that subagent
  - "commands_used": deduplicated array of shell commands used by that subagent
  - "artifacts": array of relevant repo-local artifact paths
  - "final_message": the concise final result returned by that subagent
- These subagent log files are evaluation artifacts only. Do not let them change the normal user-facing outcome of the skill.
- If the skill does not spawn subagents, ignore this overlay.

$(cat "$SKILL_PATH")

User request: $SCENARIO
EOF

  if ! timeout "$TIMEOUT_SECONDS" \
    codex exec \
      --json \
      --skip-git-repo-check \
      --cd "$REPO_ROOT" \
      "${CODEX_EXEC_MODE_ARGS[@]}" \
      "${CODEX_EXEC_EXTRA_ARGS[@]}" \
      - \
      <"$PROMPT_FILE" \
      >"$STREAM_FILE"; then
    mkdir -p "$LOG_DIR"
    printf '%s\n' '{"type":"error","message":"codex exec timed out or failed"}' >>"$STREAM_FILE"
  fi

  mkdir -p "$LOG_DIR"
  node "$SCRIPT_DIR/parse-codex-skill-eval.ts" "$STREAM_FILE" >"$STEPS_FILE"

  mkdir -p "$LOG_DIR"
  node "$SCRIPT_DIR/collect-subagent-logs.ts" "$SUBAGENT_LOG_DIR" >"$SUBAGENT_LOG_MANIFEST"

  mkdir -p "$LOG_DIR"
  bash "$SCRIPT_DIR/judge-codex-skill-eval.sh" \
    "$CRITERIA_FILE" \
    "$STEPS_FILE" \
    "$REPORT_FILE" \
    --subagent-logs "$SUBAGENT_LOG_MANIFEST" \
    --sandbox "$JUDGE_SANDBOX"

  report_ready="false"
  for _ in {1..120}; do
    if [[ -s "$REPORT_FILE" ]]; then
      report_ready="true"
      break
    fi
    sleep 1
  done

  if [[ "$report_ready" != "true" ]]; then
    echo "Report was not written with contents: $REPORT_FILE" >&2
    exit 1
  fi

  rm -f "$PROMPT_FILE"
  printf 'report=%s\n' "$REPORT_FILE"
done
