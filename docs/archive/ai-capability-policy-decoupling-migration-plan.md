# AI Capability Policy 解耦与平滑迁移方案

## 1. 背景

当前配置页里存在两类能力授权入口：

1. 按 Skill 管理能力矩阵
2. 按 source（manual/zip/json...）批量管理能力矩阵

这与目标模型不一致：**工具能力属于 AI 运行时底层能力，Skill 只是提示词/上下文增强，不应成为能力授权的核心维度**。

本方案目标是把授权模型收敛为：

- 全局能力策略（默认能力 + 全局 allow/deny）
- 会话级临时策略（capabilityAllowList/capabilityDenyList）
- 独立命令安全层（sandbox + allow/prompt/deny + audit）

同时保证历史配置可平滑过渡，不出现突然“全放开”或“全失效”。

## 2. 目标与非目标

### 2.1 目标

1. 设置页移除 Skill/source 维度授权矩阵。
2. 能力策略解耦为 AI 全局能力策略。
3. 兼容历史配置（含 `grants.skillId/source`）并提供可追踪迁移。
4. 保持现有 `shell:runCommand` 安全链路不变。

### 2.2 非目标

1. 不改 AI 工具执行协议（tool call / tool result）。
2. 不改 runCommand 的安全审计模型。
3. 不在本次迁移中删除旧字段（先弃用，后清理）。

## 3. 目标状态（Target State）

能力裁决只看：

1. `defaultAppCapabilities`
2. `globalGrants`（全局 allow/deny，不带 skillId/source）
3. `option.toolingPolicy.capabilityAllowList/capabilityDenyList`

Skill/source 不再参与能力裁决；Skill 仅影响：

1. system prompt 注入
2. 可选 MCP 作用域约束
3. 业务侧解释/推荐

## 4. 数据结构迁移设计

## 4.1 新结构（在 `AiToolCapabilityPolicySettings` 中新增）

```ts
interface AiToolCapabilityPolicySettings {
  defaultAppCapabilities: string[]
  defaultSkillCapabilities: string[] // 保留兼容，后续可废弃
  defaultNetworkSkillCapabilities: string[] // 保留兼容，后续可废弃
  grants: AiToolCapabilityGrant[] // 旧字段，保留兼容
  globalGrants?: AiToolCapabilityGrant[] // 新字段，仅允许无 skillId/source
  legacy?: {
    hasScopedGrants?: boolean
    scopedGrantCount?: number
    migratedAt?: number
  }
}
```

说明：

1. `globalGrants` 是新主路径。
2. `grants` 进入兼容态，不再作为长期主来源。
3. `legacy` 仅用于提示和观测，不参与权限判断。

## 4.2 启动时迁移规则（`app-settings` normalize 阶段）

1. 若 `globalGrants` 为空：
   1. 从 `grants` 提取“无 skillId/source”的 grant 到 `globalGrants`。
   2. 保留 scoped grant（有 skillId 或 source）在 `grants` 中不丢失。
2. 记录 `legacy.hasScopedGrants/scopedGrantCount/migratedAt`。
3. 全过程不自动把 scoped allow 提升为全局 allow，避免权限意外扩大。

## 5. 运行时裁决迁移（核心）

文件：`src/main/ai/tools/capability-policy.ts`

### 5.1 新裁决优先级（最终形态）

1. session deny
2. global deny
3. session allow
4. global allow
5. baseline（`defaultAppCapabilities`）
6. default deny

### 5.2 平滑过渡（兼容窗口）

增加兼容开关（仅主进程内部使用）：

- `compatEnableScopedGrants`（默认 `true`，过渡期打开）

过渡期优先级：

1. session deny
2. scoped deny（旧逻辑，临时）
3. global deny
4. session allow
5. scoped allow（旧逻辑，临时）
6. global allow
7. baseline
8. default deny

关闭 `compatEnableScopedGrants` 后，即完成彻底解耦。

## 6. 设置页改造

文件：`src/renderer/components/SettingsView.tsx`

## 6.1 删除项

1. 按 Skill 管理能力矩阵
2. 按 source 批量管理能力矩阵
3. 新增 grant 表单中的 targetType=skill/source 选择

## 6.2 保留并增强

1. 全局默认能力（`defaultAppCapabilities`）
2. 全局 grant 列表（仅 capability + decision + expiresAt）
3. 中文说明：
   1. “能力为 AI 全局能力，不按 Skill/source 单独授权”
   2. “历史 scoped 规则仅兼容期生效”

## 6.3 兼容提示 UI

若 `legacy.hasScopedGrants=true`，显示提示卡：

1. 检测到历史 scoped grants 数量
2. 当前版本仍兼容执行（若 compat 开关开启）
3. 后续版本将停用，建议迁移为全局规则

## 7. 测试与验收

## 7.1 单测（主进程）

文件：`src/main/ai/__tests__/capabilities.test.ts`

新增/调整场景：

1. `globalGrants` allow/deny 生效。
2. scoped grants 在 compat=true 时生效。
3. scoped grants 在 compat=false 时不生效。
4. session allow/deny 优先级高于 global。
5. baseline 仍兜底。

## 7.2 设置持久化测试

文件：`src/main/services/app-settings` 对应测试（若无则新增）

场景：

1. 旧配置（仅 grants）加载后自动产生 globalGrants。
2. scoped grants 被统计到 legacy 信息。
3. 不发生权限扩大（scoped allow 不自动升级为全局 allow）。

## 7.3 手工验收

1. 普通 AI 调用在不选 Skill 时仍按全局策略调用工具。
2. Skills 场景（如 find-skills）不再依赖 Skill/source 矩阵也可按全局策略运行。
3. capability 调试面板可看到 requested/allowed/denied/reasons。
4. runCommand 审计、确认弹窗、拦截策略正常。

## 8. 分阶段发布建议

## Phase A（兼容发布）

1. 上线 `globalGrants` + UI 解耦。
2. 保持 `compatEnableScopedGrants=true`。
3. 收集日志：有多少请求仍命中 scoped grants。

## Phase B（默认切换）

1. 将 `compatEnableScopedGrants` 默认设为 `false`。
2. 保留回退开关（紧急情况可临时打开）。

## Phase C（清理）

1. 删除 scoped grants 裁决逻辑。
2. 删除 `defaultSkillCapabilities/defaultNetworkSkillCapabilities`（若确认无业务依赖）。
3. 清理设置页与类型中的废弃字段。

## 9. 风险与控制

1. 风险：历史依赖 Skill/source 的精细规则失效。  
   控制：兼容窗口 + legacy 提示 + 回退开关。

2. 风险：误把局部 allow 升级成全局 allow。  
   控制：迁移时只自动迁移“无作用域 grant”，scoped allow 不自动提升。

3. 风险：用户误解“Skill 不能调用工具”。  
   控制：文案明确“Skill 可触发工具调用，但是否允许由 AI 全局能力策略决定”。

## 10. 实施清单（给接手实现的 AI/工程师）

1. 更新类型：`src/shared/types/settings.ts`
2. 更新设置归一化与迁移：`src/main/services/app-settings.ts`
3. 更新能力裁决：`src/main/ai/tools/capability-policy.ts`
4. 清理设置页矩阵 UI：`src/renderer/components/SettingsView.tsx`
5. 更新测试：`src/main/ai/__tests__/capabilities.test.ts` + 设置迁移测试
6. 更新文档：`docs/apis/shell.md`（策略模型说明）

---

该方案可先“逻辑解耦 + 行为兼容”，再“默认切换 + 最终清理”，可在不破坏现网使用习惯的前提下完成架构收敛。
