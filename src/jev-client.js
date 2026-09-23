export const VALID_TIERS = new Set(["simple", "normal", "complex", "extreme"]);

export const DEFAULT_TIER_CRITERIA = {
  simple: "Trivial fixes, typos, single line edits, trivial lookups, simple comments",
  normal: "Routine coding tasks, standard functions, single component edits, standard unit tests",
  complex: "Complex tasks, multi-file refactoring, difficult architecture changes, subtle debugging",
  extreme: "Extreme tasks, highly critical system redesign, major migrations, cross-system architectural overhaul"
};

export class JevError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "JevError";
    this.cause = cause;
  }
}

export function resolveEndpoint(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return { url: "", protocol: "systemone" };

  if (trimmed.endsWith("/chat/completions")) {
    return { url: trimmed, protocol: "openai" };
  }

  if (trimmed.endsWith("/v1/systemone") || trimmed.endsWith("/systemone")) {
    return { url: trimmed, protocol: "systemone" };
  }

  if (trimmed.endsWith("/v1")) {
    return { url: `${trimmed}/systemone`, protocol: "systemone" };
  }

  return { url: `${trimmed}/v1/systemone`, protocol: "systemone" };
}

export class JevClient {
  constructor({ fetchImpl = globalThis.fetch, logger = console, random = Math.random } = {}) {
    this.fetch = fetchImpl;
    this.logger = logger;
    this.random = random;
  }

  async classify(summary, options) {
    const { baseUrl, model, timeoutMs = 8000 } = options;
    const apiKeys = Array.isArray(options.apiKeys)
      ? options.apiKeys.filter((key) => typeof key === "string" && key.trim())
      : [options.apiKey].filter((key) => typeof key === "string" && key.trim());
    if (!baseUrl || apiKeys.length === 0 || !model) throw new JevError("JEV is not configured");
    const apiKey = apiKeys[Math.floor(this.random() * apiKeys.length)] ?? apiKeys[0];

    const { url, protocol } = resolveEndpoint(baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();

    const requestBody = protocol === "openai"
      ? {
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
        }
      : {
          model,
          state: summary,
          questions: {
            tier: {
              type: "choice",
              instructions: "Classify the coding task into exactly one tier: simple, normal, complex, or extreme.",
              criteria: DEFAULT_TIER_CRITERIA
            }
          }
        };

    try {
      const response = await this.fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        let detail = "";
        try {
          const errData = await response.json();
          detail = errData?.error?.message || errData?.message || (typeof errData === "string" ? errData : "");
        } catch {
          // ignore parsing error
        }
        throw new JevError(
          detail ? `JEV returned HTTP ${response.status}: ${detail}` : `JEV returned HTTP ${response.status}`
        );
      }

      const payload = await response.json();

      let tier;
      let confidence;

      if (payload?.answers?.tier) {
        tier = payload.answers.tier.choice;
        confidence = payload.answers.tier.confidence;
      } else if (payload?.tier) {
        tier = payload.tier;
      } else if (payload?.choices?.[0]?.message?.content) {
        const content = payload.choices[0].message.content;
        if (typeof content === "string") {
          try {
            const parsed = JSON.parse(content);
            tier = parsed?.tier ?? parsed?.choice;
          } catch {
            tier = content.trim();
          }
        } else if (content && typeof content === "object") {
          tier = content.tier ?? content.choice;
        }
      }

      if (!VALID_TIERS.has(tier)) {
        throw new JevError("JEV returned an invalid tier");
      }

      return { tier, confidence };
    } catch (error) {
      if (error instanceof JevError) throw error;
      throw new JevError(error?.name === "AbortError" ? "JEV request timed out" : "JEV request failed", error);
    } finally {
      clearTimeout(timer);
    }
  }
}
