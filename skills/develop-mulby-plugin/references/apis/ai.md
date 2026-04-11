# AI API (ai)
本文档描述 AI API (ai) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.ai`
> - 插件后端：`context.api.ai`

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

工具调用仅在插件后端执行（`context.api.ai`）。工具函数名需要对应插件后端导出方法名，导出方式可参考 `docs/apis/host.md`（直接导出 / host 对象 / api 对象等）。

### 插件后端示例

```ts
// main.ts (插件后端)
export const host = {
  async getSystemInfo(context: PluginContext) {
    const os = require('node:os');
    return {
      platform: os.platform(),
      release: os.release()
    };
  },

  async runWithTools(context: PluginContext, input: { messages: AiMessage[] }) {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'getSystemInfo',
          description: '获取系统信息',
          parameters: { type: 'object', properties: {} }
        }
      }
    ];

    return await context.api.ai.call({
      model: 'openai:gpt-4o-mini',
      messages: input.messages,
      tools,
      maxToolSteps: 20  // 设置最大工具调用步骤数为 20
    });
  }
};
```

### UI 调用插件后端

```ts
// UI/渲染进程
const result = await window.mulby.host.call('my-plugin', 'runWithTools', {
  messages: [{ role: 'user', content: '我的系统信息是什么？' }]
});
```

---

## 模型管理

### allModels()
[Renderer] [Backend]
返回当前可用模型列表（含设置中定义的模型）。

```javascript
const models = await ai.allModels();
```

**返回值**: `Promise<AiModel[]>`

### models.fetch(input)
[Renderer]
按 Provider 协议能力拉取模型列表；不支持自动发现时会返回空列表或回退到内置模型，并附带 `message`。

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

```javascript
const settings = await ai.settings.get();
```

**返回值**: `AiSettings`

### settings.update(next)
[Renderer]
更新 AI 设置（部分更新）。

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

> 可用端：仅渲染进程 `window.mulby.ai.mcp`。  
> 插件后端 `context.api.ai` 当前不提供 `mcp.*` 管理接口（但 `ai.call` 可使用 `option.mcp` 参与工具选择）。

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

> 渲染进程：`window.mulby.ai.skills`（完整管理接口）  
> 插件后端：`context.api.ai.skills`（仅 `listEnabled` 与 `previewForCall`）

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

```javascript
const image = await ai.attachments.upload({
  filePath: '/path/to/image.png',
  mimeType: 'image/png',
  purpose: 'vision'
});
```

**参数**:
- `filePath` (string, optional)
- `buffer` (ArrayBuffer, optional)
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

**返回值**: `void`

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
  chunkType?: 'meta' | 'text' | 'reasoning' | 'tool-call' | 'tool-result' | 'error' | 'end';
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

type AiSkillRecord = {
  id: string;
  source: 'manual' | 'local-dir' | 'zip' | 'json' | 'builtin' | 'system';
  origin?: 'system' | 'app';
  readonly?: boolean;
  sourceRef?: string;
  installPath?: string;
  skillMdPath?: string;
  contentHash: string;
  enabled: boolean;
  trustLevel: 'untrusted' | 'reviewed' | 'trusted';
  installedAt: number;
  updatedAt: number;
  descriptor: {
    id: string;
    name: string;
    description?: string;
    version?: string;
    author?: string;
    tags?: string[];
    triggerPhrases?: string[];
    promptTemplate?: string;
    mcpPolicy?: {
      serverIds?: string[];
      allowedToolIds?: string[];
      blockedToolIds?: string[];
    };
    capabilities?: string[];
    internalTools?: string[]; // 已废弃
  };
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

### AiSkillCreateWithAiInput / AiSkillCreateProgressChunk
```typescript
type AiSkillCreateModelOption = {
  id: string;
  label: string;
  providerRef?: string;
  providerLabel?: string;
};

type AiSkillCreateWithAiInput = {
  requirements: string;
  model: string;
  previousRawText?: string;
  replaceSkillId?: string;
  enabled?: boolean;
  trustLevel?: 'untrusted' | 'reviewed' | 'trusted';
};

type AiSkillCreateWithAiResult = {
  record: AiSkillRecord;
  generation: {
    model: string;
    rawText: string;
    notes?: string[];
  };
};

type AiSkillCreateProgressChunk = {
  type: 'status' | 'content' | 'reasoning';
  text: string;
  stage?: 'generating' | 'parsing' | 'validating' | 'writing' | 'completed';
  stageStatus?: 'start' | 'done' | 'error';
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
> - 渲染进程：`window.mulby.ai.tooling.webSearch`

### tooling.webSearch.get()
[Renderer]
获取当前网络搜索原始配置。

```javascript
const config = await ai.tooling.webSearch.get();
```

**返回值**: `Record<string, unknown>`

### tooling.webSearch.update(partial)
[Renderer]
更新网络搜索配置（部分更新）。

```javascript
await ai.tooling.webSearch.update({
  activeProvider: 'local-bing',
  maxResults: 10
});
```

**参数**:
- `partial` (Record<string, unknown>) - 需要更新的字段

**返回值**: `Record<string, unknown>` - 更新后的完整配置

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
> - 渲染进程：`window.mulby.ai.tooling.pluginTools`

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

    const attachment = await ai.attachments.upload({
      filePath: '/path/to/image.png',
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
    filesystem.writeFile('/tmp/ai-result.txt', final.content || '');
    notification.show('AI 完成');
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
  generic: object        // 通用配置（含 url 和 token）
}
```

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

