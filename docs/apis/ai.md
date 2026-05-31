# AI API (ai)
本文档描述 AI API (ai) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.ai`
> - 插件后端：`context.api.ai`

> 安全边界：
> - 插件可使用 `ai.call`、`abort`、`allModels`、附件 `buffer` 上传、Token 估算与图片生成等调用型能力。
> - 宿主管理能力（AI 设置、Provider 探测、MCP/Skills/WebSearch/插件工具管理）仅允许系统渲染窗口（主应用/设置页/首次引导页）调用。插件 UI 由于共享 preload 可能看到入口，但 IPC 层会拒绝。
> - `attachments.upload({ filePath })` 仅允许系统渲染窗口使用；插件 UI/后端如需上传文件，应先在已授权范围内读取为 `ArrayBuffer`/`buffer` 后再上传，避免让主进程代读任意本地路径。

---

## 基础调用

### call(option, onChunk?)
[Renderer] [Backend]
调用文本模型。`onChunk` 传入时启用流式回调。

```javascript
const message = await ai.call({
  model: 'openai:gpt-4o-mini',
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' }
  ]
});
```

**参数**:
- `option` (AiOption)
  - `model` (string) - 模型 ID（如 `openai:gpt-4o-mini`）
  - `messages` (AiMessage[]) - 对话消息
  - `params` (AiModelParameters) - 覆盖参数（可选）
  - `tools` (AiTool[]) - 工具定义（Function Calling）
  - `capabilities` (string[]) - 内置工具能力声明（可选）
  - `internalTools` (string[]) - 旧版内置工具声明（可选，已废弃，建议改用 `capabilities`）
  - `toolingPolicy` (object) - 内置工具能力策略（可选）
  - `mcp` (AiMcpSelection) - MCP 工具选择策略（可选）
  - `skills` (AiSkillSelection) - 技能选择策略（可选）
  - `toolContext` (AiToolContext) - 工具执行上下文（可选）
  - `maxToolSteps` (number) - 工具调用最大步数（默认 20，范围 1-100）

**返回值**:
- `AiPromiseLike<AiMessage>` - 最终消息（包含可选 `usage`）
- 流式调用时，第一个 chunk 会携带 `__requestId` 字段，可用于后续调用 `ai.abort(requestId)` 中止请求

```javascript
const req = ai.call(
  {
    model: 'openai:gpt-4o-mini',
    messages: [{ role: 'user', content: 'Tell me a joke.' }]
  },
  (chunk) => console.log(chunk.content)
);

// ❌ 错误：在渲染进程（contextBridge 环境）中，req.abort 不可用
// req.abort?.();

// ✅ 正确：使用独立的 ai.abort(requestId)（见下文）
```

### abort(requestId)
[Renderer] [Backend]
中止指定请求 ID 的进行中调用。**在渲染进程（插件 UI）中，这是唯一可靠的中止方式。**

```javascript
await ai.abort(requestId);
```

> **重要**：在渲染进程中，`ai.call()` 返回的 `req.abort()` 方法由于 Electron `contextBridge` 的序列化限制**无法正常工作**（附加在 Promise 对象上的属性在跨越 context 边界时会丢失）。请始终使用 `ai.abort(requestId)`。

---

## ⚠️ 流式调用 + 中止 完整最佳实践（渲染进程）

在渲染进程（插件 UI）中实现流式 AI 调用并支持用户中止，必须遵循以下模式：

```tsx
import { useRef, useState } from 'react';

const ai = () => (window as any).mulby?.ai;

