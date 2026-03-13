# AI Skills 集成方案（基于 `src/main/ai`）

## 1. 目标与范围

目标：在现有 AI + MCP 架构上，增加统一的 Skills 能力，覆盖：
- 创建（Create）
- 安装（Install）
- 管理（Manage）
- 预览（Preview）
- 插件中的 AI 调用（Plugin AI invoke）

约束：
- 不破坏现有 `ai.call`、`option.mcp`、插件工具调用链。
- 安全默认收敛：默认最小权限、显式启用、可审计。
- 与 MCP 解耦但可联动（Skill 声明 MCP 依赖/策略）。

## 2. 2025-2026 最佳实践摘要（落地结论）

- Skills 应是“能力包”，不是纯 prompt 字符串。
- Skill 包应包含可解析元数据（`SKILL.md`）+ 可选资源目录。
- 运行时要有“解析层”（Resolver）：
  - 输入用户请求与上下文
  - 输出本次调用的 skill 注入内容 + 工具/MCP 限制
- 安全必须分层：
  - 安装信任（来源与内容）
  - 首次启用确认
  - 运行时审批（高风险工具）
- MCP 与 Skills 分工：
  - Skills：行为策略与任务模板
  - MCP：外部能力执行

## 3. 现状对齐（本项目）

已有能力（可复用）：
- `AiService` 已支持工具循环、`toolContext`、MCP 工具并入。
- `AiMcpService` 已支持 server/tool 管理、调用、日志、信任门控。
- `plugin/api.ts` 已把插件名注入 `toolContext.pluginName`，主进程可做统一策略校验。

缺口：
- 无 Skills 数据模型与持久化。
- 无 Skills 安装/解析/预览 API。
- `ai.call` 无 `skills` 选择参数。
- 无 Skills 管理页面。

## 4. 目标架构

### 4.1 主进程模块（新增）

目录建议：`src/main/ai/skills/`

- `types.ts`
  - Skill 领域模型、解析结果、预览结果、安装来源等。
- `store.ts`
  - 读写 Skills 配置与索引（与 `ai/settings.json` 协同）。
- `parser.ts`
  - 解析 `SKILL.md`（YAML failsafe + 宽松恢复）。
- `installer.ts`
  - 本地目录/zip/git/marketplace 安装。
- `registry.ts`
  - 技能清单、版本、状态（enabled/disabled/trusted）。
- `resolver.ts`
  - 根据 `ai.call` 输入解析本次生效技能（manual/auto）。
- `preview.ts`
  - 生成“本次注入预览”与策略摘要。
- `policy.ts`
  - 技能可声明的 MCP 作用域、工具策略、审批策略合并规则。

### 4.2 与 `AiService` 集成点

在 `src/main/ai/service.ts` 中，新增流程（位于 `resolveMergedTools` 前）：

1. 解析 `option.skills`
2. 调用 `aiSkillService.resolveForAiCall(...)`
3. 产物合并：
   - `skillSystemMessages` 注入 messages（system 段）
   - `skillToolHints` 合并到工具选择（包括 MCP allowlist）
   - `skillMcpSelection` 与 `option.mcp` 做交集合并（不做放权）
4. 再进入现有 MCP/tool merge + tool loop

### 4.3 与 MCP 的关系（关键）

- Skill 可以声明：
  - 需要的 MCP server IDs
  - 允许/禁止的 MCP tool IDs
  - 建议审批等级（只可收紧，不可放宽）
- 真正执行前仍由 `AiMcpService` 与主进程策略最终裁决。

## 5. 数据模型（提案）

```ts
type AiSkillSource = 'manual' | 'local-dir' | 'zip' | 'git' | 'marketplace' | 'builtin'
type AiSkillTrustLevel = 'untrusted' | 'reviewed' | 'trusted'

interface AiSkillDescriptor {
  id: string
  name: string
  description?: string
  version?: string
  author?: string
  tags?: string[]
  triggerPhrases?: string[]
  mode?: 'manual' | 'auto' | 'both'
  promptTemplate?: string
  mcpPolicy?: {
    serverIds?: string[]
    allowedToolIds?: string[]
    blockedToolIds?: string[]
    requireApproval?: 'always' | 'never' | 'auto'
  }
}

interface AiSkillRecord {
  id: string
  source: AiSkillSource
  sourceRef?: string
  installPath: string
  skillMdPath: string
  contentHash: string
  enabled: boolean
  trustLevel: AiSkillTrustLevel
  installedAt: number
  updatedAt: number
  descriptor: AiSkillDescriptor
}

interface AiSkillSettings {
  enabled: boolean
  activeSkillIds: string[]
  autoSelect: {
    enabled: boolean
    maxSkillsPerCall: number
    minScore: number
  }
  records: AiSkillRecord[]
}

interface AiSkillSelection {
  mode?: 'off' | 'manual' | 'auto'
  skillIds?: string[]
  variables?: Record<string, string>
}
```

`AiSettings` 扩展：
- `skills?: AiSkillSettings`

`AiOption` 扩展：
- `skills?: AiSkillSelection`

