import { mergeConfig, validateConfig } from "./config.js";
import { summarizeRequest } from "./summary.js";

export class JevRouter {
  constructor({ jevClient, logger = console } = {}) {
    this.jevClient = jevClient;
    this.logger = logger;
  }

  async route({ request, config, allowedModels }) {
    const originalModel = request?.model ?? "";
    const checked = validateConfig(config, allowedModels);
    if (!checked.config.enabled || !checked.valid) {
      return this.fallback(originalModel, checked.valid ? "disabled" : checked.errors.join("; "));
    }
    try {
      const decision = await this.jevClient.classify(
        summarizeRequest(request),
        checked.config.jev
      );
      const selectedModel = checked.config.tiers[decision.tier];
      if (!allowedModels.includes(selectedModel)) {
        return this.fallback(originalModel, "selected model is no longer allowed", decision.tier);
      }
      const logMsg = `[jev-router] Task classified as "${decision.tier}"${decision.confidence != null ? ` (confidence: ${(decision.confidence * 100).toFixed(0)}%)` : ""}. Routing "${originalModel}" -> "${selectedModel}"`;
      (this.logger.info ?? this.logger.log)?.(logMsg);
      return {
        tier: decision.tier,
        confidence: decision.confidence,
        selectedModel,
        originalModel,
        usedFallback: false
      };
    } catch (error) {
      this.logger.warn?.(`[jev-router] JEV classification failed: ${error.message}`);
      return this.fallback(originalModel, error.message);
    }
  }

  fallback(originalModel, fallbackReason, tier) {
    if (fallbackReason !== "disabled") {
      this.logger.warn?.(`[jev-router] Falling back to original model "${originalModel}". Reason: ${fallbackReason}`);
    }
    return {
      tier,
      selectedModel: originalModel,
      originalModel,
      usedFallback: true,
      fallbackReason
    };
  }

  static normalizeConfig(config) {
    return mergeConfig(config);
  }
}
