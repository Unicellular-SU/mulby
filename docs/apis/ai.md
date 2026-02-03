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
  - `onChunk` (function) - 流式回调 (可选)

**返回值**:
- `Promise<AiMessage>` - 最终消息
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
      tools
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

> 附件存储目录：`<userData>/ai/attachments`

---

## Token 估算

### tokens.estimate(input)
[Renderer] [Backend]
估算输入 token 数量（当前为近似估算）。

```javascript
const tokens = await ai.tokens.estimate({
  model: 'openai:gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }]
});
```

**返回值**:
```typescript
{
  inputTokens: number;
  outputTokens: number;
}
```

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

## 视频生成

### videos.generate(input)
[Renderer] [Backend]
视频生成（当前实现会抛出 “Video generation is not supported yet”）。

```javascript
await ai.videos.generate({
  model: 'openai:sora-1',
  prompt: 'A drone flying over mountains',
  duration: 5,
  size: '1280x720'
});
```

---

## 数据结构

### AiMessage
```typescript
type AiMessage = {
  role: 'system' | 'user' | 'assistant';
  content?: string | AiMessageContent[];
  reasoning_content?: string;
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
  params?: AiModelParameters;
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
