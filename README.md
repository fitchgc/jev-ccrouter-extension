# JEV Smart Router for Claude Code Router

JEV Smart Router is a local Claude Code Router (CCR) extension that classifies each Codex request by task difficulty and routes it to one of four configured Allowed models:

- `simple`: straightforward tasks
- `normal`: routine coding tasks
- `complex`: multi-file or architecturally difficult tasks
- `extreme`: highly critical or system-wide tasks

If JEV is unavailable, times out, returns an invalid result, or produces a tier whose model is no longer allowed, the extension keeps the request's original model.

## Do I need to package the extension?

**No package is required for local installation.** In CCR, select this repository directory from the Extensions page. Create a zip archive only when sharing, uploading, or archiving the extension. The extension root must contain `.codex-plugin/plugin.json` and the entry module declared by that manifest.

## Prerequisites

1. CCR Desktop 3.x is installed and running.
2. A Codex profile is enabled in CCR.
3. The Codex profile has at least four usable models, or allows multiple tiers to reuse the same model.
4. You have a JEV API endpoint, API key, and classification model.
5. Node.js 18 or later is available for local checks and tests.

## Install for local development

From the repository root, run:

```sh
npm test
npm run check
```

After both commands pass:

1. Open CCR Desktop.
2. Go to **Extensions**.
3. Click **Add extension**.
4. Select this repository directory, for example:

   ```text
   /Users/<your-name>/path/to/jev-ccrouter-extension
   ```

5. Save the extension configuration.
6. Open CCR's **Server** page and restart the Gateway.

CCR reads the `module` field in `.codex-plugin/plugin.json` and loads the root-level `index.cjs`. Restart the Gateway after changing the extension so that CCR reloads the code.

> The extension currently uses `index.cjs` as the CCR entry point, which then loads `src/index.js`. Select the repository root—not the `src` directory or only the `ui` directory.

## Configure JEV Router

After installing the extension and restarting the Gateway, open **JEV Smart Router** from the CCR extension entry point and configure the following:

1. **Enable per-request routing**
   - When enabled, JEV is called once for each Codex API request.
2. **Base URL**
   - Enter the TypeSafe JEV System One API URL. The recommended value is `https://api.typesafe.ai/v1/systemone`. You may also enter `https://api.typesafe.ai`; the extension resolves it to `/v1/systemone`.
   - For a custom OpenAI-compatible proxy, enter the complete URL ending in `/chat/completions`.
3. **API key**
   - Enter a TypeSafe API key. Keys are available from [TypeSafe Console Keys](https://console.typesafe.ai/keys).
4. **Model**
   - Enter the JEV model name. `jev-latest` is recommended.
5. **Timeout**
   - The default is 8000 ms.
6. Configure a model for each tier:
   - `Simple`
   - `Normal`
   - `Complex`
   - `Extreme`

The four model selectors should contain only models from the current Codex profile's Allowed model list. Multiple tiers may use the same model.

Save the configuration and click **Test connection** to verify that JEV is reachable before using Codex.

## Example configuration

Assume the current Codex Allowed model list is:

```text
llmapi.site/gpt-5.6-sol
llmapi.site/gpt-5.6-luna
llmapi.site/gpt-6-astra
llmapi.site/gpt-5.6-terra
```

A possible configuration is:

```text
Simple   -> llmapi.site/gpt-5.6-sol
Normal   -> llmapi.site/gpt-5.6-luna
Complex  -> llmapi.site/gpt-5.6-terra
Extreme  -> llmapi.site/gpt-6-astra
```

If cost is more important than maximum capability, `Complex` and `Extreme` can point to the same model.

## Request flow

For each Codex request, the extension:

1. Reads the request's original model.
2. Extracts a bounded task summary.
3. Sends the summary to JEV.
4. Requires JEV to return exactly one of the following tiers:

   ```json
   {"tier":"simple"}
   ```

5. Selects the model configured for that tier.
6. Modifies only the request's `model` field.
7. Passes the request back to CCR, which continues to handle providers, tool calls, and streaming responses.

The summary sent to JEV can include the latest user intent, message count, tool names, image-input indicators, and an estimated input size. It does not include complete tool output, binary input, or API keys.

## Package for distribution

### Create a zip archive

```sh
npm run pack
```

The output is:

```text
dist/jev-ccrouter-extension-0.1.0.zip
```

You can also create the archive manually:

```sh
zip -qr dist/jev-ccrouter-extension-0.1.0.zip . \
  -x 'dist/*' \
  -x '.git/*' \
  -x 'node_modules/*'
```

Before sharing the archive, verify that its root contains:

```text
.codex-plugin/plugin.json
index.cjs
src/
ui/
package.json
```

Do not wrap the extension in an additional parent directory. CCR may be unable to find the manifest when selecting or extracting the archive.

## Development and troubleshooting

```sh
npm run check
npm test
```

When diagnosing loading or routing issues, check the following:

- `module` points to the local `index.cjs`.
- The extension has `trusted-code`, `apps`, `gateway-routes`, `gateway-request-transforms`, `http-backends`, and `proxy-routes` permissions.
- The Gateway was restarted after saving the extension.
- The JEV endpoint is reachable from the machine running CCR.
- The JEV API key is valid.
- All four configured models still exist in the current Codex profile's Allowed model list.

## Known limitations

- This workspace does not include a standalone CCR SDK type package. The core router and JEV client can be tested independently, but a real Gateway/proxy verification on the target CCR version is still recommended.
- The extension targets the CCR Codex profile only. It does not intercept OpenAI API requests made by other applications on the machine.
- The extension does not replay SSE itself; it relies on CCR's routing/proxy adapter layer to continue processing the original request.

## Privacy and fallback behavior

The extension sends only a bounded task summary to JEV. It does not send complete tool output, binary input, or credentials.

The extension falls back to the original Codex model when:

- JEV times out.
- JEV returns an HTTP error.
- The JEV request fails at the network layer.
- JEV returns invalid JSON.
- JEV returns an unknown tier.
- The model configured for the selected tier is not in the Allowed model list.
