export interface NormalizedSkillEvalStep {
  index: number;
  timestamp?: string;
  kind: string;
  sourceEventType: string;
  turnIndex?: number;
  itemId?: string;
  itemType?: string;
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutputSummary?: string;
  usage?: Record<string, unknown>;
  error?: string;
  raw: unknown;
}

interface JsonRecord {
  [key: string]: unknown;
}

export function normalizeCodexSkillEvalStream(stream: string): NormalizedSkillEvalStep[] {
  const lines = stream
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.startsWith("{"));

  const steps: NormalizedSkillEvalStep[] = [];
  let turnIndex = -1;

  for (const line of lines) {
    let parsed: JsonRecord;
    try {
      parsed = JSON.parse(line) as JsonRecord;
    } catch {
      continue;
    }

    const sourceEventType = typeof parsed.type === "string" ? parsed.type : "unknown";
    if (sourceEventType === "turn.started") {
      turnIndex += 1;
    }

    steps.push(normalizeEvent(parsed, steps.length, turnIndex));
  }

  return steps;
}

function normalizeEvent(
  parsed: JsonRecord,
  index: number,
  turnIndex: number,
): NormalizedSkillEvalStep {
  const sourceEventType = typeof parsed.type === "string" ? parsed.type : "unknown";
  const timestamp = getOptionalString(parsed.timestamp);

  if (sourceEventType === "thread.started") {
    return {
      index,
      timestamp,
      kind: "thread_started",
      sourceEventType,
      raw: parsed,
    };
  }

  if (sourceEventType === "turn.started") {
    return {
      index,
      timestamp,
      kind: "turn_started",
      sourceEventType,
      turnIndex,
      raw: parsed,
    };
  }

  if (sourceEventType === "turn.completed") {
    return {
      index,
      timestamp,
      kind: "turn_completed",
      sourceEventType,
      turnIndex,
      usage: isRecord(parsed.usage) ? parsed.usage : undefined,
      raw: parsed,
    };
  }

  if (sourceEventType === "error") {
    return {
      index,
      timestamp,
      kind: "error",
      sourceEventType,
      turnIndex: turnIndex >= 0 ? turnIndex : undefined,
      error: getOptionalString(parsed.message) ?? summarizeValue(parsed),
      raw: parsed,
    };
  }

  if (sourceEventType === "item.completed" && isRecord(parsed.item)) {
    return normalizeCompletedItem(parsed.item, parsed, index, turnIndex, timestamp);
  }

  return {
    index,
    timestamp,
    kind: "event",
    sourceEventType,
    turnIndex: turnIndex >= 0 ? turnIndex : undefined,
    raw: parsed,
  };
}

function normalizeCompletedItem(
  item: JsonRecord,
  raw: JsonRecord,
  index: number,
  turnIndex: number,
  timestamp?: string,
): NormalizedSkillEvalStep {
  const itemType = getOptionalString(item.type) ?? "unknown";
  const itemId = getOptionalString(item.id);
  const base: NormalizedSkillEvalStep = {
    index,
    timestamp,
    kind: "item",
    sourceEventType: "item.completed",
    turnIndex: turnIndex >= 0 ? turnIndex : undefined,
    itemId,
    itemType,
    raw,
  };

  if (itemType === "agent_message") {
    return {
      ...base,
      kind: "agent_message",
      text: extractItemText(item),
    };
  }

  const toolName =
    getOptionalString(item.tool_name) ??
    getOptionalString(item.name) ??
    getOptionalString(item.toolName) ??
    getOptionalString(item.call_id);
  const toolInput = item.arguments ?? item.input ?? item.tool_input;
  const toolOutput = item.output ?? item.result ?? item.tool_output ?? item.response;
  const looksLikeToolItem =
    itemType.includes("tool") ||
    toolName !== undefined ||
    toolInput !== undefined ||
    toolOutput !== undefined;

  if (looksLikeToolItem) {
    return {
      ...base,
      kind: "tool_call",
      toolName,
      toolInput,
      toolOutputSummary: summarizeValue(toolOutput),
      text: extractItemText(item),
    };
  }

  return {
    ...base,
    kind: `item_${sanitizeKindSuffix(itemType)}`,
    text: extractItemText(item),
  };
}

function extractItemText(item: JsonRecord): string | undefined {
  const directText = getOptionalString(item.text);
  if (directText) {
    return directText;
  }

  const content = item.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts = content.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const text = getOptionalString(entry.text) ?? getOptionalString(entry.value);
    return text ? [text] : [];
  });

  return parts.length > 0 ? parts.join("\n") : undefined;
}

function summarizeValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return truncate(value);
  }

  try {
    return truncate(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function truncate(value: string, maxLength = 240): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function sanitizeKindSuffix(value: string): string {
  return value.replace(/[^a-z0-9]+/giu, "_").replace(/^_+|_+$/gu, "") || "unknown";
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
