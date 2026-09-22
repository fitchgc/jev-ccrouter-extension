import test from "node:test";
import assert from "node:assert/strict";
import { JevClient, JevError } from "../src/jev-client.js";

test("JEV client sends a bounded JSON classification request", async () => {
  let captured;
  const client = new JevClient({
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return { ok: true, async json() { return { choices: [{ message: { content: '{"tier":"normal"}' } }] }; } };
    }
  });
  const result = await client.classify({ userIntent: "fix bug" }, {
    baseUrl: "https://jev.example/v1", apiKey: "key", model: "jev", timeoutMs: 1000
  });
  assert.deepEqual(result, { tier: "normal" });
  assert.equal(captured.url, "https://jev.example/v1/chat/completions");
  assert.equal(captured.options.headers.authorization, "Bearer key");
  assert.equal(captured.body.response_format.type, "json_object");
});

test("JEV client rejects invalid tier", async () => {
  const client = new JevClient({
    fetchImpl: async () => ({ ok: true, async json() { return { choices: [{ message: { content: '{"tier":"unknown"}' } }] }; } })
  });
  await assert.rejects(
    client.classify({}, { baseUrl: "https://jev.example/v1", apiKey: "key", model: "jev" }),
    (error) => error instanceof JevError && error.message.includes("invalid tier")
  );
});
