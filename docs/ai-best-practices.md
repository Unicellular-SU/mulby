# Mulby 全局 AI 接口最佳实践方案

> 目标：让插件“无感接入”用户在主程序中配置好的 AI 模型与计费/限额策略，减少重复造轮子，同时保持安全、性能和良好体验。

## 1. 方案定位与价值

- **统一配置**：用户只在主程序配置模型与费用，插件直接复用。
- **统一能力**：Function Calling、流式输出、模型列表获取等能力由 Mulby 提供。
- **统一体验**：插件只关注业务逻辑与 UI，不再实现完整 AI SDK 接入。

## 2. 接入能力速览（关键约束）

- `mulby.ai(option[, streamCallback])` 支持流式与非流式。
- `AiOption`：`model?`、`messages`、`tools?`。
- Function Calling 的 **函数必须挂在 `window` 对象** 上。
- 返回类型 `PromiseLike` 支持 `abort()` 中止。
- `mulby.allAiModels()` 可获取模型列表（含 cost）。

## 3. 可复用的开源 npm 库（建议主程序集成）

> 目标：减少重复造轮子，把多模态、流式、工具调用与文件处理能力沉淀在主程序层。

### 3.1 官方/权威 SDK（作为底层 Provider）

- **OpenAI SDK**：`openai`，官方 TS/JS SDK，支持流式与文件上传。
- **Anthropic SDK**：`@anthropic-ai/sdk`，官方 TS/JS SDK。
- **Google GenAI SDK**：`@google/genai`，Google 官方 JS/TS SDK。

### 3.2 Provider 统一层（推荐）

- **Vercel AI SDK Core**：`ai`（Vercel AI SDK Core）提供统一的调用 API。
- **Provider 模块**：如 `@ai-sdk/openai`，用于接入 OpenAI Provider。

### 3.3 Token 估算与文件解析

- **Token 估算**：`js-tiktoken` / `tiktoken`，用于预估 token。
- **文档解析**：LangChain Document Loaders（文件/网页加载器）。

> 建议：主程序优先采用 Vercel AI SDK 作为统一适配层，官方 SDK 作为底层 Provider 依赖与补充能力。

## 4. 推荐总体架构

```
┌──────────────────────────┐
│      Plugin UI Layer      │
│  输入/输出/状态/取消按钮   │
└────────────┬─────────────┘
             │
┌────────────▼─────────────┐
│   AI Orchestrator Layer   │
│  prompt构建/消息合成/策略 │
└────────────┬─────────────┘
             │
┌────────────▼─────────────┐
│   mulby.ai (global AI)  │
│  stream/abort/function    │
└──────────────────────────┘
```

### 核心职责拆分

- **UI 层**：输入校验、流式渲染、错误提示、取消调用。
- **编排层**：组装 messages/tools、模型选择策略、调用封装。
- **调用层**：仅负责调用 `mulby.ai` 并处理 `abort()`。

## 5. 消息与 Prompt 设计规范

### 5.1 分层消息策略

- `system`：角色与边界（例如“只输出 JSON”、“避免私密信息”等）。
- `user`：用户原始意图。
- `assistant`：仅用于多轮上下文追加（避免“记忆污染”）。

### 5.2 可复用模板（建议）

- **系统提示词**：可写成插件内常量，确保一致性。
- **上下文裁剪**：只保留最近 N 轮或关键信息摘要。
- **敏感信息处理**：先脱敏再入 prompt。

## 6. Function Calling 最佳实践

> 当前主进程实现仅保留 tools 定义透传，暂不执行工具调用（后续可加入工具桥接与权限校验）。  

### 6.1 工具设计原则

- **函数粒度小**：一个函数做一件事。
- **参数结构清晰**：使用 JSON Schema 风格定义。
- **描述“意图”而非实现**：让模型理解何时调用。

### 6.2 安全约束

- 只暴露必要的 `window` 函数。
- 在函数实现中做 **参数白名单校验**。
- 对外部 IO（文件/网络）设置限制与确认。

