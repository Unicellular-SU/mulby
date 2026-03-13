# AI 工具能力模型对齐改造计划（会话能力优先）

## 背景
当前实现已经引入 capability 层与内部工具映射，但与“AI 会话具备工具能力，skill 只是提示与策略输入”这一模型仍有偏差：

1. `reviewed/system` skill 会被误判为网络 skill，导致 `shell.exec` 被默认拒绝。
2. 自动注入能力逻辑仍偏向 skills（命令意图兜底仅在 skills 分支触发）。
3. 在未显式声明 capability 的情况下，普通 AI 会话默认不会启用内置能力（除非调用方手动设 `toolingPolicy.enableInternalTools=true`）。

## 目标

1. 将“能力主体”统一为 AI 会话；skills 仅影响能力请求与策略决策。
2. 修复网络 skill 判定，避免把 `system/reviewed` 当作网络来源。
3. 在不破坏现有安全边界（sandbox + allow/prompt/deny + 审计）的前提下，让普通 AI 与 skills 走同一能力决策路径。
4. 保持用户自定义工具调用能力不变。

## 设计决策

1. 网络 skill 判定规则收敛：
- 视为“网络/低信任”的条件：`trustLevel=untrusted` 或 `source in ['zip','json']`。
- `source=system/local-dir/manual/builtin` 且 `trustLevel=reviewed/trusted` 不再按网络最小权限处理。

2. 默认能力请求策略统一：
- 当调用方未显式请求 capability 且未显式禁用内部工具（`toolingPolicy.enableInternalTools !== false`）时，按策略基线自动请求能力。
- 基线选择仍由策略层决定（app / skill / network skill）。
- 为避免干扰“仅自定义 tools”的场景：当调用方已经传入 `option.tools` 时，不做这一步自动请求。

3. 命令意图兜底不再依赖 skills：
- 将命令意图识别从 skills 专用改为会话通用（只要消息里出现命令执行意图即可请求 `shell.exec`，最终是否放行仍由 capability policy 决定）。

4. 安全层保持不变：
- 所有命令执行仍统一经过 `commandRunnerService` 的策略校验、用户确认、审计链路。

## 变更清单

1. `src/main/ai/tools/capability-policy.ts`
- 调整 `isNetworkSkill` 判定逻辑。
- 调整“未声明 capability 时的默认请求”逻辑：不再仅限 `selectedSkills.length===0` + 手动显式开启。
- 增加对 `option.tools` 场景的保护（避免无意注入）。

2. `src/main/ai/service.ts`
- 将 `shouldAutoInjectRunCommandForSkills` 改为会话级命令意图判断函数。
- 调整 fallback 触发条件：不再依赖是否选中 skill。

3. `src/main/ai/__tests__/capabilities.test.ts`
- 新增/调整用例，覆盖：
  - `system + reviewed` skill 不再被按 network 限制。
  - 未显式 capability 时，普通 AI 调用可按默认策略请求能力。
  - 传入 `option.tools` 时，不做默认能力自动请求。

4. 文档同步
- 更新 `docs/apis/shell.md` 中“与 AI Skills 联动”表述，改为“AI 会话工具能力 + skills 影响策略输入”的模型说明，避免“只有 skills 才注入 run_command”的误导。

## 验证计划

1. 类型检查：`npm run -s typecheck`
2. AI 工具相关测试：`node --import tsx --test src/main/ai/__tests__/*.test.ts`
3. 人工验证（ai-api-test）：
- 普通 AI 调用 + 开启工具：可触发内置工具。
- system/reviewed skill（如 find-skills）在允许策略下可调用命令工具。
- zip/json skill 默认仍走最小权限，未授权时不放行 `shell.exec`。
