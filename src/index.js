import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JevClient } from "./jev-client.js";
import { JevRouter } from "./router.js";
import { mergeConfig, validateConfig } from "./config.js";
import { patchModel } from "./request-patch.js";

const CONFIG_KEY = "jev-ccrouter";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_HTML_PATH = path.resolve(__dirname, "../ui/index.html");

function loadStoredConfig(pluginDataDir, pluginConfig) {
  try {
    if (pluginDataDir) {
      const filePath = path.join(pluginDataDir, "config.json");
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        return mergeConfig(JSON.parse(raw));
      }
    }
  } catch {
    // ignore parse error
  }
  return mergeConfig(pluginConfig);
}

function saveStoredConfig(pluginDataDir, config) {
  if (!pluginDataDir) return;
  try {
    fs.mkdirSync(pluginDataDir, { recursive: true });
    const filePath = path.join(pluginDataDir, "config.json");
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[jev-router] Failed to persist config to ${pluginDataDir}: ${err.message}`);
  }
}

function getAllowedModels(context) {
  const profile = context?.config?.profile;
  const profiles = profile?.profiles ?? [];
  const codex = profiles.find((p) => p.agent === "codex" || p.id === "codex")
    ?? profile?.codex
    ?? {};
  const models = codex.availableModels ?? codex.allowedModels ?? [];
  if (Array.isArray(models) && models.length > 0) {
    return models;
  }
  const providerModels = [];
  if (context?.config?.providers) {
    for (const p of Object.values(context.config.providers)) {
      if (Array.isArray(p?.models)) {
        for (const m of p.models) {
          const id = typeof m === "string" ? m : m?.id;
          if (id && !providerModels.includes(id)) providerModels.push(id);
        }
      }
    }
  }
  return providerModels;
}

async function readRequestBody(req, helpers) {
  if (helpers?.readJson) {
    try {
      return await helpers.readJson(req);
    } catch {
      return {};
    }
  }
  if (helpers?.readBody) {
    try {
      const buf = await helpers.readBody(req);
      const str = buf.toString("utf-8");
      return str ? JSON.parse(str) : {};
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf-8");
  return text ? JSON.parse(text) : {};
}

function sendResponse(res, statusCode, data, helpers) {
  if (helpers?.sendJson) {
    helpers.sendJson(res, statusCode, data);
    return;
  }
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*"
  });
  res.end(payload);
}

function serveHtml(req, res) {
  const html = fs.existsSync(UI_HTML_PATH)
    ? fs.readFileSync(UI_HTML_PATH, "utf-8")
    : "<!doctype html><html><body><h1>UI file not found</h1></body></html>";

  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Access-Control-Allow-Origin": "*"
  };

  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    return res.end();
  }

  res.writeHead(200, headers);
  res.end(html);
}

function applyRouteDecision(request, decision, inputHeaders = {}) {
  if (decision.usedFallback) return null;
  const selectedModel = decision.selectedModel;
  return {
    routedModel: selectedModel,
    body: patchModel(request, selectedModel),
    headers: {
      ...inputHeaders,
      "x-ccr-routed-model": selectedModel,
      "x-ccr-route-reason": `plugin:${CONFIG_KEY}:${decision.tier}`
    }
  };
}

export function createExtension({ jevClient, logger = console } = {}) {
  const client = jevClient ?? new JevClient({ logger });
  const router = new JevRouter({
    jevClient: client,
    logger
  });

  let activeConfig = mergeConfig();

  return {
    id: CONFIG_KEY,
    defaults: mergeConfig(),
    validate: validateConfig,

    async routeCodexRequest({ request, profile, config }) {
      const effectiveConfig = config ?? activeConfig;
      const allowedModels = profile?.availableModels ?? profile?.allowedModels ?? [];
      const decision = await router.route({ request, config: effectiveConfig, allowedModels });
      return {
        ...decision,
        request: decision.usedFallback
          ? request
          : { ...request, model: decision.selectedModel }
      };
    },

    register(context) {
      const pluginDataDir = context.paths?.pluginDataDir;
      const initialConfig = context.pluginConfig?.(CONFIG_KEY)
        ?? context.pluginConfig
        ?? context.config?.plugins?.[CONFIG_KEY];
      activeConfig = loadStoredConfig(pluginDataDir, initialConfig);

      // 1. Register UI Route (both GET and HEAD for CCR health probes)
      context.registerGatewayRoute?.({
        auth: "none",
        id: "jev-smart-router-ui",
        path: "/extensions/jev-smart-router",
        methods: ["GET", "HEAD"],
        handler(req, res) {
          serveHtml(req, res);
        }
      });

      // Alias for /plugins/jev-smart-router
      context.registerGatewayRoute?.({
        auth: "none",
        id: "jev-smart-router-ui-alias",
        path: "/plugins/jev-smart-router",
        methods: ["GET", "HEAD"],
        handler(req, res) {
          serveHtml(req, res);
        }
      });

      // 2. Register API Route for Config (GET / POST / OPTIONS)
      context.registerGatewayRoute?.({
        auth: "none",
        id: "jev-smart-router-api-config",
        path: "/extensions/jev-smart-router/api/config",
        methods: ["GET", "POST", "OPTIONS"],
        async handler(req, res, helpers) {
          if (req.method === "OPTIONS") {
            res.writeHead(204, {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type"
            });
            return res.end();
          }

          if (req.method === "POST") {
            try {
              const body = await readRequestBody(req, helpers);
              activeConfig = mergeConfig(body);
              saveStoredConfig(pluginDataDir, activeConfig);
              sendResponse(res, 200, { ok: true, config: activeConfig }, helpers);
            } catch (err) {
              sendResponse(res, 400, { ok: false, error: err.message }, helpers);
            }
            return;
          }

          // GET
          const allowedModels = getAllowedModels(context);
          sendResponse(res, 200, {
            ok: true,
            config: activeConfig,
            allowedModels
          }, helpers);
        }
      });

      // 3. Register API Route for Test Connection (POST / OPTIONS)
      context.registerGatewayRoute?.({
        auth: "none",
        id: "jev-smart-router-api-test",
        path: "/extensions/jev-smart-router/api/test",
        methods: ["POST", "OPTIONS"],
        async handler(req, res, helpers) {
          if (req.method === "OPTIONS") {
            res.writeHead(204, {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type"
            });
            return res.end();
          }

          try {
            const body = await readRequestBody(req, helpers);
            const testResult = await client.classify(
              { userIntent: "Test JEV connection" },
              {
                baseUrl: body.baseUrl,
                apiKey: body.apiKey,
                model: body.model,
                timeoutMs: body.timeoutMs || 8000
              }
            );
            sendResponse(res, 200, { ok: true, tier: testResult.tier, confidence: testResult.confidence }, helpers);
          } catch (err) {
            sendResponse(res, 200, { ok: false, error: err.message }, helpers);
          }
        }
      });

      // 4. Register App metadata in CCR
      context.registerApp?.({
        id: "jev-smart-router",
        name: "JEV Smart Router",
        description: "Classify Codex requests with JEV and route to Allowed models",
        icon: "shuffle",
        url: "http://127.0.0.1:3456/extensions/jev-smart-router"
      });

      // 5. Register Request Transform on Gateway if supported
      const hasTransformPermission = Array.isArray(context.permissions)
        ? context.permissions.includes("gateway-request-transforms")
        : true;
      if (hasTransformPermission && typeof context.registerGatewayRequestTransform === "function") {
        context.registerGatewayRequestTransform({
          id: `${CONFIG_KEY}-transform`,
          async transform(input) {
            if (!activeConfig.enabled) return null;
            const body = input.body;
            if (!body || typeof body !== "object") return null;
            if (!body.model && !input.routedModel) return null;

            const allowedModels = getAllowedModels(context);
            const decision = await router.route({
              request: body,
              config: activeConfig,
              allowedModels
            });

            if (decision.usedFallback) {
              return null;
            }

            return applyRouteDecision(body, decision, input.headers);
          }
        });
      }

      // 6. Direct Codex route hook for compatibility
      const routeHook = context.registerCodexRequestRoute ?? context.registerRequestRoute;
      if (typeof routeHook === "function") {
        routeHook.call(context, async (input) => this.routeCodexRequest({
          ...input,
          config: activeConfig
        }));
      }

      return this;
    }
  };
}

export default function register(context) {
  return createExtension().register(context);
}