### 6.3 典型流程

1. UI 生成 messages + tools
2. `mulby.ai` 返回 `tool_calls`
3. 运行 `window` 上的函数
4. 将函数结果回填 `messages`
5. 再次调用 `mulby.ai` 产出最终回答

## 7. 模型选择与成本控制

### 7.1 动态模型策略

- 使用 `mulby.allAiModels()` 读取模型及 cost。
- 对 **高成本模型** 增加用户确认或阈值。
- 默认选择“速度快/价格低”的模型，必要时切换。
- 针对多模态任务优先选择支持图像输入的模型；各 provider 能力差异较大，需要能力标签化。

### 7.2 负载与降级

- 超时/失败时回退到更稳定或更便宜模型。
- 对长任务提供“继续/取消/改用轻量模型”提示。

### 7.3 成本估算建议（主程序负责）

- **Token 估算**：使用 `js-tiktoken`/`tiktoken` 对输入进行预估。
- **成本公式**：`总成本 = 输入token * 输入单价 + 输出token * 输出单价 + 附件/生成费用`（主程序内维护价格表）。
- **安全裕量**：估算时加 10%~20% 缓冲，避免超额。
- **成本展示**：在触发高成本模型或大附件上传时提醒用户。

## 8. 流式输出体验

- **实时输出**：流式 chunk 逐步追加到 UI。
- **可取消**：绑定 `abort()` 到“停止”按钮。
- **收尾合并**：流式结束后统一整理展示。

## 9. 错误处理与可用性

- 网络或模型错误：展示明确提示 + 可重试。
- Function Calling 失败：展示“工具调用失败”的结构化信息。
- 超时控制：设置内部超时，提示用户调整输入或模型。

## 10. 数据安全与隐私

- 不将敏感信息写入日志。
- 对敏感输入做提示（例如：包含密码/密钥时提醒）。
- 插件内缓存需标明用途与生命周期。

## 11. 多模态与文件接入的统一方案（建议主程序支持）

> 目标：在保持“统一配置/统一计费/统一权限”的前提下，让插件也能安全使用图片识别、图片生成与文件上传能力。

### 11.1 能力边界与职责

- **主程序负责**：模型路由、附件上传与存储、权限与计费、审计与限额。
- **插件负责**：业务场景编排、输入采集、结果展示、调用时机与交互反馈。

### 11.2 建议的能力扩展方向

- **多模态消息结构**：在 `Message` 中扩展 `content` 为数组，支持文本 + 图片 + 文件引用。
- **附件生命周期**：由主程序提供上传/引用接口，返回可短时访问的引用 ID。
- **统一配额与费用**：主程序基于模型/附件体积/生成图片数量进行成本评估与限制。
- **权限与审计**：插件调用需声明用途，主程序可弹窗确认、记录日志。
- **文件解析器**：主程序可集成通用文档加载器进行文本抽取，供插件复用。

### 11.3 建议的高层流程

1. 插件调用“附件上传”接口（主程序负责存储与安全校验）。
2. 主程序返回 `attachmentId`（或 `fileRef`）给插件。
3. 插件构造 `messages`，在 `content` 中引用该 `attachmentId`。
4. 调用 `mulby.ai`，主程序完成模型适配与推理。
5. 输出结果回到插件 UI。

### 11.4 风险控制要点

- **文件类型白名单**：图片/文档/音频类型在主程序层统一校验。
- **大小与数量限制**：对单文件与总大小设置上限。
- **敏感信息检测**：可在上传阶段进行本地/服务端的风险提示。
- **可追溯性**：记录插件名称、调用时间、模型与附件类型。

### 11.5 插件侧最佳实践

- 上传前提示用户用途与成本。
- 对上传文件做预览与确认。
- 失败时提供“重试/改用文本输入”的降级方案。

## 12. 主进程 AI API 设计草案（面向实现）

> 说明：以下为建议性的主程序 API 设计，保持与 `mulby.ai` 兼容并扩展多模态、附件与成本能力。

