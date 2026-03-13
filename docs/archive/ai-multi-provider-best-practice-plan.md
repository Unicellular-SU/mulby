# AI 多 Provider / 多 Model 最佳实践改造计划

## 目标

将当前 AI 模块从“少量硬编码 provider + OpenAI-compatible 兜底”升级为“内置多 provider + 可扩展 provider + 统一模型解析与能力治理”的架构，降低兼容性风险并提升可维护性。

## 当前进展（2026-02-06）

- Phase 1（架构骨架）：已落地基础 provider catalog 与 provider type 推断、registry/factory 迁移。
- Phase 2（配置升级）：已落地 `AiProviderConfig.type` / `AiModel.providerRef`，并在读取与保存时自动归一化兼容旧配置。
- Service 编排：已把主要 provider 判定从 `provider.id` 切换到 `provider.type`（推断值），支持同类型多实例。
- Provider Adapter：已新增 `providerAdapterCatalog`，集中管理 provider 协议策略（OpenAI-compatible、chat/completions 路由、models.fetch 能力、file service 类型）。
- Provider Runtime：已新增 `providerRuntime`，统一 provider 实例化与 `language/image model key` 解析，`AiService` 解析路径显著收敛。
- Provider Methods：已新增 `providerMethodAdapters`，`call/stream/images/fetchModels` 已通过 adapter methods 执行分发（而非 `AiService` 内散点分支）。
- UI 配置页：已支持 provider `type + 实例 id` 双字段，模型绑定优先 `providerRef`。
- UI 校验反馈：已加入 Provider 实时校验与能力门控（重复实例 ID、缺少 API Key、缺少必要 Base URL；测试连接/拉取模型按钮按能力自动禁用）。
- Shared Validation：已抽取 `src/shared/ai/providerType.ts` + `src/shared/ai/providerValidation.ts`，主进程与 UI 共用同一套 provider 校验与类型推断规则。
- Unit Tests：已新增 `providerMethodAdapters` 单元测试，覆盖 call/stream 路由决策与 fetchModels 能力门控。
- Phase 4（已完成核心项）：`models.fetch` 已升级为“endpoint + parser”声明式发现策略，并支持 provider-specific 多 endpoint fallback；parser 已细化覆盖非标准 payload（如 `result.list`、`model/name/slug` 字段）；provider capability 已通过 shared profile 声明并接入能力合并逻辑，UI 已新增 provider 能力矩阵与能力来源标记（profile 禁用 / 配置缺失 / 模型决定）。
- 来源判定统一：已新增 shared `providerCapabilityGovernance`，UI 能力矩阵与主进程门控日志均复用同一来源分类函数（profile/config/model）。
- Phase 5（进行中）：主进程流式回调已统一 chunk 事件协议（`text/reasoning/tool-call/tool-result/error/end`），DeepSeek 工具调用策略已下沉为 provider feature flag（`requiresReasoningReplayOnToolCalls`），并新增统一异常归因错误码与结构化流式指标日志（`stream:metrics:start/end`）。
- 后续待推进：按 Phase 3/4 拆分 adapter、统一 provider capability 声明与 models.fetch 能力门控。

## 当前现状（基于项目代码）

- Provider 构建仍以硬编码 `switch` 为主，仅内置 `openai/anthropic/google`。
- 模型拉取流程仅支持 OpenAI-compatible `/models` 风格接口。
- Provider 与 Model 的绑定依赖 `providerLabel`（可读性强，但稳定性弱，重命名后存在错绑风险）。
- 已有较好基础：
  - `AiSettingsView` 支持多 Provider、多 Model 配置。
  - `capabilityInference + cherryStudioCatalog` 已具备能力推断框架。
  - 主流程已支持工具调用、图片、流式、reasoning 展示。

## 设计原则（最佳实践）

