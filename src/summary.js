const MAX_INTENT_CHARS = 2400;
const MAX_TOOL_NAMES = 32;

function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  if (value.content !== undefined) return textOf(value.content);
  return "";
}

function isImage(value) {
  if (!value || typeof value !== "object") return false;
  const type = String(value.type ?? "").toLowerCase();
  return type.includes("image") || value.image_url !== undefined || value.source?.media_type?.startsWith("image/");
}

function walk(value, visit) {
  if (Array.isArray(value)) return value.forEach((item) => walk(item, visit));
  if (!value || typeof value !== "object") return;
  visit(value);
  Object.values(value).forEach((item) => walk(item, visit));
}

export function summarizeRequest(request = {}) {
  const messages = Array.isArray(request.messages)
    ? request.messages
    : Array.isArray(request.input)
      ? request.input
      : [];
  const userMessages = messages.filter((message) => message?.role === "user");
  const latestUser = userMessages.at(-1) ?? messages.at(-1);
  const userIntent = textOf(latestUser?.content ?? latestUser).slice(0, MAX_INTENT_CHARS);
  const toolNames = [];
  let hasImages = false;
  walk(request, (value) => {
    if (isImage(value)) hasImages = true;
    if (typeof value.name === "string" && (value.type === "function" || value.type === "custom" || value.parameters)) {
      if (!toolNames.includes(value.name)) toolNames.push(value.name);
    }
  });
  const tools = Array.isArray(request.tools) ? request.tools : [];
  for (const tool of tools) {
    const name = tool?.function?.name ?? tool?.name;
    if (name && !toolNames.includes(name)) toolNames.push(name);
  }
  return {
    userIntent,
    messageCount: messages.length,
    estimatedInputTokens: Math.ceil(JSON.stringify(request).length / 4),
    hasTools: tools.length > 0 || toolNames.length > 0,
    toolNames: toolNames.slice(0, MAX_TOOL_NAMES),
    hasImages,
    originalModel: request.model,
    sessionId: request.session_id ?? request.sessionId
  };
}
