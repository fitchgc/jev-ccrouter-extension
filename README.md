# JEV Smart Router for Claude Code Router

这是一个 Claude Code Router（CCR）本地扩展，用 JEV 判断每个 Codex 请求的任务难度，并把请求路由到四个已配置的 Allowed model 之一：

- `simple`：简单
- `normal`：普通
- `complex`：复杂
- `extreme`：极难

JEV 不可用、超时或返回无效结果时，插件会保留 Codex 本次请求的原始模型。

## 是否需要打包？

**本地安装不需要打包。** 直接在 CCR 的 Extensions 页面选择本仓库目录即可。需要发送给其他人、上传制品或归档时，才生成 zip 包。扩展目录的根部必须包含 `.codex-plugin/plugin.json` 和它声明的入口模块。

## 前置条件

1. 已安装并运行 CCR Desktop 3.x。
2. CCR 中已启用 Codex profile。
3. Codex profile 已配置至少四个可用模型，或允许多个档位复用同一个模型。
4. 已有 JEV API endpoint、API key 和用于分类的 JEV model。
5. Node.js 18 或更高版本，用于本地检查和测试。

## 本地开发安装

在本仓库根目录执行：

```sh
npm test
npm run check
```

检查通过后：

1. 打开 CCR Desktop。
2. 进入 **Extensions** 页面。
3. 点击 **Add extension** 或 **添加扩展**。
4. 选择本仓库目录，例如：

   ```text
   /Users/<your-name>/path/to/jev-ccrouter-extension
   ```

5. 保存扩展配置。
6. 打开 CCR 的 **Server** 页面并重启 Gateway。

CCR 会读取 `.codex-plugin/plugin.json` 中的 `module`，并加载根目录的 `index.cjs`。修改插件代码后，需要重启 Gateway 才会重新加载扩展。

> 当前插件使用 `index.cjs` 作为 CCR 入口，入口再加载 `src/index.js`。不要直接选择 `src` 目录，也不要只复制 `ui` 目录。

## 配置 JEV Router

安装并重启 Gateway 后，在 CCR 的扩展入口中打开 **JEV Smart Router**，配置：

1. **Enable per-request routing**
   - 开启后，每个 Codex API request 都会调用一次 JEV。
2. **Base URL**
   - 填写 JEV 的 OpenAI-compatible API base URL。
   - 如果完整接口是 `https://example/v1/chat/completions`，这里填写到 `/v1`，插件会追加 `/chat/completions`。
3. **API key**
   - 填写 JEV API key。
4. **Model**
   - 填写用于难度分类的 JEV model。
5. **Timeout**
   - 默认 8000 ms。
6. 配置四个档位模型：
   - `Simple`
   - `Normal`
   - `Complex`
   - `Extreme`

四个下拉框只应显示当前 Codex profile 的 Allowed model list。允许多个档位选择同一个模型。

保存后点击 **Test connection**，确认 JEV 可访问，再开始使用 Codex。

## 推荐配置示例

假设当前 Codex Allowed model list 为：

```text
llmapi.site/gpt-5.6-sol
llmapi.site/gpt-5.6-luna
llmapi.site/gpt-6-astra
llmapi.site/gpt-5.6-terra
```

可以配置为：

```text
Simple   -> llmapi.site/gpt-5.6-sol
Normal   -> llmapi.site/gpt-5.6-luna
Complex  -> llmapi.site/gpt-5.6-terra
Extreme  -> llmapi.site/gpt-6-astra
```

如果更重视成本，也可以把 `Complex` 和 `Extreme` 配置为同一个模型。

## 运行行为

每个 Codex 请求的处理流程：

1. 读取当前请求的原始模型。
2. 提取有限的任务摘要。
3. 将摘要发送给 JEV。
4. 要求 JEV 返回以下四个值之一：

   ```json
   {"tier":"simple"}
   ```

5. 根据 tier 选择对应模型。
6. 只修改请求中的 `model` 字段。
7. 继续交给 CCR 处理 provider、工具调用和流式响应。

发送给 JEV 的摘要包括最近用户意图、消息数量、工具名称、图片输入标记和估算输入规模；不会发送完整工具输出、二进制输入或 API key。

## 打包发布

### 生成 zip

```sh
npm run pack
```

输出文件：

```text
dist/jev-ccrouter-extension-0.1.0.zip
```

也可以手动执行：

```sh
zip -qr dist/jev-ccrouter-extension-0.1.0.zip . \
  -x 'dist/*' \
  -x '.git/*' \
  -x 'node_modules/*'
```

分享 zip 前确认压缩包根目录直接包含：

```text
.codex-plugin/plugin.json
index.cjs
src/
ui/
package.json
```

不要把整个父目录再套一层，否则 CCR 选择目录或解压后可能找不到 manifest。

## 开发与调试

```sh
npm run check
npm test
```

排查加载问题时重点检查：

- `module` 是否指向本地 `index.cjs`。
- 是否授予 `trusted-code`、`apps`、`gateway-routes`、`http-backends` 和 `proxy-routes` 权限。
- 是否在保存扩展后重启 Gateway。
- JEV endpoint 是否可以从运行 CCR 的机器访问。
- JEV API key 是否有效。
- 四个模型是否仍存在于当前 Codex profile 的 Allowed model list。

## 已知限制

- 当前工作区没有 CCR 独立 SDK 类型包，因此核心路由逻辑和 JEV 客户端可独立测试，但仍建议在目标 CCR 版本上完成一次真实 Gateway/代理验证。
- 本插件只针对 CCR Codex profile；不会拦截机器上其他应用发出的 OpenAI API 请求。
- 当前实现不自行重放 SSE，而是尝试通过 CCR 路由/代理适配层继续处理原始请求。

## 隐私与故障回退

插件只向 JEV 发送有上限的任务摘要，不发送完整工具输出、二进制输入或凭据。

以下情况会回退到 Codex 原始模型：

- JEV 超时。
- JEV HTTP 错误。
- JEV 网络失败。
- JEV 返回无效 JSON。
- JEV 返回未知 tier。
- tier 对应模型不在 Allowed model list。