- 单一职责：Provider 注册、Model 解析、能力治理、请求编排分层实现。
- 显式能力：能力不靠猜测，provider/model feature flag 先声明后启用。
- 可演进：内置 provider 与自定义 provider 共用一套注册与解析协议。
- 向后兼容：保留现有配置读取能力，采用迁移策略平滑升级。
- 失败隔离：某个 provider 适配异常不影响其他 provider。

## 总体方案分层

### 1. Provider 层（注册与实例化）

- 建立 `provider catalog`（内置 provider 清单）：
  - 例：`openai`, `openai-chat`, `openai-compatible`, `anthropic`, `google`, `deepseek`, `openrouter`。
- 建立 `ProviderFactory` + `ProviderRegistry`：
  - 统一注册、启停、别名、按类型实例化。
  - 避免在业务层直接 `switch(provider.id)`。
- 自定义 provider 采用 schema 校验后注册（禁止与内置 ID 冲突）。

### 2. Model 层（模型解析与能力声明）

- 引入统一 `ModelResolver`：
  - 支持 `provider:model`（兼容现状）与可扩展命名空间形式。
- Model 绑定字段从展示用 `providerLabel` 过渡到稳定键 `providerRef`（内部用）。
- 能力治理采用“两级合并”：
  - provider 级 capability（协议能力）
  - model 级 capability（模型能力）
  - 最终 capability = provider ∩ model，再叠加用户手动覆写。

### 3. Adapter 层（接口协议适配）

- 每个 provider 提供独立 Adapter，至少包含：
  - `chat/call`
  - `chat/stream`
  - `images.generate/edit`（支持则实现）
  - `models.fetch`（支持则实现）
  - `attachments.upload`（支持则实现）
- OpenAI-compatible 仅作为一个 adapter，不再承担所有厂商协议分歧。
- 将特殊兼容策略下沉到 adapter/feature flag（例如 reasoning replay、stream_options 支持）。

### 4. Service 层（统一编排）

- `AiService` 仅做编排：
  - 解析模型 -> 选择 adapter -> 执行请求 -> 统一 chunk 事件与 usage 输出。
- 业务层禁止直接拼接供应商 URL 与协议字段。
- 统一错误模型（可重试、鉴权、限流、协议不支持、模型不存在等）。

### 5. 配置与 UI 层

- 配置模型升级：
  - `AiProviderConfig`: 增加 `type`（provider 实现类型）与 `id`（实例 ID）区分。
  - `AiModel`: 增加 `providerRef`（内部绑定），`providerLabel` 仅用于展示。
- `AiSettingsView` 调整：
  - 新增 Provider 时选择 `type`（实现）与 `id/label`（实例标识）。
  - 拉模型按钮调用 provider adapter 的 `models.fetch` 能力（按能力显示）。

## 分阶段实施计划

## Phase 1: 架构骨架

- 交付：
  - `provider-catalog.ts`
  - `provider-registry.ts`
  - `provider-factory.ts`
- 验收：
  - 不改业务逻辑情况下完成 provider 实例创建迁移。
  - 现有 `openai/anthropic/google` 全部可用。

## Phase 2: 配置模型升级（向后兼容）

- 交付：
  - 新版配置 schema（`providerRef` 等字段）
  - 配置迁移器（旧数据自动迁移）
- 验收：
  - 老用户无需手动重配即可继续使用。
  - 重命名 provider label 不影响模型绑定。

## Phase 3: Adapter 化改造

- 交付：
  - `OpenAIAdapter`、`AnthropicAdapter`、`GoogleAdapter`、`OpenAICompatibleAdapter`
  - 至少一个新增 adapter（建议 `DeepSeekAdapter`）
- 验收：
  - `AiService` 中 provider 特判显著减少。
  - 各 adapter 可独立单测。

## Phase 4: 多模型发现与能力治理

- 交付：
  - `models.fetch` adapter 接口与 UI 能力门控
  - provider/model capability 合并逻辑
- 验收：
  - 不同 provider 的模型发现逻辑可并行扩展。
  - 能力判断从“散点特判”转为“声明式判断”。

