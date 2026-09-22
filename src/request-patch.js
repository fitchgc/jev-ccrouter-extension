export function patchModel(body, model) {
  if (!body || typeof body !== "object" || !model) return body;
  return { ...body, model };
}

export function parseJsonBody(buffer) {
  try {
    return JSON.parse(Buffer.from(buffer).toString("utf8"));
  } catch {
    return undefined;
  }
}
