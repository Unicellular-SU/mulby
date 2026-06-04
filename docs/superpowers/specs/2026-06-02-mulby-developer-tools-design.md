# Mulby 开发者工具 — 产品设计说明（PRD / Design Spec）

> 作者：产品经理（kc-chat agent-2）｜日期：2026-06-02
> 状态：已确认方向（设置模型=B、归属=PM产出+团队实现、脚手架=npx mulby-cli），进入实现计划
> 配套文档：实现计划 `docs/superpowers/plans/2026-06-02-mulby-developer-tools.md`、Vibe Coding 流程 `docs/superpowers/specs/2026-06-02-vibe-coding-workflow.md`

---

## 1. 目标与范围

为 Mulby 提供一个**内置/系统级面向插件开发者的工作台插件**：`Mulby 开发者工具`，用于插件应用的**开发、调试、创建、导入、管理与 AI 创作（Vibe Coding）**。

它不局限于"仓库目录"或"宿主设置里的开发目录"，而是允许用户：
- 在插件 UI 内**直接选择目录**新建/导入插件；
- 管理**多来源**的开发项目（宿主设置开发目录、此插件中添加的目录、最近创建/导入的插件）；
- **导入单个插件目录**（直接含 `manifest.json`），而非只能导入"含多个子插件的父目录"；
- 通过 **Vibe Coding** 用自然语言描述需求，由 AI 按固定流程创建/修改插件。

为支撑上述能力，需同步对**宿主**做有限、向后兼容的改造（加载单个插件目录、新增 Developer IPC、preload 类型与文档）。

### 范围内
- 宿主：单插件目录加载、`pluginProjects[]` 设置模型、Developer IPC 扩展、preload 类型、`docs/apis/developer.md`、PluginManager 局部重载/状态查询、单测。
- 插件：`mulby-developer-tools`（React 模板）工作台 UI + 主逻辑。
- 文档：Vibe Coding 固化流程。

### 范围外（YAGNI）
- 不引入新的全局状态库/架构；复用现有 PluginManager / app-settings / IPC / 系统插件机制。
- 不改动已安装插件、内置插件、`cwd/plugins`、集合开发目录的现有批量加载语义。
- 不内置 mulby-cli（脚手架走 `npx mulby-cli`，见决策 3）。

---

## 2. 关键决策（已确认）

| 决策 | 选择 | 说明 |
|---|---|---|
| 设置模型 / 单目录识别 | **B：新增 `pluginProjects[]`** | 显式记录 `type`(single/collection) + `source`(added/imported/created) + 时间戳；`pluginPaths[]` 保留并在加载时迁移进 `pluginProjects[]`，保证向后兼容。 |
| 实现归属 | **PM 产出 PRD+计划，团队实现** | 宿主改造→架构师/修复专家；插件 UI→UX+架构师；PM 统筹文档与验收。 |
| 脚手架方式 | **复用 `npx mulby-cli`** | 通过技能脚本 `.cursor/skills/develop-mulby-plugin/scripts/invoke_mulby_cli.mjs`（解析顺序：env→本地→全局→`npx mulby-cli@latest`）。需联网；离线时返回明确错误并提示。 |

---

## 3. 现状（调研结论，含文件定位）

- **加载** `mulby/src/main/plugin/manager.ts` `loadPlugins()` (~L417-550)：
  顺序＝内置插件(`loadPlugin` 单目录) → `userData/plugins`(已安装) → `cwd/plugins`(仅非打包) → `developer.pluginPaths[]`(自定义)。
  其中 `userData/plugins`、`cwd/plugins`、每个 `pluginPaths[]` 项都用 `loader.loadAll()` **扫描子目录**（集合语义）。
