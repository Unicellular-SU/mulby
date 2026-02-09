# AI API (ai)
本文档描述 AI API (ai) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.intools.ai`
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
  - `mcp` (AiMcpSelection) - MCP 工具选择策略（可选）
  - `toolContext` (AiToolContext) - 工具执行上下文（可选）
  - `maxToolSteps` (number) - 工具调用的最大步骤数（默认 10，范围 1-20）

**返回值**:
- `Promise<AiMessage>` - 最终消息（包含可选 `usage`）
- 渲染进程返回的 Promise 附带 `abort()` 方法（仅 `onChunk` 模式有效）

```javascript
const req = ai.call(
  {
    model: 'openai:gpt-4o-mini',
    messages: [{ role: 'user', content: 'Tell me a joke.' }]
  },
  (chunk) => console.log(chunk.content)
);

// 中止（仅渲染进程）
req.abort?.();
```

> 说明：`tools` 在插件后端会通过插件 host 方法执行（工具名=插件方法名）。  
> 渲染进程不直接执行工具函数，如需在 UI 使用工具调用，请通过 `window.intools.host.call` 调用插件后端方法执行。

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
const result = await window.intools.host.call('my-plugin', 'runWithTools', {
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
从 OpenAI 兼容接口拉取模型列表。

```javascript
const result = await ai.models.fetch({
  providerId: 'openai',
  baseURL: 'https://api.deepseek.com/',
  apiKey: 'sk-xxx'
});
```

**参数**:
- `providerId` (string) - 当前仅支持 `openai`
- `baseURL` (string, optional)
- `apiKey` (string, optional)

**返回值**:
- `{ models: AiModel[]; message?: string }`

> 说明：当 `providerId !== 'openai'` 时返回空列表并给出提示。

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
- `Promise<{ success: boolean; message?: string; reasoning?: string }>`

> 说明：当 `providerId = 'openai'` 且 `baseURL` 不是 `api.openai.com` 时，会使用兼容的 `/chat/completions` 流式接口。

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

> 可用端：仅渲染进程 `window.intools.ai.mcp`。  
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
  usage?: { inputTokens: number; outputTokens: number };
};
```

### AiMessageContent
```typescript
type AiMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; attachmentId: string; mimeType?: string }
  | { type: 'file'; attachmentId: string; mimeType?: string; filename?: string };
```

### AiOption
```typescript
type AiOption = {
  model?: string;
  messages: AiMessage[];
  tools?: AiTool[];
  mcp?: AiMcpSelection;
  params?: AiModelParameters;
  toolContext?: AiToolContext;
  maxToolSteps?: number;  // 工具调用的最大步骤数，默认为 10
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
  id: string;
  label?: string;
  enabled: boolean;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  defaultModel?: string;
  defaultParams?: AiModelParameters;
};
```

### AiModel
```typescript
type AiModel = {
  id: string; // 形如 "openai:gpt-4o-mini"
  label: string;
  description: string;
  icon?: string;
  providerLabel?: string;
  params?: AiModelParameters;
};
```

### AiSettings
```typescript
type AiSettings = {
  providers: AiProviderConfig[];
  models?: AiModel[];
  defaultParams?: AiModelParameters;
  mcp?: AiMcpSettings;
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