function MyAiComponent() {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortedRef = useRef(false);        // 用户已点击中止的标志
  const requestIdRef = useRef<string | null>(null);  // 当前请求的 requestId

  const handleSend = async (userMessage: string) => {
    abortedRef.current = false;
    requestIdRef.current = null;
    setIsStreaming(true);

    try {
      const req = ai().call(
        { model: 'openai:gpt-4o-mini', messages: [{ role: 'user', content: userMessage }] },
        (chunk: any) => {
          // 第一个 chunk 携带 __requestId，必须捕获以便后续中止
          if (chunk.__requestId) {
            requestIdRef.current = chunk.__requestId;
            return;
          }
          // 用户已中止时忽略后续 chunk（防止 UI 继续更新）
          if (abortedRef.current) return;

          if (chunk.chunkType === 'text') {
            // 更新 UI...
          }
        }
      );

      const finalMsg = await req;
      if (abortedRef.current) return; // 中止后不写入最终结果

      // 使用 finalMsg...
    } catch (err: any) {
      const isAbort = abortedRef.current
        || err?.name === 'AbortError'
        || String(err?.message).toLowerCase().includes('aborted');
      if (isAbort) return; // 中止后静默退出
      // 处理其他错误...
    } finally {
      setIsStreaming(false);
    }
  };

  const handleStop = () => {
    abortedRef.current = true;
    // ✅ 正确：使用顶层 ai.abort(requestId)，contextBridge 安全
    if (requestIdRef.current) {
      ai()?.abort?.(requestIdRef.current);
    }
    setIsStreaming(false);
  };

  return (
    <div>
      {isStreaming && <button onClick={handleStop}>停止</button>}
    </div>
  );
}
```

**关键点说明**：

| 事项 | 说明 |
|------|------|
| `req.abort()` | ❌ 渲染进程不可用。原因：`contextBridge` 序列化时会丢失附加在 Promise 上的属性 |
| `ai.abort(requestId)` | ✅ 渲染进程唯一可靠的中止方式，通过标准 IPC 通道发送 |
| `chunk.__requestId` | 第一个 chunk 携带的请求 ID，**必须在 chunk 回调中捕获** |
| `abortedRef` | 必须用 `useRef`（不是 `useState`），中止后立刻同步生效，防止后续 chunk 继续写入 UI |
| `catch` 中 isAbort 判断 | `abort` 会导致 Promise reject，需要在 catch 中静默处理 |

### MCP 参与调用

当 `option.mcp.mode !== 'off'` 时，AI 调用会自动挂载 MCP 工具（来自已启用的 MCP 服务器），并按 `serverIds/allowedToolIds` 与 `toolContext.mcpScope` 做过滤。

```javascript
const result = await ai.call({
  model: 'openai:gpt-4o-mini',
  messages: [{ role: 'user', content: '帮我调用本地文件工具列目录' }],
  mcp: {
    mode: 'manual',
    serverIds: ['filesystem'],
    allowedToolIds: ['mcp__filesystem__list_directory']
  }
});
```

> `allowedToolIds` 支持传工具 ID（推荐）或工具名。  
> MCP 工具 ID 格式：`mcp__<serverId>__<toolName>`。

---

## 工具调用（Function Calling）

Mulby 提供 **两种相互独立** 的"插件工具"机制，新手非常容易混淆。两者**互不依赖、互不必要**：

| 维度 | A. 插件内部工具（`option.tools` 直传） | B. 全局共享工具（`manifest.tools` 注册） |
|---|---|---|
| 适用场景 | 插件**自己**调用 `ai.call` 时让模型回调本插件的方法 | 把工具**暴露**给 Mulby 内置 AI、其他插件、以及外部 MCP 客户端（Claude / Cursor / Cherry Studio） |
| 是否需要在 `manifest.tools` 声明 | ❌ **不需要** | ✅ **必须**声明 |
| 是否需要调用 `api.tools.register(name, handler)` | ❌ **不需要** | ✅ 必须在 host-worker 内注册 handler |
| 工具命名 | 直接用插件 host 导出的方法名（如 `getSystemInfo`） | 自动包装为 `plugin_tool__{sanitizedPluginId}__{toolName}`（系统会做规范化与重名去重） |
| 工具执行路径 | 宿主收到 AI 的 tool_call 后，按 host RPC 协议直接调用 `host.{toolName}(args)`（不区分前缀，是 toolExecutor 的兜底分支） | 宿主从 `plugin_tool__` 前缀解出 sanitizedId，查 `PluginToolRegistry` 还原原始 pluginId，调用对应插件 host-worker 内 `register` 注册的 handler |
| 工具可见性 | 仅在本次 `ai.call` 调用中对 AI 模型可见 | 全局可见：Mulby 内置 AI / 其他插件的 AI 调用 / 外部 AI 客户端（通过 MCP Server）都能看到 |
| 是否可被用户禁用 | 否（每次 `ai.call` 时动态传入） | 是（设置中按 `pluginId:toolName` 禁用，影响所有调用方） |
| 进度上报通道 | 暂不支持中途进度（仅 `tool-call`/`tool-result` chunk） | 通过 handler 第二参数 `ctx.sendProgress(...)` 上报，对应 `chunkType: 'tool-progress'` |

> **结论**：如果你只是想让 AI 在本插件内调用一两个本地方法，请使用方式 A，**不要**画蛇添足往 `manifest.tools` 加声明。`manifest.tools` 是用来"对外公开"的契约，只有当你希望其他插件、设置面板里的 AI 助手、外部 Claude/Cursor 等也能发现并调用这个工具时，才需要它。

---

### 方式 A：插件内部使用 `option.tools`

工具仅对本次 `ai.call` 可见，工具名直接对应插件 `main.ts` 中导出的方法。`docs/apis/host.md` 详细介绍了 host 方法的导出方式（直接导出 / `export const host = {...}` / `export const api = {...}`）。

```ts
// main.ts （插件后端，运行在 host-worker）
export const host = {
  async getSystemInfo(context: PluginContext) {
    const os = require('node:os')
    return { platform: os.platform(), release: os.release() }
  },

  async runWithTools(context: PluginContext, input: { messages: AiMessage[] }) {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'getSystemInfo',           // 直接是 host 的方法名，无前缀
          description: '获取系统信息',
          parameters: { type: 'object', properties: {} }
        }
      }
    ]

    return await context.api.ai.call({
      model: 'openai:gpt-4o-mini',
      messages: input.messages,
      tools,
      maxToolSteps: 20
    })
  }
}
```

**UI 进程触发后端：**

```ts
const result = await window.mulby.host.call('my-plugin', 'runWithTools', {
  messages: [{ role: 'user', content: '我的系统信息是什么？' }]
})
```

> 实现细节：宿主的 `setAiToolExecutor` 在分发工具调用时会优先匹配内置工具（`mulby_*`）、MCP 工具（`mcp__*`）、注册的插件工具（`plugin_tool__*`）；都不命中时，**兜底**直接通过 `hostManager.callHostMethod(pluginName, name, [args])` 调用同名 host 方法。这就是方式 A 不需要任何注册的原因——只要 `option.toolContext.pluginName` 携带（`api.ai.call` 自动注入），AI 选择的工具名就会被路由到该插件的 host RPC。

---

### 方式 B：通过 `manifest.tools` 暴露给所有 AI

适用于把工具公开给生态，例如：你写了一个二维码插件，希望 Mulby 设置里的 AI 助手、其他插件的 AI、Claude Desktop / Cursor 都能调用 `qrcode.generate`。

**Step 1：在 `manifest.json` 声明 schema**

```json
{
  "name": "qrcode",
  "tools": [
    {
      "name": "generate",
      "description": "Generate a QR code from text",
      "inputSchema": {
        "type": "object",
        "properties": {
          "text": { "type": "string" },
          "size": { "type": "number" }
        },
        "required": ["text"]
      }
    }
  ]
}
```

**Step 2：在 host-worker（`main.ts`）注册 handler**

```ts
mulby.tools.register('generate', async (args, ctx) => {
  ctx?.sendProgress({ progress: 1, total: 4, message: '准备文件' })
  // ...
  ctx?.sendProgress({ progress: 4, total: 4, message: '完成' })
  return { dataUrl: '...' }
})
```

> `mulby.tools.register` 必须在 host-worker 内调用（即插件 `main.ts` 运行的 UtilityProcess）。在主进程兜底实现里 `tools.register` 是空操作，这是设计如此（详见 `src/main/plugin/api.ts` 的 740 行附近注释）。

**Step 3：自动生效**

注册成功后，工具会以 `plugin_tool__qrcode__generate` 名称：
- 自动加入 Mulby 内置 AI 工具池（其他插件 / 设置面板 AI 也可见）；
- 通过 MCP Server 同步给外部 AI 客户端（如 Claude Desktop、Cursor）。

**接收进度事件：**

流式 `ai.call(option, onChunk)` 在工具执行期间会收到 `chunkType: 'tool-progress'`：

```ts
await ai.call(option, (chunk) => {
  if (chunk.chunkType === 'tool-progress') {
    console.log(chunk.tool_progress)
  }
})
```

`tool_progress` 包含 `{ id?, name, progress, total?, message? }`。同一进度也会在该工具被外部 MCP 客户端调用时转发为 MCP progress notification。

---

### 速记决策

- **只想让 AI 调一下我的本地函数** → 方式 A，`option.tools` 直接传，不碰 manifest。
- **想让别人也能用我这个工具** → 方式 B，写 `manifest.tools` + `register`。
- **不确定？** → 先方式 A，等需要对外暴露时再升级到方式 B。

### 内置工具能力（Capabilities）

`option.capabilities` 接受以下能力名（见 `src/main/ai/tools/capabilities.ts`），命中后会按需注入对应的 Mulby 内置工具。每个能力都对应一个内置工具：

| Capability | 对应工具名 | 说明 | 高风险 |
|--------|----------|------|---|
| `shell.exec` | `mulby_run_command` | 执行外部命令 | ✓ |
| `shell.script` | `mulby_run_script` | 执行已注册脚本 | ✓ |
| `fs.read` | `mulby_read_file` | 读取文件 | |
| `fs.list` | `mulby_list_dir` | 列出目录 | |
| `fs.search` | `mulby_search_text` | 文本搜索 | |
| `patch.apply` | `mulby_apply_patch` | 应用 unified diff | ✓ |
| `http.fetch` | `mulby_http_fetch` | HTTP 请求 | ✓ |
| `web.search` | `mulby_web_search` | 联网搜索 | |
| `web.fetch` | `mulby_web_fetch` | 抓取网页（Markdown） | |
| `git.status` | `mulby_git_status` | git status | ✓ |
| `git.diff` | `mulby_git_diff` | git diff | ✓ |
| `skill.activate` | `mulby_activate_skill` | 加载 Skill 正文 | |

> 高风险能力默认会被宿主安全策略拦截，必须在 `toolingPolicy.capabilityAllowList` 中显式放行才能在本次会话使用，详见下文「网络搜索工具设置」末尾的示例。

> 插件承载的 AI 还需要插件 manifest 显式声明对应权限。命令型能力（`shell.exec`、`shell.script`、`git.status`、`git.diff`、`patch.apply`）要求 `permissions.commandExecution.ai.enabled: true`；旧版 `permissions.runCommand: true` 只授权插件代码直接调用命令，不授权 AI 生成命令。

> 插件可以通过 [`directoryAccess.request()`](./directory-access.md) 动态申请用户目录。`read` 授权会扩展插件承载 AI 的 `fs.read` / `fs.list` / `fs.search` / `git.status` / `git.diff` 可访问 root；`readwrite` 授权还会扩展 `patch.apply`、`shell.exec`、`shell.script` 的可写 root。目录授权不替代上面的 `commandExecution.ai`。

> `internalTools` 字段已废弃，新代码请使用 `capabilities`。两者的别名兼容映射定义于 `src/main/ai/tools/capabilities.ts`（如 `runcommand` → `shell.exec`、`websearch` → `web.search`）。

### 彻底禁用工具（纯文本翻译/安全限制场景）

当需要确保 AI 仅进行纯文本输出（如：划词翻译功能的背景对话流），并且要求**严格防止 prompt 注入攻击诱导模型执行内部命令**时，必须显式禁用系统内的所有工具注入引擎。简单将 `tools` 置空或设置 `maxToolSteps` 为 0 是**无效的**（默认机制会自动注入并保留插件工具）。

必须传入如下全维度的禁用配方：

```ts
const response = await ai.call({
  messages: [...],
  // 1. 阻止请求任何内部能力（FS读写、Shell执行等）
  capabilities: [],
  // 2. 彻底关闭内部工具与当前插件的外部工具挂载
  toolingPolicy: { enableInternalTools: false },
  // 3. 关闭动态 MCP 插件挂载能力
  mcp: { mode: 'off' },
  // 4. 关闭动态技能触发能力
  skills: { mode: 'off' }
});
```

---

## 模型管理

### allModels(filter?)
[Renderer] [Backend]
返回当前可用模型列表（含设置中定义的模型）。可传入可选过滤条件，按端点类型、能力或 Provider 精确筛选。

```javascript
// 获取全部模型（无过滤）
const models = await ai.allModels();