### 12.1 基础能力

- `mulby.ai(option[, streamCallback])`：基础聊天/工具调用。
- `mulby.allAiModels()`：模型列表（含 cost 与能力标签）。
- `mulby.ai.abort(requestId)`：中止正在进行的请求（面向多请求并发）。

### 12.2 附件与多模态

- `mulby.ai.attachments.upload({ filePath | blob | buffer, mimeType, purpose })` -> `{ attachmentId, size, mimeType, expiresAt }`
- `mulby.ai.attachments.delete(attachmentId)`
- `mulby.ai.attachments.get(attachmentId)`

### 12.3 费用与配额

- `mulby.ai.cost.estimate({ model, messages, attachments })` -> `{ inputTokens, outputTokens, attachmentCost, totalCost }`
- `mulby.ai.quota.get()` / `mulby.ai.quota.check(cost)`：统一配额与拦截策略

### 12.4 建议的消息结构扩展（草案）

```ts
type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; attachmentId: string; mimeType?: string }
  | { type: "file"; attachmentId: string; mimeType?: string; filename?: string };

interface Message {
  role: "system" | "user" | "assistant";
  content?: string | MessageContent[];
  reasoning_content?: string;
}
```

> 主程序内部可根据 provider 能力映射成不同的多模态输入结构。

### 12.5 图像生成

- `mulby.ai.images.generate({ prompt, model, size, count })` -> `{ images, cost }`
- `mulby.ai.images.edit({ imageAttachmentId, prompt, model })` -> `{ images, cost }`

### 12.6 视频生成（可选）

- `mulby.ai.videos.generate({ prompt, model, duration, size })` -> `{ videos, cost }`

### 12.7 主进程模块结构与伪代码骨架（Vercel AI SDK 适配层）

> 目标：给后续工程落地一个清晰、可扩展的模块骨架。

**推荐目录结构（主进程）**

```
src/main/ai/
  api/                # 对外 API 聚合（mulby.ai.*）
  providers/          # Vercel AI SDK provider 构造与能力配置
  router/             # 模型与能力路由（多模态、工具、成本）
  cost/               # token 估算、价格表、成本计算
  attachments/        # 附件上传、引用、清理
  safety/             # 权限、审计、敏感内容策略
  types/              # 统一类型、能力标签、错误类型
```

**核心数据流（主进程）**

1. Plugin -> `api.ai()`  
2. `router` 选择 provider + model  
3. `cost` 预估与 `quota` 校验  
4. `attachments` 准备与注入多模态消息  
5. `provider` 调用 + `stream` 回传  
6. `safety` 审计记录 + 成本记账  

**伪代码骨架（示意）**

```ts
// src/main/ai/api/index.ts
export async function ai(option: AiOption, onStream?: (m: Message) => void) {
  const requestId = createRequestId();
  const { model, provider } = await router.select(option);
  const cost = await costEstimator.estimate({ model, option });
  await quota.check(cost);

  const prepared = await attachments.prepare(option);
  const stream = provider.call({ model, option: prepared, requestId });

  if (onStream) {
    for await (const chunk of stream) onStream(chunk);
  } else {
    return await stream.toFinal();
  }
}
```

```ts
// src/main/ai/router/index.ts
export async function select(option: AiOption) {
  const caps = capabilityTagger.fromOption(option);
  const model = modelSelector.pick(caps);
  const provider = providerRegistry.get(model.providerId);
  return { model, provider };
}
```

```ts
// src/main/ai/attachments/index.ts
export async function prepare(option: AiOption) {
  if (!hasAttachments(option)) return option;
  const refs = await attachmentStore.resolve(option);
  return injectAttachments(option, refs);
}
```

### 12.8 关键类型定义（建议）

