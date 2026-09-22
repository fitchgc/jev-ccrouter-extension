import test from "node:test";
import assert from "node:assert/strict";
import { JevRouter } from "../src/router.js";
import { summarizeRequest } from "../src/summary.js";
import { validateConfig } from "../src/config.js";
import { patchModel, parseJsonBody } from "../src/request-patch.js";

const models = ["cheap", "balanced", "strong"];
const config = {
  enabled: true,
  jev: { baseUrl: "https://jev.example/v1", apiKey: "secret", model: "classifier", timeoutMs: 1000 },
  tiers: { simple: "cheap", normal: "balanced", complex: "strong", extreme: "strong" },
  fallback: { mode: "original-model" }
};

test("routes each JEV tier to configured Allowed model", async () => {
  const router = new JevRouter({ jevClient: { classify: async () => ({ tier: "complex" }) } });
  const result = await router.route({ request: { model: "original", messages: [{ role: "user", content: "refactor" }] }, config, allowedModels: models });
  assert.equal(result.selectedModel, "strong");
  assert.equal(result.usedFallback, false);
});

test("falls back to original model when JEV fails", async () => {
  const router = new JevRouter({ jevClient: { classify: async () => { throw new Error("timeout"); } } });
  const result = await router.route({ request: { model: "original" }, config, allowedModels: models });
  assert.equal(result.selectedModel, "original");
  assert.equal(result.usedFallback, true);
});

test("rejects tier models outside Allowed model list", () => {
  const result = validateConfig({ ...config, tiers: { ...config.tiers, simple: "not-allowed" } }, models);
  assert.equal(result.valid, false);
});

test("summary excludes raw tool output and captures capabilities", () => {
  const summary = summarizeRequest({
    model: "original",
    messages: [{ role: "user", content: [{ type: "text", text: "Fix the bug" }, { type: "image_url", image_url: "secret-image" }] }],
    tools: [{ type: "function", function: { name: "shell" } }],
    tool_output: "do not send this"
  });
  assert.equal(summary.userIntent, "Fix the bug");
  assert.equal(summary.hasImages, true);
  assert.deepEqual(summary.toolNames, ["shell"]);
  assert.equal("tool_output" in summary, false);
});

test("patches only the model field and preserves the request", () => {
  const request = { model: "old", stream: true, input: [{ role: "user", content: "hi" }] };
  const patched = patchModel(request, "new");
  assert.equal(patched.model, "new");
  assert.equal(patched.stream, true);
  assert.deepEqual(request.input, patched.input);
  assert.equal(parseJsonBody(Buffer.from(JSON.stringify(patched))).model, "new");
});