## Phase 5: 流式与工具调用稳定性专项

- 交付：
  - 标准 chunk 规范（text/reasoning/tool-call/tool-result/error/end）
  - provider 级 feature flags（如 `requiresReasoningReplayOnToolCalls`）
- 验收：
  - DeepSeek reasoner、OpenAI-compatible 常见供应商的工具流式稳定运行。
  - ai-api-test 页面实时显示一致。

### Phase 5 准备状态（2026-02-06）

- 已具备统一 provider 能力门控与来源日志，可在流式/工具调用异常时快速判断是 profile 限制、配置缺失还是模型层行为。
- `call/stream/fetchModels` 的 adapter 路由与 discovery 逻辑已有单元测试，可在 Phase 5 中聚焦流式 chunk 协议一致性与 tool loop 稳定性。

### Phase 5 当前进度（2026-02-06）

- 已完成：`AiMessage` 增加 `chunkType` 与工具/错误事件字段，`aiService.stream` 全链路按统一 chunk 事件发出；结束事件通过 `chunkType=end` 输出 usage，不重复正文。
- 已完成：tool loop 决策抽到 `toolLoopStrategy`，并通过 provider feature flags 声明 DeepSeek 推理模型必须走 reasoning replay 兼容分支。
- 已完成：`ai-api-test` 流式工具调用面板支持基于 `chunkType` 的回显（包含 error/end 处理）。
- 已完成：新增 `streamChunkProtocol` 与 `toolLoopStrategy` 单元测试，覆盖 chunk 规范与 compat tool loop 路由决策。
- 已完成：补充 stream/tool-call 的细粒度回归测试（多步工具、reasoning 与正文交错、异常中断、abort）与验收脚本。
- 已完成：新增 shared `streamDiagnostics`，将 stream/tool 异常统一归类为错误码（如 `AI_STREAM_ABORTED`、`AI_STREAM_TOOL_EXECUTION_ERROR`、`AI_STREAM_HTTP_4XX/5XX` 等），并在 error chunk 回传错误码元数据。
- 已完成：新增 `streamMetrics`，对流式请求输出结构化统计（provider/model/route、chunk 计数、字符计数、耗时、usage、异常分类），日志统一为 `stream:metrics:start/end` 与 `stream:error`。
- 已完成：工具执行异常统一包装为 `[AI_TOOL_EXECUTION_ERROR]` 前缀，确保 SDK tool 与 compat tool loop 两条链路可被同一分类器稳定识别。
- 产物：`scripts/phase5-regression.sh`、`docs/archive/2026-03-doc-cleanup/phase5-stream-tool-regression-checklist.md`。

## Phase 6: 测试与发布治理

- 交付：
  - 单元测试：resolver/registry/adapter
  - 集成测试：call/stream/tools/images
  - 文档：provider 接入规范
- 验收：
  - 关键路径具备自动化回归。
  - 新增 provider 的接入步骤标准化（1 个模板 + 1 套测试）。

## 风险与控制

- 风险：改造期回归导致现有用户配置失效。
  - 控制：先做迁移器与双读策略，再切换 UI 写入格式。
- 风险：多 provider 特性差异导致逻辑膨胀。
  - 控制：差异全部下沉 adapter + feature flag，不进入业务层 if-else。
- 风险：能力推断不准导致功能误开/误关。
  - 控制：推断仅默认值，保留用户手动覆写优先级。

## 建议优先级

- P0（立即）：Phase 1 + Phase 2（先把地基和配置稳定性做好）。
- P1（近期）：Phase 3 + Phase 5（把高频故障面先收敛）。
- P2（迭代）：Phase 4 + Phase 6（完善生态扩展和工程治理）。

## 参考（对标思路）

- Cherry Studio 的关键启发：
  - 内置 provider 清单 + 可扩展注册
  - 注册表与模型解析器解耦
  - provider 特性通过选项/补丁能力声明，而非业务层硬编码堆叠