// 只获取图像生成模型
const imageModels = await ai.allModels({ endpointType: 'image-generation' });

// 只获取 Jina 重排序模型
const rerankModels = await ai.allModels({ endpointType: 'jina-rerank' });

// 只获取有视觉能力的模型（单值或多值均可）
const visionModels = await ai.allModels({ capability: 'vision' });

// 按多个端点类型筛选（数组形式）
const textModels = await ai.allModels({ endpointType: ['openai', 'anthropic', 'gemini'] });

// 按 Provider ID 筛选
const providerModels = await ai.allModels({ providerId: 'my-openai-instance' });
```

**参数**：`filter` (AiModelsFilter, 可选)

```typescript
interface AiModelsFilter {
  /**
   * 按端点类型筛选（单值或多值）。
   * 枚举值：'openai' | 'openai-response' | 'anthropic' | 'gemini' | 'image-generation' | 'jina-rerank'
   */
  endpointType?: AiEndpointType | AiEndpointType[]
  /**
   * 按能力筛选（单值或多值），满足任意一个即包含。
   * 枚举值：'text' | 'vision' | 'file' | 'reasoning' | 'image-generation' | ...
   */
  capability?: AiModelType | AiModelType[]
  /**
   * 按 Provider 实例 ID 精确筛选。
   */
  providerId?: string
}
```

**返回值**: `Promise<AiModel[]>`

> **提示**：端点类型由用户在 AI 设置 → 模型管理中为每个模型配置，对所有 Provider 类型均可设置。图像生成插件建议使用 `{ endpointType: 'image-generation' }` 筛选，重排序插件使用 `{ endpointType: 'jina-rerank' }`，避免展示不兼容的模型。

### models.fetch(input)
[Renderer]
按 Provider 协议能力拉取模型列表；不支持自动发现时会返回空列表或回退到内置模型，并附带 `message`。

> 仅系统渲染窗口可用，用于设置页 Provider 管理；插件 UI/后端不应调用。

```javascript
const result = await ai.models.fetch({
  providerId: 'openai',
  baseURL: 'https://api.deepseek.com/',
  apiKey: 'sk-xxx'
});
```

**参数**:
- `providerId` (string) - Provider 实例 ID（或 provider 类型）
- `baseURL` (string, optional)
- `apiKey` (string, optional)

**返回值**:
- `{ models: AiModel[]; message?: string }`

> 说明：是否支持 `models.fetch` 取决于 Provider 协议能力。

---

## 连接测试

### testConnection(input?)
[Renderer]
使用 `ping` 消息进行快速连通性测试。

> 仅系统渲染窗口可用，用于设置页/首次引导页验证 Provider 配置；插件 UI/后端不应调用。

```javascript
const result = await ai.testConnection({
  providerId: 'openai',
  model: 'openai:deepseek-chat',
  baseURL: 'https://api.deepseek.com/',
  apiKey: 'sk-xxx'
});
```

**返回值**:
- `{ success: boolean; message?: string }`

### testConnectionStream(input, onChunk)
[Renderer]
流式测试连接（可返回 reasoning 片段）。

> 仅系统渲染窗口可用，用于设置页 Provider 调试；插件 UI/后端不应调用。

```javascript
const req = ai.testConnectionStream(
  {
    providerId: 'openai',
    model: 'openai:deepseek-chat',
    baseURL: 'https://api.deepseek.com/',
    apiKey: 'sk-xxx'
  },
  (chunk) => {
    if (chunk.type === 'reasoning') console.log('[thinking]', chunk.text);
    if (chunk.type === 'content') console.log('[content]', chunk.text);
  }
);

