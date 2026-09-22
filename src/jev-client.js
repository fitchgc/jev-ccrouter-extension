const VALID_TIERS = new Set(["simple", "normal", "complex", "extreme"]);

export class JevError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "JevError";
    this.cause = cause;
  }
}

export class JevClient {
  constructor({ fetchImpl = globalThis.fetch, logger = console } = {}) {
    this.fetch = fetchImpl;
    this.logger = logger;
  }

  async classify(summary, options) {
    const { baseUrl, apiKey, model, timeoutMs = 8000 } = options;
    if (!baseUrl || !apiKey || !model) throw new JevError("JEV is not configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          stream: false,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "Classify the coding task into exactly one tier: simple, normal, complex, or extreme. Return JSON only: {\"tier\":\"simple|normal|complex|extreme\"}."
            },
            { role: "user", content: JSON.stringify(summary) }
          ]
        })
      });
      if (!response.ok) throw new JevError(`JEV returned HTTP ${response.status}`);
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content ?? payload?.tier;
      const result = typeof content === "string" ? JSON.parse(content) : content;
      if (!VALID_TIERS.has(result?.tier)) throw new JevError("JEV returned an invalid tier");
      return { tier: result.tier };
    } catch (error) {
      if (error instanceof JevError) throw error;
      throw new JevError(error?.name === "AbortError" ? "JEV request timed out" : "JEV request failed", error);
    } finally {
      clearTimeout(timer);
    }
  }
}
