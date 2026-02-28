# AI Skills Composer Phase 1 完成说明

## 1. 背景与范围
- 本阶段目标：完成 `Composer` 后端重构，解决 AI 创建 Skill 的大输出截断问题，并为 Phase 2 的会话式 IPC/前端改造提供可复用后端能力。
- 本阶段范围（已完成）：
  - `src/main/ai/skills/composer.ts` 重构为“分阶段生成 + 增量组装”。
  - 增强 prompt 约束，严格遵守 Agent Skills 规范 + Mulby metadata 扩展规则。
  - 引入后端内存会话 `SkillCreationSession`（内部能力，未开放 IPC）。
  - 保持 Service 层与现有 IPC/前端 API 向后兼容。
- 本阶段范围（未做）：
  - 不新增 `ai:skills:*session*` IPC。
  - 不改 `AiSkillsSettingsView.tsx` 为对话式全屏 UI。

## 2. 代码改动清单
- `src/main/ai/skills/composer.ts`
  - 主流程改为 3 段：
    1. 阶段 1：结构规划（`action: full|patch` + `files` 路径规划）。
    2. 阶段 2：逐步补全文件内容（小规模优先批量，失败降级逐文件，最后 repair 兜底）。
    3. 阶段 3：组装校验并落盘（复用 `aiSkillService.createFromGenerated()`）。
  - 新增 patch 合并逻辑（支持 `previousRawText` + `action: patch` + dotted key patches）。
  - 新增 runtime capability introspection 提示（`mulby_describe_runtime_capabilities`）。
  - 生成结果 `generation.rawText` 统一输出为最终完整 JSON（可直接用于下一轮 revision）。
- `src/main/ai/skills/session.ts`（新增）
  - 新增 `SkillCreationSessionStore`：
    - `create/get/appendMessages/setCurrentSkillState/setSkillRecordId/remove/clear`。
    - 支持 TTL 清理与最大会话数限制。
  - 提供 Composer 内部会话状态承载能力（Phase 2 可直接接 IPC）。
- `src/main/ai/skills/creator-resources.ts`
  - `scriptFiles` 从“仅文件名”升级为“文件名 + 完整内容”加载。
  - 便于 system prompt 直接注入内置 `skill-creator` 脚本上下文。
- `src/main/ai/skills/index.ts`
  - 导出 `SkillCreationSession` 相关类型。

## 3. 核心行为变化（前后对比）
- 之前：
  - 主要依赖单次大 JSON 输出，复杂 skill 容易被 token 截断。
  - `skill-creator` 上下文使用片段截断，指导信息利用不足。
- 现在：
  - 默认走“结构先行 + 增量补全文件内容”。
  - 小文件数量场景（默认 <=2）优先批量补全，提高效率；失败自动降级逐文件重试。
  - 保留并强化 `repairFilesWithAi()` 作为最后兜底。
  - 支持 revision patch 合并，减少全量重生成成本。

## 4. 规范与兼容性检查
- 规范约束：
  - frontmatter 只允许 `name/description/license/compatibility/metadata/allowed-tools`（校验仍由 `spec-validator.ts` 执行）。
  - Mulby 扩展仅允许 `metadataMulby.mode/triggerPhrases/capabilities/internalTools/mcpPolicy`。
  - `metadataMulby.capabilities` 继续受 `AI_TOOL_CAPABILITY_NAMES` 约束。
- 兼容性：
  - 未破坏 `createWithAi` / `createWithAiStream` 现有签名与调用方式。
  - 未改 `service.ts` 核心持久化逻辑。

## 5. 测试结果
- 新增测试：
  - `src/main/ai/__tests__/skillsComposer.test.ts`
    - 覆盖分阶段文件补全落盘。
    - 覆盖 `action: patch` + `previousRawText` 修订路径。
  - `src/main/ai/__tests__/skillCreationSessionStore.test.ts`
    - 覆盖会话创建、消息追加、状态写入、TTL/容量淘汰。
- 回归执行：
  - `npm run test:unit`：通过（0 fail）。
  - `npm run typecheck`：通过。

## 6. 已知限制与风险
- 当前 `SkillCreationSession` 尚未通过 IPC 暴露，前端无法真正多轮复用同一后端 session（Phase 2 解决）。
- 阶段 2 文件生成仍以串行为主（稳妥优先），后续可在保持可靠性的前提下增加并行策略。
- `skill-creator` 全量上下文注入会增加提示词长度，后续可做分块按需注入优化（不破坏规范约束）。

## 7. Phase 2 开发输入（直接执行）
### 7.1 目标
- 打通后端 session 能力到 IPC 和 preload，使前端可构建对话式 Skill 创建体验。

### 7.2 建议新增 API（保持兼容，新增不替换）
- `skills.createSession(input?) -> { sessionId, state }`
- `skills.sendMessage(sessionId, message, options?) -> stream`
- `skills.getSession(sessionId) -> state`
- `skills.saveSkillFromSession(sessionId, options?) -> AiSkillRecord`
- 保留现有 `createWithAi/createWithAiStream` 作为兼容入口。

### 7.3 类型与协议建议
- 在 `src/shared/types/ai.ts` 新增 session 类型：
  - `AiSkillCreationSession`
  - `AiSkillSessionMessage`
  - `AiSkillSessionState`
- `AiSkillCreateProgressChunk` 保持兼容，可新增 `substage` 字段以表达 `stage-1/2/3`。

### 7.4 IPC/Preload 接入点
- `src/main/ipc/ai.ts`：新增 `ai:skills:session:*` handlers。
- `src/preload/index.ts`：暴露 `window.mulby.ai.skills.session.*` 调用封装。

### 7.5 前端对接约束（供 Phase 3 参考）
- 继续复用流式 chunk 协议（`status/content/reasoning`）。
- 前端对话消息需保留 `sessionId`，并在每轮消息后更新会话快照。