req.abort?.();
```

**返回值**:
- `AiPromiseLike<{ success: boolean; message?: string; reasoning?: string }>`

> 说明：当 Provider 走 OpenAI 兼容协议并命中兼容路由时，会使用 `/chat/completions` 流式接口。

---

## 设置与配置

### settings.get()
[Renderer]
读取 AI 设置。

> 仅系统渲染窗口可用。AI 设置包含 Provider、API Key、MCP、Skills 等宿主级配置，不向插件开放。

```javascript
const settings = await ai.settings.get();
```

**返回值**: `AiSettings`

### settings.update(next)
[Renderer]
更新 AI 设置（部分更新）。

> 仅系统渲染窗口可用。插件需要发起 AI 调用时应通过 `ai.call` 的参数请求能力，不应修改宿主全局设置。

```javascript
await ai.settings.update({
  providers: [
    { id: 'openai', label: 'DeepSeek', enabled: true, baseURL: 'https://api.deepseek.com/', apiKey: 'sk-xxx' }
  ]
});
```

**返回值**: `AiSettings`

> 设置文件位置：`<userData>/ai/settings.json`

---

## MCP 管理

> 可用端：仅系统渲染进程 `window.mulby.ai.mcp`。  
> 插件后端 `context.api.ai` 当前不提供 `mcp.*` 管理接口（但 `ai.call` 可使用 `option.mcp` 参与工具选择）。
> 插件 UI 即使能看到该命名空间，IPC 层也会拒绝调用。

### mcp.listServers()
[Renderer]
获取 MCP 服务器列表。

```javascript
const servers = await ai.mcp.listServers();
```

### mcp.getServer(serverId)
[Renderer]
读取单个 MCP 服务器配置。

```javascript
const server = await ai.mcp.getServer('filesystem');
```

### mcp.upsertServer(server)
[Renderer]
创建或更新 MCP 服务器。

```javascript
await ai.mcp.upsertServer({
  id: 'filesystem',
  name: 'Filesystem',
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/you/workspace'],
  isActive: false
});
```

```javascript
await ai.mcp.upsertServer({
  id: 'weather-http',
  name: 'Weather HTTP',
  type: 'streamableHttp',
  baseUrl: 'http://127.0.0.1:3000/mcp',
  headers: { Authorization: 'Bearer xxx' },
  isActive: false
});
```

### mcp.removeServer(serverId)
[Renderer]
删除服务器配置并断开连接。

```javascript
await ai.mcp.removeServer('filesystem');
```

### mcp.activateServer(serverId)
[Renderer]
启动并连接 MCP 服务器。

```javascript
await ai.mcp.activateServer('filesystem');
```

### mcp.deactivateServer(serverId)
[Renderer]
停止 MCP 服务器连接。

```javascript
await ai.mcp.deactivateServer('filesystem');
```

### mcp.restartServer(serverId)
[Renderer]
重启 MCP 服务器。

```javascript
await ai.mcp.restartServer('filesystem');
```

### mcp.checkServer(serverId)
[Renderer]
执行连通性检查（会尝试连通并拉取工具列表）。

```javascript
const check = await ai.mcp.checkServer('filesystem');
// { ok: boolean, message?: string }
```

### mcp.listTools(serverId)
[Renderer]
获取服务器工具列表（应用工具策略过滤后）。

```javascript
const tools = await ai.mcp.listTools('filesystem');
```

### mcp.abort(callId)
[Renderer]
中止进行中的 MCP 工具调用。

```javascript
await ai.mcp.abort(callId);
```

### mcp.getLogs(serverId)
[Renderer]
读取 MCP 服务器日志。

```javascript
const logs = await ai.mcp.getLogs('filesystem');
```

> `installSource = 'protocol'` 且 `isTrusted !== true` 的服务器属于未信任状态，启动/重启/连通性检查/工具调用会被拦截。

---

## 技能管理 (skills)

> 系统渲染进程：`window.mulby.ai.skills`（完整管理接口）  
> 插件后端：`context.api.ai.skills`（仅 `listEnabled` 与 `previewForCall`）
> 插件 UI 不允许调用完整管理接口（安装、删除、启停、解析全局 Skill 配置等）。

### skills.list()
### skills.refresh()
### skills.listEnabled()
### skills.get(skillId)
[Renderer]

```javascript
const all = await ai.skills.list();
const enabled = await ai.skills.listEnabled();
const one = await ai.skills.get('my-skill-id');
```

### skills.install(input)
### skills.remove(skillId)
### skills.enable(skillId)
### skills.disable(skillId)
[Renderer]

```javascript
await ai.skills.install({
  source: 'npx',
  ref: '@openai/codex-agent-skill-example',
  enabled: true
});
```

### skills.preview(input)
### skills.resolve(option)
[Renderer]
预览/解析本次调用会启用的技能与策略合并结果。

```javascript
const preview = await ai.skills.preview({ prompt: '帮我写一个 React 组件' });
const resolved = await ai.skills.resolve({
  messages: [{ role: 'user', content: '请帮我审查代码' }]
});
```

### skills.listEnabled()
### skills.previewForCall(input)
[Backend]

```javascript
const enabled = await context.api.ai.skills.listEnabled();
const preview = await context.api.ai.skills.previewForCall({
  prompt: '帮我写一个脚本'
});
```

---

## 附件 (多模态 / 文件)

### attachments.upload(input)
[Renderer] [Backend]
上传文件或二进制数据，返回可在消息中引用的 `attachmentId`。

系统渲染窗口可以传入 `filePath`：

```javascript
const image = await ai.attachments.upload({
  filePath: '/path/to/image.png',
  mimeType: 'image/png',
  purpose: 'vision'
});
```

插件 UI/后端需要传入 `buffer`，不要传 `filePath`：

```javascript
// 插件 UI：来自 <input type="file"> / 拖拽文件
const buffer = await file.arrayBuffer();
const image = await window.mulby.ai.attachments.upload({
  buffer,
  mimeType: file.type || 'application/octet-stream',
  purpose: 'vision'
});
```

```javascript
// 插件后端：先通过已授权的 filesystem 能力读取，再上传 buffer
const bytes = context.api.filesystem.readFile('/path/to/authorized-image.png');
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const image = await context.api.ai.attachments.upload({
  buffer,
  mimeType: 'image/png',
  purpose: 'vision'
});
```

**参数**:
- `filePath` (string, optional) - 仅系统渲染窗口可用
- `buffer` (ArrayBuffer, optional) - 插件 UI/后端推荐方式
- `mimeType` (string)
- `purpose` (string, optional)

**返回值**: `AiAttachmentRef`

### attachments.get(attachmentId)
[Renderer] [Backend]
获取附件元信息。

```javascript
const info = await ai.attachments.get(attachmentId);
```

**返回值**: `AiAttachmentRef | null`

### attachments.delete(attachmentId)
[Renderer] [Backend]
删除附件。

```javascript
await ai.attachments.delete(attachmentId);
```

**返回值**: `void`（插件后端返回 `Promise<void>`）

### attachments.uploadToProvider(input)
[Renderer] [Backend]
将已上传的附件进一步上传到指定 Provider 的文件服务，返回 `fileId/uri`。

```javascript
const remote = await ai.attachments.uploadToProvider({
  attachmentId,
  providerId: 'anthropic'
});
```

**参数**:
- `attachmentId` (string)
- `model` (string, optional)
- `providerId` (string, optional)
- `purpose` (string, optional)

**返回值**:
```typescript
{
  providerId: string;
  fileId: string;
  uri?: string;
}
```

> 附件存储目录：`<userData>/ai/attachments`

---

## Token 估算

### tokens.estimate(input)
[Renderer] [Backend]
估算 token 数量（输入使用分词器，输出可基于实际输出文本或上限估算）。

```javascript
const tokens = await ai.tokens.estimate({
  model: 'openai:gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }]
});