## 6. API 设计

### 6.1 Renderer API（`window.mulby.ai.skills`）

- `list(): Promise<AiSkillRecord[]>`
- `get(skillId): Promise<AiSkillRecord | null>`
- `create(input): Promise<AiSkillRecord>`（创建脚手架）
- `importFromJson(input): Promise<AiSkillRecord[]>`
- `install(input: { source: 'local-dir'|'zip'|'git'|'marketplace'; ref: string }): Promise<AiSkillRecord[]>`
- `update(skillId, patch): Promise<AiSkillRecord>`
- `remove(skillId): Promise<void>`
- `enable(skillId): Promise<AiSkillRecord>`
- `disable(skillId): Promise<AiSkillRecord>`
- `preview(input): Promise<AiSkillPreview>`
- `resolveForPrompt(input): Promise<{ selected: AiSkillRecord[]; reason: string[] }>`

### 6.2 Plugin Backend API（`context.api.ai`）

新增两类能力：
- 调用时选择 skills：
  - `ai.call({ ..., skills: { mode, skillIds, variables } })`
- 只读查询（不开放安装管理）：
  - `ai.skills.listEnabled()`
  - `ai.skills.previewForCall(optionFragment)`

说明：
- 插件传入的 skills/mcp 仅是“请求”，主进程按全局与插件策略裁剪后生效。

## 7. 安装与创建流程

### 7.1 创建（Create）

- UI 向导生成目录：
  - `SKILL.md`
  - `resources/`（可选）
  - `examples/`（可选）
- 提供模板：
  - 通用分析
  - 代码审查
  - 数据提取
  - MCP 工具编排

### 7.2 安装（Install）

支持：
- 本地目录
- ZIP 包
- Git 仓库（可选分支/tag）
- Marketplace（后续可接）

安装时：
1. 解析 `SKILL.md`
2. 展示预览（元数据、声明的 MCP 作用域、提示词摘要）
3. 首次信任确认
4. 写入 `userData/ai/skills/<skillId>/...`
5. 更新索引

## 8. 预览（Preview）设计

预览返回：
- 生效技能列表（含来源、版本、信任）
- 将注入的 system 片段（截断显示）
- MCP 影响（新增/收紧了哪些 server/tool 范围）
- 风险标签（例如“需要 stdio 命令执行权限”）
- 最终合并后 `AiOption` 快照（脱敏）

## 9. 安全与审批

与现有 MCP 信任流一致并扩展到 Skills：

1. 安装信任
- `untrusted` 默认禁用。
- 启用前必须二次确认。

2. 首次启用拦截
- 显示 skill 摘要 + MCP 权限影响 + 命令预览（如果涉及 stdio MCP）。

3. 运行时审批
- 技能若要求高风险工具，进入审批流程（可按 tool 配置自动批准例外）。

4. 防注入与供应链控制
- YAML failsafe 解析。
- 计算并存储 `contentHash`，升级/变更触发重新审阅。
- 预览中默认隐藏敏感变量值（仅显示键）。

## 10. UI 信息架构（不挤占 AiSettingsView）

新增页面：`AiSkillsSettingsView`

入口：
- `AiSettingsView` 中新增 “Skills 管理” 按钮，跳转到独立页面（同 MCP 页面风格）。

页面分区：
- 左侧：已安装技能列表（状态/来源/版本/风险标签）
- 右侧 Tab：
  - 概览与元数据
  - MCP 策略
  - Prompt 预览
  - 测试调用（输入 prompt -> 看 resolve 结果）
- 顶部操作：
  - 新建
  - 导入（JSON/ZIP/Git）
  - 刷新索引

## 11. 兼容与迁移

- 默认 `skills.enabled = false`，老调用不变。
- 未传 `option.skills` 时：
  - 若用户全局开启 autoSelect，可按阈值自动选技能；
  - 否则不启用。
- 插件无需立刻改造；增量支持 `option.skills` 即可。

## 12. 测试计划

### Unit
- `SKILL.md` 解析与容错
- 选择器（manual/auto）与评分阈值
- skills+mcp 策略合并（交集原则）
- 信任状态机（install -> reviewed -> trusted）

### Integration
- `ai.call` + skills + stdio MCP 联调
- `ai.call` + skills + streamableHttp MCP 联调
- 插件 `context.api.ai.call` 触发 skills 并执行 MCP 工具

### E2E
- UI 创建/导入/启用/预览/调用闭环
- 首次启用拦截 + 审批弹窗流程

## 13. 分期实施建议

### Phase 1（2~3 次迭代）
- 数据模型 + store + parser + registry
- `AiOption.skills` + `AiService` resolve 注入
- Skills 管理页（安装/启用/禁用/预览）
- 插件侧 `ai.call` 支持 `skills`

### Phase 2
- auto-select（语义匹配/embedding）
- git/marketplace 安装链路
- 运行时审批细粒度策略

### Phase 3
- 版本升级策略（pin/range）
- skill 依赖管理
- 可观测性（命中率、失败率、审批统计）

