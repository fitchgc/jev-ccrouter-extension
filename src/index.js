import { JevClient } from "./jev-client.js";
import { JevRouter } from "./router.js";
import { mergeConfig, validateConfig } from "./config.js";
import { parseJsonBody, patchModel } from "./request-patch.js";

const CONFIG_KEY = "jev-ccrouter";

export function createExtension({ jevClient, logger = console } = {}) {
  const router = new JevRouter({
    jevClient: jevClient ?? new JevClient({ logger }),
    logger
  });

  return {
    id: CONFIG_KEY,
    defaults: mergeConfig(),
    validate: validateConfig,

    async routeCodexRequest({ request, profile, config }) {
      const allowedModels = profile?.availableModels ?? profile?.allowedModels ?? [];
      const decision = await router.route({ request, config, allowedModels });
      return {
        ...decision,
        request: decision.usedFallback
          ? request
          : { ...request, model: decision.selectedModel }
      };
    },

    register(context) {
      const route = context.registerCodexRequestRoute ?? context.registerRequestRoute;
      if (typeof route === "function") {
        route.call(context, async (input) => this.routeCodexRequest(input));
      } else if (typeof context.registerProxyRoute === "function") {
        this.registerProxyFallback(context);
      } else {
        throw new Error("CCR route or proxy registration API is unavailable");
      }
      context.registerSettings?.({
        id: CONFIG_KEY,
        defaults: mergeConfig(),
        validate: (value, models) => validateConfig(value, models)
      });
      context.registerApp?.({
        id: CONFIG_KEY,
        entry: new URL("../ui/index.html", import.meta.url).href,
        route: "/extensions/jev-smart-router"
      });
      return this;
    },

    registerProxyFallback(context) {
      const backend = context.registerHttpBackend?.({
        id: `${CONFIG_KEY}-backend`,
        async handle(request, response) {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const body = Buffer.concat(chunks);
          const parsed = parseJsonBody(body);
          const profile = context.config?.profile?.profiles?.find((item) => item.agent === "codex")
            ?? context.config?.profile?.codex
            ?? {};
          const allowedModels = profile.availableModels ?? [];
          const config = context.pluginConfig?.(CONFIG_KEY) ?? context.config?.plugins?.[CONFIG_KEY] ?? {};
          const result = parsed?.model
            ? await router.route({ request: parsed, config, allowedModels })
            : { usedFallback: true };
          const outgoingBody = !result.usedFallback && parsed
            ? Buffer.from(JSON.stringify(patchModel(parsed, result.selectedModel)))
            : body;
          if (typeof context.forwardProxyRequest !== "function") {
            throw new Error("CCR proxy context must provide forwardProxyRequest");
          }
          return context.forwardProxyRequest({
            ...request,
            body: outgoingBody,
            headers: forwardHeaders(request.headers, outgoingBody.length)
          }, response);
        }
      });
      const register = context.registerProxyRoute;
      const hosts = providerHosts(context.config);
      for (const host of hosts) {
        register.call(context, {
          id: `${CONFIG_KEY}-${host}`,
          host,
          paths: ["/"],
          upstream: backend.url ?? backend,
          preserveHost: true
        });
      }
    }
  };
}

export default function register(context) {
  return createExtension().register(context);
}