// 基于实际输出文本估算（推荐用于“完成后计算”）
const tokens2 = await ai.tokens.estimate({
  model: 'openai:gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
  outputText: 'Hi there!'
});
```

**参数**：
- `model` (string, optional) - 模型 ID，未传时使用全局默认模型
- `messages` (AiMessage[]) - 待估算的对话消息
- `attachments` (AiAttachmentRef[], optional) - 附件引用（影响输入 token）
- `outputText` (string, optional) - 已知的输出文本，用于精确计算 `outputTokens`

**返回值**:
```typescript
{
  inputTokens: number;
  outputTokens: number;
}
```

**说明**:
- `outputText` 传入时，`outputTokens` 会按实际输出文本分词计算。
- `outputText` 未传时，`outputTokens` 会使用 `maxOutputTokens`（若开启）或启发式估算。
- 插件后端类型签名为 `{ model: string; messages: AiMessage[]; attachments?: AiAttachmentRef[] }`，未在类型上声明 `outputText`。如需在后端使用实际输出文本估算，可通过类型断言传入；运行时会被透传到底层估算逻辑。

---

## 图片生成 / 编辑

### images.generate(input)
[Renderer] [Backend]
生成图片（返回 base64 数据）。

```javascript
const result = await ai.images.generate({
  model: 'openai:gpt-image-1',
  prompt: 'A cute cat in watercolor style',
  size: '1024x1024',
  count: 1
});
```

**返回值**: `{ images: string[]; tokens: AiTokenBreakdown }`

### images.generateStream(input, onChunk)
[Renderer] [Backend]
流式生成图片，过程中会推送进度与预览片段。

```javascript
const req = ai.images.generateStream(
  {
    model: 'openai:gpt-image-1',
    prompt: 'A cute cat in watercolor style',
    size: '1024x1024',
    count: 1
  },
  (chunk) => {
    if (chunk.type === 'status') console.log(chunk.stage, chunk.message);
    if (chunk.type === 'preview') console.log('preview base64 length:', chunk.image?.length || 0);
  }
);

