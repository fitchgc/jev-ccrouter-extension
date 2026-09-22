import test from "node:test";
import assert from "node:assert/strict";
import register, { createExtension } from "../src/index.js";

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    headersSent: false,
    writeHead(status, headers = {}) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
      this.headersSent = true;
    },
    end(content = "") {
      this.body = content;
    }
  };
}

function createMockRequest({ method = "GET", url = "/", body = null } = {}) {
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    }
  };
}

test("extension registers gateway routes, app, and serves UI properly", async () => {
  const routes = [];
  let registeredApp = null;
  let registeredTransform = null;

  const context = {
    permissions: ["trusted-code", "apps", "gateway-routes", "gateway-request-transforms"],
    config: {
      profile: {
        profiles: [
          { agent: "codex", availableModels: ["model-a", "model-b"] }
        ]
      }
    },
    registerGatewayRoute(route) {
      routes.push(route);
    },
    registerApp(app) {
      registeredApp = app;
    },
    registerGatewayRequestTransform(transform) {
      registeredTransform = transform;
    }
  };

  const extension = createExtension();
  extension.register(context);

  // 1. Verify App registration
  assert.ok(registeredApp, "registerApp should have been called");
  assert.equal(registeredApp.name, "JEV Smart Router");
  assert.equal(registeredApp.url, "http://127.0.0.1:3456/extensions/jev-smart-router");

  // 2. Verify Gateway Routes
  const uiRoute = routes.find((r) => r.path === "/extensions/jev-smart-router");
  assert.ok(uiRoute, "UI route should be registered");
  assert.equal(uiRoute.auth, "none", "UI route auth must be 'none'");
  assert.deepEqual(uiRoute.methods, ["GET", "HEAD"]);

  // 3. Test GET UI
  const getReq = createMockRequest({ method: "GET" });
  const getRes = createMockResponse();
  uiRoute.handler(getReq, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.ok(getRes.body.includes("<!doctype html>"));
  assert.ok(getRes.body.includes("JEV Smart Router"));

  // 4. Test HEAD probe (CCR health check)
  const headReq = createMockRequest({ method: "HEAD" });
  const headRes = createMockResponse();
  uiRoute.handler(headReq, headRes);
  assert.equal(headRes.statusCode, 200);
  assert.equal(headRes.body, "");
  assert.ok(Number(headRes.headers["Content-Length"]) > 0);

  // 5. Test GET /api/config
  const configRoute = routes.find((r) => r.path === "/extensions/jev-smart-router/api/config");
  assert.ok(configRoute, "Config API route should be registered");
  assert.equal(configRoute.auth, "none");

  const getConfigReq = createMockRequest({ method: "GET" });
  const getConfigRes = createMockResponse();
  await configRoute.handler(getConfigReq, getConfigRes);
  assert.equal(getConfigRes.statusCode, 200);
  const configData = JSON.parse(getConfigRes.body);
  assert.equal(configData.ok, true);
  assert.deepEqual(configData.allowedModels, ["model-a", "model-b"]);

  // 6. Test POST /api/config
  const postConfigReq = createMockRequest({
    method: "POST",
    body: {
      enabled: true,
      jev: { baseUrl: "https://api.test/v1", apiKey: "test-key", model: "m1" },
      tiers: { simple: "model-a", normal: "model-a", complex: "model-b", extreme: "model-b" }
    }
  });
  const postConfigRes = createMockResponse();
  await configRoute.handler(postConfigReq, postConfigRes);
  assert.equal(postConfigRes.statusCode, 200);
  const savedData = JSON.parse(postConfigRes.body);
  assert.equal(savedData.ok, true);
  assert.equal(savedData.config.enabled, true);
  assert.equal(savedData.config.jev.model, "m1");
});

test("gateway transform returns both routedModel and patched body model", async () => {
  let registeredTransform;
  const context = {
    permissions: ["gateway-request-transforms"],
    config: {
      profile: {
        profiles: [
          { agent: "codex", availableModels: ["model-a", "model-b"] }
        ]
      }
    },
    pluginConfig: () => ({
      enabled: true,
      jev: { baseUrl: "https://api.test/v1", apiKey: "key", model: "classifier" },
      tiers: { simple: "model-a", normal: "model-b", complex: "model-b", extreme: "model-b" }
    }),
    registerGatewayRequestTransform(transform) {
      registeredTransform = transform;
    }
  };

  const extension = createExtension({
    jevClient: { classify: async () => ({ tier: "normal" }) }
  });
  extension.register(context);

  const result = await registeredTransform.transform({
    headers: { "x-ccr-routed-model": "model-a" },
    body: { model: "model-a", input: [{ role: "user", content: "hello" }] }
  });

  assert.equal(result.routedModel, "model-b");
  assert.equal(result.body.model, "model-b");
  assert.equal(result.headers["x-ccr-routed-model"], "model-b");
  assert.equal(result.headers["x-ccr-route-reason"], "plugin:jev-ccrouter:normal");
});

test("config UI reads the latest runtime Allowed model list without restart", async () => {
  const routes = [];
  let currentModels = ["model-a"];
  const context = {
    config: { profile: { profiles: [{ agent: "codex", availableModels: ["stale-model"] }] } },
    getCurrentConfig: async () => ({
      profile: { profiles: [{ agent: "codex", availableModels: currentModels }] }
    }),
    registerGatewayRoute(route) {
      routes.push(route);
    }
  };

  createExtension().register(context);
  const configRoute = routes.find((route) => route.path === "/extensions/jev-smart-router/api/config");

  const firstResponse = createMockResponse();
  await configRoute.handler(createMockRequest(), firstResponse);
  assert.deepEqual(JSON.parse(firstResponse.body).allowedModels, ["model-a"]);

  currentModels = ["model-a", "new-model"];
  const secondResponse = createMockResponse();
  await configRoute.handler(createMockRequest(), secondResponse);
  assert.deepEqual(JSON.parse(secondResponse.body).allowedModels, ["model-a", "new-model"]);
  assert.match(secondResponse.headers["Cache-Control"], /no-store/);
});