```ts
// src/main/ai/types/core.ts
export type ProviderId = "openai" | "anthropic" | "google" | "custom";

export type CapabilityTag =
  | "chat"
  | "tools"
  | "vision"
  | "image_generation"
  | "video_generation"
  | "json_mode"
  | "long_context";

export interface ModelInfo {
  id: string;
  label: string;
  providerId: ProviderId;
  contextWindow: number;
  capabilities: CapabilityTag[];
  pricing: {
    inputPer1k: number;
    outputPer1k: number;
    imageInput?: number;
    imageOutput?: number;
  };
}

export interface AttachmentRef {
  attachmentId: string;
  mimeType: string;
  size: number;
  filename?: string;
  expiresAt?: string;
  purpose?: "vision" | "file" | "image_edit";
}

export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  attachmentCost: number;
  totalCost: number;
}
```

```ts
// src/main/ai/types/messages.ts
export type MessageContent =
  | { type: "text"; text: string }
  | { type: "image"; attachmentId: string; mimeType?: string }
  | { type: "file"; attachmentId: string; mimeType?: string; filename?: string };

export interface Message {
  role: "system" | "user" | "assistant";
  content?: string | MessageContent[];
  reasoning_content?: string;
}
```

### 12.9 API 接口签名（建议）

```ts
// src/main/ai/api/public.ts
export interface AiOption {
  model?: string;
  messages: Message[];
  tools?: Tool[];
}

export interface AiApi {
  ai(option: AiOption, onStream?: (m: Message) => void): PromiseLike<Message>;
  allAiModels(): Promise<ModelInfo[]>;
  abort(requestId: string): void;

  attachments: {
    upload(input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }): Promise<AttachmentRef>;
    get(attachmentId: string): Promise<AttachmentRef | null>;
    delete(attachmentId: string): Promise<void>;
  };

  cost: {
    estimate(input: { model: string; messages: Message[]; attachments?: AttachmentRef[] }): Promise<CostBreakdown>;
  };

  quota: {
    get(): Promise<{ remaining: number; resetAt?: string }>;
    check(cost: CostBreakdown): Promise<void>;
  };
}
```

### 12.10 Router 与 Provider 适配接口（建议）

```ts
// src/main/ai/router/types.ts
export interface RouterInput {
  option: AiOption;
  preferredModel?: string;
}

export interface RouterResult {
  model: ModelInfo;
  provider: AiProvider;
}

export interface AiProvider {
  id: ProviderId;
  call(input: {
    model: ModelInfo;
    option: AiOption;
    requestId: string;
  }): AsyncIterable<Message> & { toFinal(): Promise<Message> };
}
```

### 12.11 费用与配额实现要点

- `costEstimator` 负责 token 估算与价格表计算，输出 `CostBreakdown`。
- `quota.check` 在调用前进行拦截；调用后按实际输出 tokens 进行结算修正。
- `ModelInfo.pricing` 作为统一的价格表入口，主程序可定期更新。

### 12.12 Provider 能力标签与路由策略

- `capabilityTagger` 从消息内容推断需要能力（如包含 `image` 则需要 `vision`）。
- `modelSelector.pick(caps)`：优先满足能力，再按成本/速度排序。
- 支持 “用户固定模型” 与 “智能选择” 两种模式。

## 13. 质量保障与评估

- 设计“样例用例集”进行回归测试。
- 记录提示词与模型响应，用于调优与 A/B 测试。
- 对核心功能提供“满意/不满意”反馈入口。

## 14. 推荐的最小实现模板

```ts
async function callAi(messages: Message[], tools?: Tool[], onStream?: (m: Message) => void) {
  const option: AiOption = { messages, tools };
  if (onStream) {
    return await mulby.ai(option, onStream);
  }
  return await mulby.ai(option);
}
```

## 15. 插件接入流程建议

1. 明确业务场景与输入输出格式。
2. 设计系统提示词与消息结构。
3. 如需 Function Calling，先设计工具定义与安全校验。
4. 接入 `mulby.ai` 并实现流式 UI。
5. 加入取消、错误提示与降级策略。
6. 用样例用例集验证效果后发布。

---

如需我基于某个具体插件场景继续补充“接入示例代码”或“工具函数设计”，告诉我业务细节即可。