req.abort?.();
```

**返回值**: `AiPromiseLike<{ images: string[]; tokens: AiTokenBreakdown }>`

### images.edit(input)
[Renderer] [Backend]
基于图片附件编辑生成。

```javascript
const result = await ai.images.edit({
  model: 'openai:gpt-image-1',
  imageAttachmentId: image.attachmentId,
  prompt: 'Add a red scarf'
});
```

**返回值**: `{ images: string[]; tokens: AiTokenBreakdown }`

---

## 数据结构

### AiMessage
```typescript
type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content?: string | AiMessageContent[];
  reasoning_content?: string;
  /**
   * 流式事件类型（仅 onChunk 过程中出现），用于统一
   * meta / text / reasoning / tool-call / tool-progress / tool-result / error / end 协议。
   */
  chunkType?:
    | 'meta'
    | 'text'
    | 'reasoning'
    | 'tool-call'
    | 'tool-progress'
    | 'tool-result'
    | 'error'
    | 'end';
  capability_debug?: {
    requested: string[];
    allowed: string[];
    denied: string[];
    reasons: string[];
    selectedSkills?: { id: string; source: string; trustLevel: string }[];
  };
  policy_debug?: {
    skills: {
      requested?: AiSkillSelection;
      selectedSkillIds: string[];
      selectedSkillNames: string[];
      reasons: string[];
    };
    mcp: { requested?: AiMcpSelection; resolved?: AiMcpSelection };
    toolContext: { requested?: AiToolContext; resolved?: AiToolContext };
    capabilities: { requested: string[]; resolved: string[] };
    internalTools: { requested: string[]; resolved: string[] };
  };
  tool_call?: { id: string; name: string; args?: unknown };
  tool_progress?: {
    id?: string;
    name: string;
    progress: number;
    total?: number;
    message?: string;
  };
  tool_result?: { id: string; name: string; result?: unknown };
  error?: {
    message: string;
    code?: string;
    category?: string;
    retryable?: boolean;
    statusCode?: number;
  };
  usage?: AiTokenBreakdown;
};
```

### AiMessageContent
```typescript
type AiMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; attachmentId: string; mimeType?: string }
  | { type: 'file'; attachmentId: string; mimeType?: string; filename?: string };
```

### AiTool
```typescript
type AiTool = {
  type: 'function';
  function?: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    required?: string[]; // 旧字段，建议改用 parameters.required
  };
};
```

### AiOption
```typescript
type AiOption = {
  model?: string;
  messages: AiMessage[];
  tools?: AiTool[];
  capabilities?: string[];
  internalTools?: string[]; // 已废弃，建议改用 capabilities
  toolingPolicy?: {
    enableInternalTools?: boolean;
    capabilityAllowList?: string[];
    capabilityDenyList?: string[];
  };
  mcp?: AiMcpSelection;
  skills?: AiSkillSelection;
  params?: AiModelParameters;
  toolContext?: AiToolContext;
  maxToolSteps?: number; // 工具调用最大步数，默认 20，最大 100
};
```

### AiModelParameters
```typescript
type AiModelParameters = {
  contextWindow?: number;
  temperatureEnabled?: boolean;
  topPEnabled?: boolean;
  maxOutputTokensEnabled?: boolean;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stopSequences?: string[];
  seed?: number;
};
```

### AiProviderConfig
```typescript
type AiProviderConfig = {
  id: string; // Provider 实例 ID
  type?: string; // Provider 协议类型，不填时向后兼容为 id
  label?: string;
  enabled: boolean;
  apiKey?: string; // 支持单 key 或逗号分隔多 key（支持转义逗号）
  baseURL?: string;
  apiVersion?: string;
  anthropicBaseURL?: string;
  headers?: Record<string, string>;
  defaultModel?: string;
  defaultParams?: AiModelParameters;
};
```

### AiModel
```typescript
type AiEndpointType =
  | 'openai'
  | 'openai-response'
  | 'anthropic'
  | 'gemini'
  | 'image-generation'
  | 'jina-rerank';

type AiModel = {
  id: string; // 形如 "openai:gpt-4o-mini"
  label: string;
  description: string;
  icon?: string;
  providerRef?: string;
  providerLabel?: string;
  endpointType?: AiEndpointType;
  supportedEndpointTypes?: AiEndpointType[];
  params?: AiModelParameters;
  capabilities?: Array<{
    type: 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling' | 'web_search' | 'rerank';
    isUserSelected?: boolean;
  }>;
};
```

### AiSettings
```typescript
type AiSettings = {
  providers: AiProviderConfig[];
  models?: AiModel[];
  defaultModel?: string;
  defaultParams?: AiModelParameters;
  mcp?: AiMcpSettings;
  skills?: {
    enabled: boolean;
    activeSkillIds: string[];
    records: AiSkillRecord[];
  };
};
```

### AiMcpSelection / AiToolContext
```typescript
type AiMcpSelection = {
  mode?: 'off' | 'manual' | 'auto';
  serverIds?: string[];
  allowedToolIds?: string[];
};

type AiToolContext = {
  pluginName?: string;
  internalTag?: string;
  requestId?: string;
  mcpScope?: {
    allowedServerIds?: string[];
    allowedToolIds?: string[];
  };
};
```

### AiMcpServer / AiMcpSettings / AiMcpTool
```typescript
type AiMcpServer = {
  id: string;
  name: string;
  type: 'stdio' | 'sse' | 'streamableHttp';
  isActive: boolean;
  description?: string;
  baseUrl?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  timeoutSec?: number;
  longRunning?: boolean;
  disabledTools?: string[];
  disabledAutoApproveTools?: string[];
  installSource?: 'manual' | 'protocol' | 'builtin';
  isTrusted?: boolean;
  trustedAt?: number;
  installedAt?: number;
};

type AiMcpSettings = {
  servers: AiMcpServer[];
  defaults?: {
    timeoutMs?: number;
    longRunningMaxMs?: number;
    approvalMode?: 'always' | 'auto-approved-only' | 'never';
  };
};