- **loader** `mulby/src/main/plugin/loader.ts`：`loadAll()` 扫子目录；`loadPlugin(dir)` 加载单个插件目录（目前只服务内置插件 + 元数据热重载）。`validateManifest()` 校验 `name/version/displayName/features`（非系统插件还需 `main`）。
- **设置** `mulby/src/shared/types/settings.ts` L416 `DeveloperSettings { enabled, pluginPaths[], autoReload, showDevTools, logLevel }`；默认值在 `app-settings.ts` L108；合并逻辑 `mergeSettings()` L963。
- **IPC** `mulby/src/main/ipc/developer.ts`：`addPluginPath / removePluginPath / reloadPlugins / selectDirectory`，均触发 `pluginManager.init()` 全量重载。注册入口见 `ipc/index.ts` 的 `registerDeveloperHandlers`。
- **preload** `mulby/src/preload/apis/platform-api.ts` L240 `developer` 命名空间（**未受 restricted 限制**，插件 UI 可调用）；类型 `mulby/src/shared/types/electron.d.ts` L869。
- **设置 UI** `mulby/src/renderer/components/settings/sections/DeveloperSection.tsx`（tailwind 风格参考）。
- **冲突策略** `manager.ts` L467-509：开发版>已安装版；系统插件(`__mulby_system`)受保护；同源先到先得；`overriddenInstallPath` 记录被覆盖路径；`isDev` 由 `plugin.path.startsWith(devDir)`。
- **热重载** `setupPluginWatcher()` (L2148)：对每个 `isDev` 插件监听 code + metadata；`reloadBackend()`/`reloadPluginMetadata()` 局部重载。
- **既有半成品** `mulby-plugins/plugins/mulby-developer-tools/`：仅剩 `node_modules`(react/react-dom/vite/tailwindcss/postcss/autoprefixer/lucide-react/esbuild/typescript) + `dist/main.js` + `ui/index.html`，**缺 `src/`、`manifest.json`、`package.json`、`README.md`** → 当作需重建的目标目录（依赖已就绪）。

### 核心缺口
1. **无法加载"单个插件目录"**：`pluginPaths[]` 项一律按集合目录扫子目录，直接含 `manifest.json` 的目录会被漏载。
2. **无 per-plugin 重载 / validate / create / 项目列表** IPC（只有全量 `init()`）。
3. **无脚手架能力**（仓库无 mulby-cli）。

---

## 4. 宿主改造设计

### 4.1 设置模型（决策 B）

`mulby/src/shared/types/settings.ts`：

```ts
export type PluginProjectType = 'single' | 'collection'
export type PluginProjectSource = 'added' | 'imported' | 'created' | 'migrated'

export interface PluginProjectEntry {
  id: string                 // 稳定 id，如 `proj-<timestamp>-<rand>`
  path: string               // path.resolve 后的绝对路径
  type: PluginProjectType    // single=目录直接含 manifest.json；collection=父目录扫子插件
  source: PluginProjectSource
  label?: string             // 可选展示名（缺省回退 manifest.displayName / basename）
  createdAt: number
  lastOpenedAt?: number
}

export interface DeveloperSettings {
  enabled: boolean
  pluginPaths: string[]               // LEGACY：保留只读，迁移来源
  pluginProjects: PluginProjectEntry[] // NEW：开发项目的唯一事实来源
  autoReload: boolean
  showDevTools: boolean
  logLevel: LogLevel
}
```

**归一化与迁移**（`app-settings.ts`）：
- 默认值新增 `pluginProjects: []`。
- 新增 `normalizeDeveloperSettings()`：对 `pluginProjects` 去重（按 `path` resolve 后大小写敏感路径）、过滤非法项、补全 `id/createdAt`。
- **迁移**：`getSettings()` 读到旧数据（有 `pluginPaths` 但 `pluginProjects` 为空/缺失）时，把每个 `pluginPaths` 项迁移成 `{type:'collection', source:'migrated'}` 写入 `pluginProjects`，并保留 `pluginPaths` 原值不动（向后兼容旧代码读取）。

### 4.2 加载逻辑（`manager.ts loadPlugins()`）

- 构造开发来源时，用 `developer.pluginProjects`（启用开发者模式时）替代直接用 `pluginPaths`：
  - `type==='collection'` → 仍走 `loader.loadAll(path)`（**完全保留现有语义**）。
  - `type==='single'` → 走 `loader.loadPlugin(path)`，加载成功后 `isDev=true`，并入 `this.plugins`（复用现有冲突策略：dev>installed、系统保护、同源去重、`overriddenInstallPath`）。
- `cwd/plugins`、`userData/plugins` 行为**不变**。
- `devDirs`（用于 isDev 标记）需把 single 项目的路径与 collection 项目的路径都纳入：single 用精确路径匹配；collection 沿用 `startsWith` 前缀匹配。
- **路径去重/包含关系**：若一个 single 路径位于某 collection 路径之下，single 优先生效；加载时按 resolve 路径去重，避免同一插件被加载两次。

### 4.3 PluginManager 公开方法（供 IPC 调用）

