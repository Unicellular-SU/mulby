# Mulby Vibe Coding 固化流程

> 作者：产品经理（kc-chat agent-2）｜日期：2026-06-02
> 依据：`develop-mulby-plugin` 技能（SKILL.md + references/cli-workflow.md + plugin-development-guide.md）
> 用途：`Mulby 开发者工具` 插件中的 "AI 插件应用创作" 面板遵循此流程，避免 AI 开发插件时混乱。

本流程将技能中的 7 步工作流落地为**面向 Mulby 开发者工具内置 AI 创作**的强制阶段。每个阶段必须在进入下一阶段前完成产出物（gate）。

---

## 阶段 0：需求澄清（Clarify）
逐项确认（缺一不可，未明确则追问，**一次一问**）：
- **插件类型**：工具型 / 效率 / 媒体 / 网络 / AI / 系统 / 其他。
- **目标用户与场景**：谁用、解决什么、典型触发输入。
- **交互方式**：关键词 / 正则 / 文件 / 图片 / 选中文本(over) / 窗口匹配(window)。
- **是否需要 UI**：可视界面？detached 窗口？还是纯命令/silent。
- **是否需要后台**：常驻、定时任务、监听。
- **是否需要 Mulby API**：clipboard / notification / storage / shell / screen / http / features 等。
- **是否需要 AI tools**：是否对外暴露 `manifest.tools` 供 AI Agent 调用。

**Gate 0 产出**：一句话插件定位 + 上述清单的明确答案。

---

## 阶段 1：模板选择（Template）
- **React 模板**：需要可视化 UI / detached 窗口 / 路由 / 复杂交互。
- **basic 模板**：命令型 / silent / 后台优先 / 无前端。
- 已有可运行的 React/Vue/Svelte/静态前端 → **不要套模板**，改用"转换"流程（technical：`references/existing-frontend-conversion.md`），只补 `manifest.json` + 最小 `dist/main.js` + `ui/index.html`。
- uTools/zTools/Rubick 迁移 → 用 `references/utools-ztools-migration.md`，旧 API 替换为 Mulby API，缺口在 README 标注。

**Gate 1 产出**：模板决策 + 理由。

---

## 阶段 2：Scaffold（脚手架）
- 使用 `npx mulby-cli`（经技能脚本 `scripts/invoke_mulby_cli.mjs`）：
  - `node invoke_mulby_cli.mjs create <name> --template react|basic`
- 在 Mulby 开发者工具中：调用宿主 `developer:createPlugin({ targetDir, name, template })`（内部走上面 CLI）。
- **禁止** `mulby create --ai`（AI 即开发者本身，不依赖 CLI 的 AI 流程）。
- 脚手架后立刻把目录 `developer:addPluginProject({ path, source:'created' })` 纳入开发项目列表。

**Gate 2 产出**：可被宿主识别的插件目录（含 `manifest.json`）。

---

## 阶段 3：Manifest 合约锁定（Contract Lock）
大改动前先锁定 `manifest.json`（**契约即事实来源**）：
- `id` / `name` / `displayName` / `version` / `description`
- `features[]`：每个 `code`、`explain`、`cmds`（type/value/match…）、`mode`(ui/silent/detached)、可选 `route/mainHide/preCapture`
- `main`（`dist/main.js`）/ `ui`（`ui/index.html`，有 UI 时）/ `preload`（`preload.cjs`，仅需桥接时）
- `icon`、`platform`（跨平台则省略）、`pluginSetting`、`window`
- `permissions` / 能力需求
- `tools[]`（如需 AI tools，且每个 tool 必须在 `onLoad` 注册 handler）

**Gate 3 产出**：定稿 `manifest.json`，每个 `feature.code` 都有明确归属（UI/Main/preload）。

---

## 阶段 4：最小闭环（Happy Path）
- `manifest` 指向真实文件。
- `src/main.ts` 实现一个**可在 Mulby 中触发并运行**的 happy path（`run(context)`）。
- 有 UI 则提供可用 `src/ui/App.tsx`。
- `preload.cjs` 仅在需要 Node/Electron 桥接时添加，且为 CommonJS。
- 验证：`npm run build` 成功 → 在宿主开发者工具中"刷新载入" → 触发跑通。

**Gate 4 产出**：一个能在 Mulby 内被触发、跑通的最小可用路径。

---

## 阶段 5：增量完善（Expand）
- 增加更多 features / cmds / route。
- 完善 UI 交互、loading/error/empty/success 状态。
- 后台 / 定时 / host 集成 / preload 桥接（按需）。
- 注册 AI tools handler（若声明 tools）。

**Gate 5 产出**：完整功能集 + 各状态覆盖。

---

## 阶段 6：图标与 README（Finalize Assets）
- 功能与 UI 主题稳定后再做图标。
- `assets/icon.svg`（与插件用途/配色匹配，非占位符）→ 用技能 `scripts/finalize_plugin_icon.mjs` 渲染 512x512 `icon.png`，替换脚手架默认图标。
- 补 `README.md`：描述、支持的 features/命令、用法示例、依赖/前置条件、配置项。

**Gate 6 产出**：品牌化 `icon.png` + 完整 README。

---

## 阶段 7：验证与交付（Validate & Handoff）
- `npm install`（缺依赖时）、`npm run build`、需要分发时 `npm run pack`。
- 给出**宿主内手动验收清单**：
  1. 插件无 manifest 错误地加载/安装；
  2. 至少一条触发路径进入插件；
  3. 期望 UI 打开或 silent 功能完成；
  4. detached/后台/preload 行为正确（如配置）；
  5. 最终 `icon.png` 是品牌图标而非脚手架默认；
  6. 真实样例输入下核心任务成功。
- 满足 develop-mulby-plugin **Handoff Checklist**（manifest 必填完整、每个 feature.code 有逻辑、tools 有 handler、main/ui/preload 路径存在、build/pack 成功、README 更新）。

**Gate 7 产出**：可交付/可附加的插件 + 验收清单。

---

## 流程图（状态机）
```
Clarify(0) → Template(1) → Scaffold(2) → ContractLock(3)
   → HappyPath(4) → Expand(5) → Assets(6) → Validate(7) ✅
   任一 Gate 未达成 → 回到当前阶段补齐，不得跳跃。
```

## 在开发者工具 UI 中的落地
- AI 创作面板按上述阶段以"分步向导"呈现，每个 Gate 对应一次确认。
- 宿主 IPC 支撑：`createPlugin`(阶段2) / `validatePlugin`(阶段3-4) / `buildPlugin`(阶段4-7) / `packPlugin`(阶段7) / `addPluginProject` / `reloadPlugin`。
- 全程把诊断输出写入工作台日志区，失败给出明确修复建议。