type AiMcpTool = {
  id: string;
  name: string;
  description?: string;
  serverId: string;
  serverName: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

type AiMcpServerLogEntry = {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source?: string;
  data?: unknown;
};
```

### AiSkillSelection / AiSkillRecord / AiSkillPreview
```typescript
type AiSkillSelection = {
  mode?: 'off' | 'manual' | 'progressive';
  skillIds?: string[];
  variables?: Record<string, string>;
};

type AiSkillSource =
  | 'manual'
  | 'local-dir'
  | 'zip'
  | 'npx'
  | 'json'
  | 'builtin'
  | 'system';

type AiSkillTrustLevel = 'untrusted' | 'reviewed' | 'trusted';

type AiSkillMcpPolicy = {
  serverIds?: string[];
  allowedToolIds?: string[];
  blockedToolIds?: string[];
};

type AiSkillMulbyExtensions = {
  mode?: 'manual' | 'auto' | 'both';
  triggerPhrases?: string[];
  capabilities?: string[];
  /** @deprecated Prefer capabilities. */
  internalTools?: string[];
  mcpPolicy?: AiSkillMcpPolicy;
};

type AiSkillDescriptor = {
  id: string;
  name: string;
  /** SKILL.md frontmatter `description`，必填。 */
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  /**
   * SKILL.md frontmatter `allowed-tools`（空格分隔字符串）的标准化结果。
   */
  allowedTools?: string[];
  /** SKILL.md 正文（懒加载）。 */
  promptTemplate?: string;
  /** 解析自 `metadata.mulby.*` 的 Mulby 私有扩展。 */
  mulbyExtensions?: AiSkillMulbyExtensions;

  /** @deprecated 使用 mulbyExtensions.mode */
  mode?: 'manual' | 'auto' | 'both';
  /** @deprecated 使用 mulbyExtensions.triggerPhrases */
  triggerPhrases?: string[];
  /** @deprecated 使用 mulbyExtensions.capabilities */
  capabilities?: string[];
  /** @deprecated 使用 mulbyExtensions.capabilities */
  internalTools?: string[];
  /** @deprecated 使用 mulbyExtensions.mcpPolicy */
  mcpPolicy?: AiSkillMcpPolicy;
};

type AiSkillRecord = {
  id: string;
  source: AiSkillSource;
  origin?: 'system' | 'app';
  readonly?: boolean;
  sourceRef?: string;
  installPath?: string;
  skillMdPath?: string;
  contentHash: string;
  enabled: boolean;
  trustLevel: AiSkillTrustLevel;
  installedAt: number;
  updatedAt: number;
  descriptor: AiSkillDescriptor;
};

type AiSkillPreview = {
  selected: AiSkillRecord[];
  systemPrompt: string;
  mcpImpact: {
    serverIds?: string[];
    allowedToolIds?: string[];
    blockedToolIds?: string[];
  };
  reasons: string[];
};

type AiSkillResolveResult = {
  selectedSkillIds: string[];
  selectedSkillNames: string[];
  selectedSkills?: Array<{ id: string; source: string; trustLevel: string }>;
  availableSkillsPrompt?: string;
  systemPrompts: string[];
  mergedMcp?: AiMcpSelection;
  toolContextPatch?: AiToolContext['mcpScope'];
  capabilities?: string[];
  internalTools?: string[]; // 已废弃
  reasons?: string[];
};
```

### AiTokenBreakdown
```typescript
type AiTokenBreakdown = {
  inputTokens: number;
  outputTokens: number;
};

type AiPromiseLike<T> = Promise<T> & {
  abort: () => void;
};
```

### AiImageGenerateProgressChunk
```typescript
type AiImageGenerateProgressChunk = {
  type: 'status' | 'preview';
  stage?: 'start' | 'partial' | 'finalizing' | 'completed' | 'fallback';
  message?: string;
  image?: string;
  index?: number;
  received?: number;
  total?: number;
};
```

### AiAttachmentRef
```typescript
type AiAttachmentRef = {
  attachmentId: string;
  mimeType: string;
  size: number;
  filename?: string;
  expiresAt?: string;
  purpose?: string;
};
```

---

## 网络搜索工具设置 (tooling.webSearch)

> 可用端：
> - 系统渲染进程：`window.mulby.ai.tooling.webSearch`
>
> 该接口会读写宿主 WebSearch Provider、API Key、自定义搜索源等全局配置，仅设置页可用。插件调用联网搜索应在 `ai.call` 中请求 `web.search` / `web.fetch` 能力。

### tooling.webSearch.get()
[Renderer]
获取当前网络搜索原始配置。返回值与 `AiToolWebSearchSettings` 结构一致：

```typescript
type AiToolWebSearchSettings = {
  /** 当前激活的 Provider ID（如 local-bing / local-google / tavily / jina / custom-xxx） */
  activeProvider: string;
  /** 搜索最大结果数 */
  maxResults: number;
  /** web_fetch 返回内容最大字符数 */
  maxContentLength: number;
  /** 搜索/抓取超时（毫秒） */
  timeoutMs: number;
  /** 内置 API Provider 的独立 Key 存储 */
  providerKeys: { tavily?: string; jina?: string };
  /** Tavily 自定义 Host（默认 https://api.tavily.com） */
  tavilyApiHost?: string;
  /** 本地搜索引擎列表（内置 + 用户自定义） */
  localEngines: LocalSearchEngineConfig[];
  /** 用户自定义 API Provider 列表 */
  customApis: CustomSearchApiConfig[];
  /** 本地搜索是否自动获取各结果链接正文（默认 true） */
  fetchContent?: boolean;
  /** 每条结果正文最大字符数（默认 2000） */
  maxContentPerResult?: number;
  /** 搜索结果域名黑名单 */
  resultDenyHosts?: string[];

  /** @deprecated 使用 activeProvider 替代 */
  provider?: string;
  /** @deprecated 使用 providerKeys.jina 替代 */
  jinaApiKey?: string;
  /** @deprecated 使用 providerKeys.tavily 替代 */
  tavilyApiKey?: string;
};
```

```javascript
const config = await ai.tooling.webSearch.get();
```

**返回值**: `Promise<AiToolWebSearchSettings>`（接口签名为 `Record<string, unknown>`，运行时形状如上）

### tooling.webSearch.update(partial)
[Renderer]
更新网络搜索配置（部分更新）。`providerKeys` 会做浅合并。

```javascript
await ai.tooling.webSearch.update({
  activeProvider: 'local-bing',
  maxResults: 10,
  providerKeys: { tavily: 'tvly-xxx' }
});
```

**参数**:
- `partial` (Partial<AiToolWebSearchSettings>) - 需要更新的字段

**返回值**: `Promise<AiToolWebSearchSettings>` - 更新后的完整配置

### tooling.webSearch.getSettings()
[Renderer]
获取结构化的网络搜索配置，包含当前激活的 provider 和所有可用 provider 列表。

```javascript
const { activeProvider, providers } = await ai.tooling.webSearch.getSettings();
// activeProvider: 'local-ddg'
// providers: [
//   { id: 'local-ddg', name: 'DuckDuckGo', type: 'local' },
//   { id: 'local-bing', name: 'Bing', type: 'local' },
//   { id: 'local-google', name: 'Google', type: 'local' },
//   { id: 'tavily', name: 'Tavily', type: 'api' },
//   { id: 'jina', name: 'Jina', type: 'api' }
// ]
```

**返回值**:
```typescript
{
  activeProvider: string;
  providers: Array<{
    id: string;
    name: string;
    type: 'local' | 'api' | 'custom';
  }>;
}
```

### tooling.webSearch.setActiveProvider(providerId)
[Renderer]
切换当前激活的搜索 provider。会校验 `providerId` 合法性，非法值不会写入。

```javascript
const result = await ai.tooling.webSearch.setActiveProvider('local-bing');
// { success: true, activeProvider: 'local-bing' }
```

**参数**:
- `providerId` (string) - 目标 provider ID（如 `local-ddg`、`tavily`、`custom-xxx`）

**返回值**:
```typescript
{
  success: boolean;
  activeProvider: string;  // 操作后的实际 activeProvider
}
```

> **注意**：`web.search` / `web.fetch` 能力受宿主默认的安全策略限制（默认拦截）。要在插件侧主动开启此能力，不仅要在调用时声明需求，还必须通过 `toolingPolicy.capabilityAllowList` 进行**会话级越权放行**，否则会被拦截（Blocked by default policy）。
>
> 完整传参示例：
> ```javascript
> await ai.call({
>   model: 'openai:gpt-4o',
>   messages: [{ role: 'user', content: '今天的天气？' }],
>   capabilities: ['web.search', 'web.fetch'], // 1. 声明本对话需要这些能力
>   toolingPolicy: {
>     capabilityAllowList: ['web.search', 'web.fetch'] // 2. 绕过宿主默认策略，强行对本会话放行
>   }
> });
> ```

---

## 插件工具管理 (tooling.pluginTools)

> 可用端：
> - 系统渲染进程：`window.mulby.ai.tooling.pluginTools`
>
> 该接口读写全局插件工具禁用列表，仅设置页可用。

### tooling.pluginTools.getDisabled()
[Renderer]
获取当前被禁用的插件工具列表。

```javascript
const disabled = await ai.tooling.pluginTools.getDisabled();
// ['my-plugin:toolA', 'my-plugin:toolB']
```

**返回值**: `Promise<string[]>` - 禁用的插件工具 key 列表，格式为 `"pluginId:toolName"`

### tooling.pluginTools.setDisabled(disabledList)
[Renderer]
设置被禁用的插件工具列表（全量替换）。

```javascript
const saved = await ai.tooling.pluginTools.setDisabled([
  'my-plugin:toolA',
  'another-plugin:someAction'
]);
```

**参数**:
- `disabledList` (string[]) - 要禁用的插件工具 key 列表，格式为 `"pluginId:toolName"`

**返回值**: `Promise<string[]>` - 持久化后的禁用列表（归一化后）

---

## 完整示例（多模态 + 流式）

```javascript
module.exports = {
  async run(context) {
    const { ai, filesystem, notification } = context.api;

    // 后端插件不要向 AI 附件上传传 filePath。先在授权范围内读取文件，再传 buffer。
    const bytes = filesystem.readFile('/path/to/authorized-image.png');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const attachment = await ai.attachments.upload({
      buffer,
      mimeType: 'image/png',
      purpose: 'vision'
    });

    const req = ai.call(
      {
        model: 'openai:gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image' },
              { type: 'image', attachmentId: attachment.attachmentId, mimeType: 'image/png' }
            ]
          }
        ]
      },
      (chunk) => {
        // 流式输出
        process.stdout.write(chunk.content || '');
      }
    );

    const final = await req;
    await filesystem.writeFile('/tmp/ai-result.txt', final.content || '');
    await notification.show('AI 完成');
  }
};
```

---

## MCP Server 管理（`ai.mcpServer`）

Mulby 可作为 MCP Server 运行，将插件注册的 AI 工具暴露给 Claude Desktop、Cursor 等外部 AI 工具。

> **注意**：MCP Server 管理 API 是**宿主级**能力，仅在设置页面等系统上下文中使用，**不向插件开放**。

### `ai.mcpServer.getState()`

获取 MCP Server 运行状态。

**返回值**：

```typescript
{
  status: 'stopped' | 'starting' | 'running' | 'error'
  port: number
  address?: string      // 运行时的完整 URL
  toolCount: number     // 已注册工具数
  error?: string        // 错误信息（status 为 error 时）
  startedAt?: number    // 启动时间戳
}
```

### `ai.mcpServer.start()`

启动 MCP Server（需先在设置中启用）。

### `ai.mcpServer.stop()`

停止 MCP Server。

### `ai.mcpServer.restart()`

重启 MCP Server（配置变更后使用）。

### `ai.mcpServer.regenerateToken()`

重新生成认证 Token。

**返回值**：`{ token: string }`

> ⚠️ 重新生成 Token 后，所有已配置的客户端需要更新 Token 才能重新连接。

### `ai.mcpServer.getTools()`

获取当前已注册到 MCP Server 的工具列表。

**返回值**：

```typescript
Array<{
  mcpToolName: string   // MCP 协议中的工具名（如 mulby__qrcode__generate）
  pluginId: string      // 原始插件 ID
  toolName: string      // 插件内的工具名
  pluginName: string    // 插件显示名
}>
```

### `ai.mcpServer.getClientConfig()`

获取客户端配置示例（供用户复制粘贴到客户端配置文件）。

**返回值**：

```typescript
{
  claudeDesktop: object  // Claude Desktop 配置 JSON
  cursor: object         // Cursor 配置 JSON
  cherryStudio: object   // Cherry Studio 配置 JSON（含 isActive 字段）
  generic: object        // 通用配置（含 name / type / url / token）
}
```

> 端口在运行时使用实际绑定的端口；停止时使用配置端口。

### `ai.mcpServer.refreshTools()`

手动刷新 MCP Server 的工具列表（通常在插件变更时自动触发）。

### `ai.mcpServer.getConfig()`

获取 MCP Server 配置信息（含 token/port/enabled + stdioBridgePath）。

**返回值**: `Promise<{ enabled: boolean, port: number, token: string, stdioBridgePath: string }>`

### `ai.mcpServer.updatePort(port)`

更新 MCP Server 监听端口（需要重启生效）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `port` | `number` | 端口号（1024-65535） |
