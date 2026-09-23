import test from "node:test";
import assert from "node:assert/strict";
import { JevClient, JevError, resolveEndpoint } from "../src/jev-client.js";

test("JEV client sends a System One choice classification request", async () => {
  let captured;
  const client = new JevClient({
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        async json() {
          return {
            model: "jev-1.13.0",
            answers: {
              tier: {
                type: "choice",
                choice: "normal",
                confidence: 0.88,
                probabilities: { simple: 0.05, normal: 0.88, complex: 0.07, extreme: 0.0 }
              }
            },
            usage: { input_tokens: 150, output_tokens: 15 }
          };
        }
      };
    }
  });

  const result = await client.classify({ userIntent: "fix bug" }, {
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    apiKey: "ts-key-123",
    model: "jev-latest",
    timeoutMs: 1000
  });

  assert.deepEqual(result, { tier: "normal", confidence: 0.88 });
  assert.equal(captured.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(captured.options.headers.authorization, "Bearer ts-key-123");
  assert.equal(captured.body.model, "jev-latest");
  assert.equal(captured.body.questions.tier.type, "choice");
  assert.equal(captured.body.state.userIntent, "fix bug");
});

test("JEV client randomly selects one configured API key per request", async () => {
  const authorizationHeaders = [];
  const client = new JevClient({
    random: () => 0.75,
    fetchImpl: async (_url, options) => {
      authorizationHeaders.push(options.headers.authorization);
      return {
        ok: true,
        async json() {
          return { tier: "simple" };
        }
      };
    }
  });

  await client.classify({}, {
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    apiKeys: ["key-a", "key-b", "key-c", "key-d"],
    model: "jev-latest"
  });

  assert.deepEqual(authorizationHeaders, ["Bearer key-d"]);
});

test("JEV client resolves base URLs correctly", () => {
  assert.equal(resolveEndpoint("https://api.typesafe.ai/v1/systemone").url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(resolveEndpoint("https://api.typesafe.ai/v1/systemone/").url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(resolveEndpoint("https://api.typesafe.ai/v1").url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(resolveEndpoint("https://api.typesafe.ai").url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(resolveEndpoint("https://proxy.example/v1/chat/completions").url, "https://proxy.example/v1/chat/completions");
  assert.equal(resolveEndpoint("https://proxy.example/v1/chat/completions").protocol, "openai");
});

test("JEV client supports OpenAI chat/completions compatibility fallback", async () => {
  let captured;
  const client = new JevClient({
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return { ok: true, async json() { return { choices: [{ message: { content: '{"tier":"complex"}' } }] }; } };
    }
  });
  const result = await client.classify({ userIntent: "large refactor" }, {
    baseUrl: "https://proxy.example/v1/chat/completions",
    apiKey: "key",
    model: "gpt-4o",
    timeoutMs: 1000
  });
  assert.deepEqual(result, { tier: "complex", confidence: undefined });
  assert.equal(captured.url, "https://proxy.example/v1/chat/completions");
  assert.equal(captured.body.response_format.type, "json_object");
});

test("JEV client rejects invalid tier", async () => {
  const client = new JevClient({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { answers: { tier: { choice: "invalid_tier" } } };
      }
    })
  });
  await assert.rejects(
    client.classify({}, { baseUrl: "https://api.typesafe.ai/v1/systemone", apiKey: "key", model: "jev-latest" }),
    (error) => error instanceof JevError && error.message.includes("invalid tier")
  );
});

test("JEV client surfaces HTTP error details from response", async () => {
  const client = new JevClient({
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async json() {
        return { error: { message: "Invalid API key provided" } };
      }
    })
  });
  await assert.rejects(
    client.classify({}, { baseUrl: "https://api.typesafe.ai/v1/systemone", apiKey: "wrong-key", model: "jev-latest" }),
    (error) => error instanceof JevError && error.message.includes("401") && error.message.includes("Invalid API key")
  );
});