```ts
// 局部重载单个插件（复用 reloadPluginMetadata：重读 manifest + 重启 host）
async reloadPlugin(pluginId: string): Promise<{ success: boolean; error?: string }>

// 返回开发项目 + 其下插件的运行态状态（供 UI 列表）
getPluginProjectStatus(projects: PluginProjectEntry[]): PluginProjectStatus[]
```

`PluginProjectStatus`（放 `shared/types/plugin.ts` 或 `developer.ts` 专用类型）：
```ts
interface PluginProjectStatus {
  projectId: string
  path: string
  type: PluginProjectType
  source: PluginProjectSource
  label?: string
  exists: boolean                 // 目录是否还存在
  plugins: PluginProjectPluginStatus[]
}
interface PluginProjectPluginStatus {
  id: string
  displayName: string
  path: string
  manifestValid: boolean
  manifestErrors: string[]        // 缺字段、regex 误用等
  mainEntryFound: boolean         // 非系统插件 main 是否解析到
  built: boolean                  // dist/main.js（或 manifest.main）是否存在
  loaded: boolean                 // 是否在 PluginManager.plugins 中
  enabled: boolean
  isDev: boolean
  idConflictWith?: string         // 冲突的另一来源路径（overriddenInstallPath / 同 id 系统插件）
}
```

### 4.4 Developer IPC 扩展（`ipc/developer.ts`）

保留现有 4 个，新增：

| Channel | 入参 | 行为 | 返回 |
|---|---|---|---|
| `developer:addPluginProject` | `{ path, source? }` | 校验存在；**自动判别** `manifest.json` 存在→single 否则 collection；去重；写入 `pluginProjects`；触发对应加载（single→reloadPlugin/局部 init；collection→`init()`） | `{ success, project?, error? }` |
| `developer:removePluginProject` | `{ id }` 或 `{ path }` | 从 `pluginProjects` 移除；若该项目下有插件被加载则卸载其运行态并重载 | `{ success, error? }` |
| `developer:reloadPlugin` | `{ pluginId }` | 调 `pluginManager.reloadPlugin` 局部重载 | `{ success, error? }` |
| `developer:validatePlugin` | `{ path }` | 不落库地校验单个插件目录：manifest 解析、必填字段、平台兼容、main 解析、build 产物、ID 冲突 | `PluginValidationResult` |
| `developer:listPluginProjects` | — | 读取 `pluginProjects` + `getPluginProjectStatus` | `PluginProjectStatus[]` |
| `developer:createPlugin` | `{ targetDir, name, template:'react'\|'basic' }` | 走 `invoke_mulby_cli.mjs create`（决策 3）；成功后 `addPluginProject({path:<targetDir/name>, source:'created'})` | `{ success, path?, log, error? }` |
| `developer:buildPlugin` | `{ path }` | 在 `path` 下执行 `npm run build`（spawn，流式日志） | `{ success, log, error? }` |
| `developer:packPlugin` | `{ path }` | 在 `path` 下执行 `npm run pack` | `{ success, outFile?, log, error? }` |
| `developer:openPluginDir` | `{ path }` | `shell.openPath` | `{ success }` |
| `developer:updateProjectMeta` | `{ id, lastOpenedAt?, label? }` | 更新项目元数据 | `{ success }` |

> 说明：build/pack 用**宿主 IPC + spawn** 而非插件内 `shell.runCommand`，以获得结构化日志、绕开 runCommand 默认 denylist 摩擦，并把工作目录锁定在项目内。`createPlugin` 通过 `invoke_mulby_cli.mjs`，离线/未安装时返回明确 error（提示用户手动 `mulby create` 或导入）。

### 4.5 preload 与文档

- `platform-api.ts` `developer` 命名空间补全新方法。
- `electron.d.ts` `developer` 接口补全类型。
- `docs/apis/developer.md` 增补全部新方法、入参/返回、示例、single vs collection 说明。

### 4.6 热重载 / watch

- 单插件目录加载后 `isDev=true`，**自动复用** `setupPluginWatcher`（监听 `manifest.main` 与 manifest/icon），无需额外改动。
- `reloadPlugin` 命中后通知 UI 刷新状态。

---

## 5. 插件设计（`mulby-developer-tools`）

