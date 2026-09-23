export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  jev: {
    baseUrl: "",
    apiKey: "",
    apiKeys: [],
    model: "",
    timeoutMs: 8000
  },
  tiers: {
    simple: "",
    normal: "",
    complex: "",
    extreme: ""
  },
  fallback: {
    mode: "original-model"
  },
  routing: {
    summarizeOnly: true,
    perRequest: true
  }
});

const TIER_NAMES = ["simple", "normal", "complex", "extreme"];

export function mergeConfig(value = {}) {
  const jevValue = value.jev ?? {};
  const configuredKeys = Array.isArray(jevValue.apiKeys)
    ? jevValue.apiKeys
    : [jevValue.apiKey];
  const apiKeys = [...new Set(
    configuredKeys
      .filter((key) => typeof key === "string")
      .map((key) => key.trim())
      .filter(Boolean)
  )];

  return {
    ...DEFAULT_CONFIG,
    ...value,
    jev: {
      ...DEFAULT_CONFIG.jev,
      ...jevValue,
      apiKeys,
      // Keep the legacy field populated for older callers and stored configs.
      apiKey: jevValue.apiKey || apiKeys[0] || ""
    },
    tiers: { ...DEFAULT_CONFIG.tiers, ...(value.tiers ?? {}) },
    fallback: { ...DEFAULT_CONFIG.fallback, ...(value.fallback ?? {}) },
    routing: { ...DEFAULT_CONFIG.routing, ...(value.routing ?? {}) }
  };
}

export function validateConfig(value, allowedModels = []) {
  const config = mergeConfig(value);
  const errors = [];
  if (config.fallback.mode !== "original-model") {
    errors.push("fallback.mode must be original-model");
  }
  if (config.enabled) {
    if (!config.jev.baseUrl) errors.push("JEV baseUrl is required");
    if (config.jev.apiKeys.length === 0) errors.push("At least one JEV API key is required");
    if (!config.jev.model) errors.push("JEV model is required");
    if (!Number.isFinite(config.jev.timeoutMs) || config.jev.timeoutMs < 500) {
      errors.push("JEV timeoutMs must be at least 500");
    }
    for (const tier of TIER_NAMES) {
      if (!config.tiers[tier]) errors.push(`tier model is required: ${tier}`);
      else if (!allowedModels.includes(config.tiers[tier])) {
        errors.push(`tier model is not in Allowed model list: ${config.tiers[tier]}`);
      }
    }
  }
  return { valid: errors.length === 0, errors, config };
}

export function tierNames() {
  return [...TIER_NAMES];
}