### 5.1 形态
- 模板：**React**（可视化工作台，detached/attached 均可；建议 detached 窗口便于长时间开发）。
- 复用既有 `node_modules`（react/vite/tailwind/lucide-react/esbuild/ts），补齐 `manifest.json`、`package.json`、`tsconfig.json`、`vite.config.ts`、`src/main.ts`、`src/ui/*`、`README.md`、`assets/icon.svg`+`icon.png`。
- 触发：关键词 `开发者工具 / dev / developer`，feature `code:"workbench"`，`mode:"detached"`（或 ui）。

### 5.2 信息架构（工作台，非营销页）
```
┌───────────────────────────────────────────────┐
│ 顶部操作栏：创建 ＋ | 导入 ⤵ | 添加目录 📁 | 刷新全部 ⟳ │
├───────────────┬───────────────────────────────┤
│ 左：项目列表    │ 右：详情/操作/诊断              │
│ - 来源分组      │ - 选中插件 manifest 摘要         │
│   (开发目录/    │ - 状态徽标：可载入/有效/已构建/   │
│    已添加/      │   已加载/ID冲突                   │
│    最近创建导入)│ - 操作：打开目录/构建/打包/刷新/  │
│ - 每项状态徽标  │   查看README/从列表移除           │
│                 │ - 诊断日志区(build/pack 流式输出)│
│                 │ - Vibe Coding AI 创作面板(底部/页签)│
└───────────────┴───────────────────────────────┘
```

### 5.3 状态可视化（必须覆盖）
- **loading**：列表/构建/打包/创建进行中骨架与按钮 disabled+spinner。
- **error**：manifest 无效、目录不存在、构建失败、ID 冲突 → 红色徽标 + 可展开错误详情 + 修复建议。
- **empty**：无项目时引导"创建第一个插件 / 导入已有插件 / 添加开发目录"。
- **success**：构建/打包/创建成功 toast + 状态徽标转绿。

### 5.4 操作映射（图标+短文本，lucide-react）
创建`Plus` | 导入`FolderInput` | 添加目录`FolderPlus` | 构建`Hammer` | 打包`Package` | 刷新`RefreshCw` | 打开目录`FolderOpen` | 移除`Trash2` | README`FileText`。

### 5.5 Vibe Coding 面板
- 输入：自然语言需求；按固定流程逐步澄清（类型/用户/UI/后台/Mulby API/AI tools）。
- 输出：模板建议 + manifest 合约草案 + 调用 `createPlugin` 脚手架 + 后续步骤清单（最小闭环→增量→图标/README→验证）。
- 与宿主交互：`createPlugin`/`buildPlugin`/`validatePlugin`/`addPluginProject`。
- 详细流程见独立文档（§7）。

---

## 6. 兼容性与冲突策略
- 旧 `pluginPaths[]` 自动迁移为 collection 项目；旧批量加载语义不变。
- 单插件目录复用现有冲突策略（dev>installed、系统保护、同源去重）。
- 同一路径既被 collection 覆盖又被单独 single 添加：single 优先、加载去重。
- 移除项目仅改设置与运行态，**不删除磁盘文件**（删除文件是另一显式动作，默认不做）。

---

## 7. 配套交付物
1. 本 PRD（设计说明）。
2. 实现计划 `docs/superpowers/plans/2026-06-02-mulby-developer-tools.md`（bite-sized task + TDD）。
3. Vibe Coding 流程文档 `docs/superpowers/specs/2026-06-02-vibe-coding-workflow.md`。
4. 宿主改造（团队实现）。
5. 插件实现（团队实现）。
6. `docs/apis/developer.md` 更新。
7. 自动化测试。

---

## 8. 验收标准（对应任务书第 6 节）
1. 添加**单个**插件目录并成功载入。
2. 添加**父级**开发目录继续批量载入（回归不破坏）。
3. manifest 缺失/无效 → `validatePlugin`/加载返回**明确错误**。
4. 插件 ID 冲突 → 按策略处理并在 UI 标记。
5. 移除单个开发项目后宿主刷新、运行态卸载。
6. Developer API 类型、`docs/apis/developer.md` 与实现一致。
7. 开发者工具插件可**创建新插件并跑通 build**。
8. Vibe Coding 生成的插件满足 develop-mulby-plugin 技能 handoff checklist。

---

## 9. 风险
- `npx mulby-cli` 依赖网络/可用性 → 离线降级为明确错误 + 手动指引。
- `init()` 全量重载较重；single 项目优先用 `reloadPlugin` 局部重载降低开销。
- 既有 `mulby-developer-tools` 残留产物 → 重建前清理 `dist/ui` 旧产物，保留 `node_modules`。
