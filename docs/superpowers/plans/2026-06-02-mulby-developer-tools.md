# Mulby 开发者工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Mulby 支持"加载单个插件目录 + 多来源开发项目管理"，并交付一个 React 工作台插件 `mulby-developer-tools`，支持创建/导入/构建/打包/刷新/移除与 AI Vibe Coding。

**Architecture:** 复用现有 PluginManager / app-settings / Developer IPC / 系统插件机制。新增 `developer.pluginProjects[]` 设置模型（决策 B），加载时按 `manifest.json` 存在与否区分 single/collection；新增 Developer IPC（addPluginProject/removePluginProject/reloadPlugin/validatePlugin/listPluginProjects/createPlugin/buildPlugin/packPlugin/openPluginDir/updateProjectMeta）；插件用 React 模板，通过 `window.mulby.developer.*` 与 `shell` 交互。脚手架走 `npx mulby-cli`（决策 C=b）。

**Tech Stack:** Electron(主进程 TS) + node:test 单测 + React/Vite/Tailwind/lucide-react(插件) + esbuild(插件后端) + mulby-cli。

**测试运行：** 全量 `node scripts/run-unit-tests.mjs`（基于 `node:test`+`assert/strict`，测试文件放在 `src/main/plugin/__tests__/`、`src/main/services/__tests__/`、`src/main/ipc/__tests__/`）。

**配套规格：** 设计 `docs/superpowers/specs/2026-06-02-mulby-developer-tools-design.md`；Vibe Coding `docs/superpowers/specs/2026-06-02-vibe-coding-workflow.md`。

---

## 文件结构（创建/修改）

宿主（mulby/）：
- Modify `src/shared/types/settings.ts` — 新增 `PluginProjectType/Source/Entry`，扩展 `DeveloperSettings`
- Modify `src/shared/types/plugin.ts` 或新增 `src/shared/types/developer.ts` — `PluginProjectStatus`、`PluginValidationResult`
- Modify `src/main/services/app-settings.ts` — 默认值 + `normalizeDeveloperSettings` + 迁移
- Create `src/main/plugin/plugin-project-utils.ts` — `detectProjectType`/`dedupeProjects`/`isSinglePluginDir`（纯函数，便于测试）
- Modify `src/main/plugin/loader.ts` — 复用既有 `loadPlugin`；新增 `isSinglePluginDir` helper（或放 utils）
- Modify `src/main/plugin/manager.ts` — `loadPlugins` single/collection 分支；`reloadPlugin`/`getPluginProjectStatus` 公开方法
- Modify `src/main/ipc/developer.ts` — 新增 IPC handlers
- Create `src/main/plugin/plugin-validator.ts` — `validatePluginAt(path)` 纯/半纯函数
- Modify `src/preload/apis/platform-api.ts` — developer 命名空间补全
- Modify `src/shared/types/electron.d.ts` — developer 接口补全
- Modify `docs/apis/developer.md`
- Create `src/main/plugin/__tests__/plugin-project-utils.test.ts`
- Create `src/main/plugin/__tests__/plugin-validator.test.ts`
- Create `src/main/services/__tests__/developer-settings-migration.test.ts`

插件（mulby-plugins/plugins/mulby-developer-tools/）：
- Create `manifest.json`、`package.json`、`tsconfig.json`、`vite.config.ts`
- Create `src/main.ts`、`src/ui/main.tsx`、`src/ui/App.tsx`、`src/ui/components/*`、`src/ui/hooks/useDeveloper.ts`、`src/ui/styles.css`
- Create `assets/icon.svg` → `icon.png`、`README.md`

---

## 阶段 A：宿主 — 设置模型与迁移（架构师/修复专家）

### Task A1：PluginProject 类型定义

**Files:**
- Modify: `src/shared/types/settings.ts`

- [ ] **Step 1: 新增类型并扩展 DeveloperSettings**

```ts
export type PluginProjectType = 'single' | 'collection'
export type PluginProjectSource = 'added' | 'imported' | 'created' | 'migrated'

export interface PluginProjectEntry {
  id: string
  path: string
  type: PluginProjectType
  source: PluginProjectSource
  label?: string
  createdAt: number
  lastOpenedAt?: number
}

export interface DeveloperSettings {
  enabled: boolean
  pluginPaths: string[]                 // LEGACY，迁移来源，保留只读
  pluginProjects: PluginProjectEntry[]  // NEW
  autoReload: boolean
  showDevTools: boolean
  logLevel: LogLevel
}
```

- [ ] **Step 2: 编译检查** Run: `cd mulby && npx tsc --noEmit -p tsconfig.json`（仅类型，确认无破坏）。Expected: 不因新增字段报错（下游使用处在后续任务补齐）。
- [ ] **Step 3: Commit** `git add -A && git commit -m "feat(types): add PluginProjectEntry and developer.pluginProjects"`

---

### Task A2：project utils 纯函数（TDD）

**Files:**
- Create: `src/main/plugin/plugin-project-utils.ts`
- Test: `src/main/plugin/__tests__/plugin-project-utils.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { isSinglePluginDir, detectProjectType, dedupeProjects } from '../plugin-project-utils'
import type { PluginProjectEntry } from '../../../shared/types/settings'

describe('plugin-project-utils', () => {
  it('isSinglePluginDir: true when manifest.json exists', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await writeFile(path.join(dir, 'manifest.json'), '{}')
    assert.equal(isSinglePluginDir(dir), true)
    await rm(dir, { recursive: true, force: true })
  })

  it('detectProjectType: collection when no manifest.json at root', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await mkdir(path.join(dir, 'child'))
    assert.equal(detectProjectType(dir), 'collection')
    await rm(dir, { recursive: true, force: true })
  })

  it('dedupeProjects: removes duplicate resolved paths, keeps first', () => {
    const base: Omit<PluginProjectEntry, 'path'> = { id: 'a', type: 'single', source: 'added', createdAt: 1 }
    const list: PluginProjectEntry[] = [
      { ...base, id: '1', path: '/tmp/p' },
      { ...base, id: '2', path: '/tmp/p/' }
    ]
    const out = dedupeProjects(list)
    assert.equal(out.length, 1)
    assert.equal(out[0].id, '1')
  })
})
```

- [ ] **Step 2: 运行确认失败** Run: `node scripts/run-unit-tests.mjs` Expected: FAIL（模块不存在）。
- [ ] **Step 3: 实现**

```ts
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import type { PluginProjectEntry, PluginProjectType } from '../../shared/types/settings'

export function isSinglePluginDir(dirPath: string): boolean {
  return existsSync(join(dirPath, 'manifest.json'))
}

export function detectProjectType(dirPath: string): PluginProjectType {
  return isSinglePluginDir(dirPath) ? 'single' : 'collection'
}

export function dedupeProjects(projects: PluginProjectEntry[]): PluginProjectEntry[] {
  const seen = new Set<string>()
  const out: PluginProjectEntry[] = []
  for (const p of projects) {
    const key = resolve(p.path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...p, path: key })
  }
  return out
}
```

- [ ] **Step 4: 运行确认通过** Run: `node scripts/run-unit-tests.mjs` Expected: PASS。
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(plugin): add plugin-project-utils with tests"`

---

### Task A3：设置默认值、归一化与迁移（TDD）

**Files:**
- Modify: `src/main/services/app-settings.ts`
- Test: `src/main/services/__tests__/developer-settings-migration.test.ts`

> 注意：`AppSettingsManager` 用真实 db。为可测，把**纯迁移/归一化逻辑**抽成可单测的导出函数 `normalizeDeveloperSettings(input): DeveloperSettings`，在 `mergeSettings`/`getSettings` 中调用。测试只针对该纯函数。

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeDeveloperSettings } from '../app-settings'

describe('normalizeDeveloperSettings', () => {
  it('migrates legacy pluginPaths into pluginProjects as collection/migrated', () => {
    const out = normalizeDeveloperSettings({
      enabled: true, pluginPaths: ['/tmp/devdir'], autoReload: true, showDevTools: false, logLevel: 'info'
    } as never)
    assert.equal(out.pluginProjects.length, 1)
    assert.equal(out.pluginProjects[0].type, 'collection')
    assert.equal(out.pluginProjects[0].source, 'migrated')
    assert.ok(out.pluginPaths.includes('/tmp/devdir')) // legacy 保留
  })

  it('does not double-migrate when pluginProjects already present', () => {
    const out = normalizeDeveloperSettings({
      enabled: true, pluginPaths: ['/tmp/devdir'],
      pluginProjects: [{ id: 'x', path: '/tmp/other', type: 'single', source: 'added', createdAt: 1 }],
      autoReload: true, showDevTools: false, logLevel: 'info'
    } as never)
    assert.equal(out.pluginProjects.length, 1)
    assert.equal(out.pluginProjects[0].id, 'x')
  })
})
```

- [ ] **Step 2: 运行确认失败** Run: `node scripts/run-unit-tests.mjs` Expected: FAIL（函数未导出）。
- [ ] **Step 3: 实现 normalizeDeveloperSettings + 接入**

```ts
export function normalizeDeveloperSettings(
  input: Partial<DeveloperSettings> | undefined
): DeveloperSettings {
  const d = { ...DEFAULT_SETTINGS.developer, ...(input || {}) }
  const pluginPaths = normalizeStringList(d.pluginPaths, 200)
  let pluginProjects = Array.isArray(d.pluginProjects) ? d.pluginProjects : []
  // 迁移：有 legacy pluginPaths 且尚无 projects
  if (pluginProjects.length === 0 && pluginPaths.length > 0) {
    pluginProjects = pluginPaths.map((p, i) => ({
      id: `proj-mig-${i}-${Date.now()}`,
      path: path.resolve(p),
      type: 'collection' as const,
      source: 'migrated' as const,
      createdAt: Date.now()
    }))
  }
  // 归一化每项 + 去重
  const normalized = pluginProjects
    .filter((p): p is PluginProjectEntry => !!p && typeof p.path === 'string' && p.path.trim().length > 0)
    .map((p, i) => ({
      id: String(p.id || `proj-${i}-${Date.now()}`),
      path: path.resolve(p.path),
      type: p.type === 'single' ? 'single' as const : 'collection' as const,
      source: (['added','imported','created','migrated'].includes(p.source as string) ? p.source : 'added') as PluginProjectSource,
      label: typeof p.label === 'string' ? p.label : undefined,
      createdAt: Number(p.createdAt || Date.now()),
      lastOpenedAt: p.lastOpenedAt ? Number(p.lastOpenedAt) : undefined
    }))
  return {
    enabled: d.enabled === true,
    pluginPaths,
    pluginProjects: dedupeProjects(normalized),
    autoReload: d.autoReload !== false,
    showDevTools: d.showDevTools === true,
    logLevel: d.logLevel || 'info'
  }
}
```
在 `DEFAULT_SETTINGS.developer` 增加 `pluginProjects: []`；在 `mergeSettings` 的 `developer` 分支改为 `developer: normalizeDeveloperSettings({ ...current.developer, ...(next.developer || {}) })`；`sanitizeShortcuts` 同步调用一次（确保读旧数据触发迁移）。需 `import { dedupeProjects } from '../plugin/plugin-project-utils'` 与类型导入。

- [ ] **Step 4: 运行确认通过** Run: `node scripts/run-unit-tests.mjs` Expected: PASS。
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(settings): pluginProjects model + legacy migration"`

---

## 阶段 B：宿主 — 加载与校验（架构师/修复专家）

### Task B1：loadPlugins 支持 single/collection（含回归测试）

**Files:**
- Modify: `src/main/plugin/manager.ts` (`loadPlugins`)
- Test: `src/main/plugin/__tests__/plugin-project-utils.test.ts`（补集成式断言，或新建 loader 测试见 B2）

- [ ] **Step 1: 修改 loadPlugins 来源构造**

将 customDevDirs 的构造改为基于 `developer.pluginProjects`：

```ts
const projects = developer.enabled ? developer.pluginProjects : []
const collectionDirs = projects.filter(p => p.type === 'collection').map(p => p.path).filter(existsSync)
const singleDirs = projects.filter(p => p.type === 'single').map(p => p.path).filter(existsSync)

const dirs = [
  userPluginsDir,
  ...(app.isPackaged ? [] : [devPluginsDir]),
  ...collectionDirs
].filter(existsSync)

const devDirs = new Set([
  ...(app.isPackaged ? [] : [devPluginsDir]),
  ...collectionDirs
])
```

在现有 `for (const dir of dirs)` 集合扫描**之后**，新增单插件目录加载循环（复用现有冲突策略：抽一个私有方法 `registerLoadedPlugin(plugin, devDirs, { forceDev })` 包装 L463-529 的注册+冲突逻辑，single 与 collection 共用）：

```ts
for (const dir of singleDirs) {
  const loader = new PluginLoader(dir)
  const plugin = loader.loadPlugin(dir)
  if (!plugin) { log.warn(`[PluginManager] single plugin dir invalid: ${dir}`); continue }
  plugin.isDev = true
  this.registerLoadedPlugin(plugin, devDirs, { forceDev: true })
}
```

`registerLoadedPlugin` 内部沿用 L467-529 的冲突分支（系统保护、dev>installed、同源去重、watcher、tools、state）。collection 循环改为调用同一方法（先 `plugin.isDev = ...startsWith` 判定）。

- [ ] **Step 2: 回归手测脚本（无需启动 Electron）** 由于 `loadPlugins` 依赖 app/db，逻辑回归用 B2 的 loader 测试覆盖；此处仅确保 `npx tsc --noEmit` 通过。Run: `cd mulby && npx tsc --noEmit`. Expected: PASS。
- [ ] **Step 3: Commit** `git add -A && git commit -m "feat(plugin): load single plugin directories from pluginProjects"`

---

### Task B2：loader 单目录加载回归测试

**Files:**
- Test: `src/main/plugin/__tests__/loader-single-dir.test.ts`

- [ ] **Step 1: 写测试（真实临时目录）**

```ts
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { PluginLoader } from '../loader'

async function makeSinglePlugin(root: string) {
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
    name: 'demo.single', version: '1.0.0', displayName: 'Demo', main: 'dist/main.js',
    features: [{ code: 'run', explain: 'r', cmds: [{ type: 'keyword', value: 'demo' }] }]
  }))
  await mkdir(path.join(root, 'dist'))
  await writeFile(path.join(root, 'dist', 'main.js'), 'module.exports={}')
}

describe('PluginLoader single dir', () => {
  it('loadPlugin loads a dir that directly contains manifest.json', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await makeSinglePlugin(dir)
    const loader = new PluginLoader(dir)
    const plugin = loader.loadPlugin(dir)
    assert.ok(plugin)
    assert.equal(plugin!.id, 'demo.single')
    await rm(dir, { recursive: true, force: true })
  })

  it('loadAll returns [] for a single-plugin dir (collection semantics)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await makeSinglePlugin(dir)
    const loader = new PluginLoader(dir)
    assert.equal(loader.loadAll().length, 0) // 证明必须用 single 分支
    await rm(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: 运行** Run: `node scripts/run-unit-tests.mjs` Expected: PASS（验证 single 分支必要性与正确性）。
- [ ] **Step 3: Commit** `git add -A && git commit -m "test(plugin): loader single-dir regression"`

---

### Task B3：validatePluginAt（TDD）

**Files:**
- Create: `src/main/plugin/plugin-validator.ts`
- Create: `src/shared/types/developer.ts`（`PluginValidationResult`, `PluginProjectStatus`, `PluginProjectPluginStatus`）
- Test: `src/main/plugin/__tests__/plugin-validator.test.ts`

- [ ] **Step 1: 类型** 见设计 §4.3、§4.4 的接口定义，落到 `developer.ts`。
- [ ] **Step 2: 写失败测试**

```ts
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { validatePluginAt } from '../plugin-validator'

describe('validatePluginAt', () => {
  it('reports missing manifest', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    const r = validatePluginAt(dir)
    assert.equal(r.valid, false)
    assert.ok(r.errors.some(e => /manifest/i.test(e)))
    await rm(dir, { recursive: true, force: true })
  })

  it('reports missing required fields', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'x' }))
    const r = validatePluginAt(dir)
    assert.equal(r.valid, false)
    assert.ok(r.errors.length > 0)
    await rm(dir, { recursive: true, force: true })
  })

  it('valid when manifest + main exist', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mb-'))
    await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
      name: 'ok', version: '1.0.0', displayName: 'OK', main: 'dist/main.js',
      features: [{ code: 'r', explain: 'r', cmds: [{ type: 'keyword', value: 'k' }] }]
    }))
    await mkdir(path.join(dir, 'dist'))
    await writeFile(path.join(dir, 'dist', 'main.js'), 'x')
    const r = validatePluginAt(dir)
    assert.equal(r.valid, true)
    assert.equal(r.built, true)
    await rm(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 3: 实现** 复用 loader 的字段校验规则（`name/version/displayName/features`，非系统插件 +`main`）、平台兼容（`isCompatiblePlatform`）、main 解析、`dist/main.js` 是否存在（built）。返回 `{ valid, errors[], manifest摘要, built, mainEntryFound }`。
- [ ] **Step 4: 运行确认通过** Run: `node scripts/run-unit-tests.mjs` Expected: PASS。
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(plugin): plugin-validator with tests"`

---

### Task B4：PluginManager.reloadPlugin / getPluginProjectStatus

**Files:**
- Modify: `src/main/plugin/manager.ts`

- [ ] **Step 1: 公开 reloadPlugin** 包装现有 `reloadPluginMetadata`（重读 manifest + 重启 host）：

```ts
async reloadPlugin(pluginId: string): Promise<{ success: boolean; error?: string }> {
  const plugin = this.plugins.get(pluginId)
  if (!plugin) return { success: false, error: '插件不存在' }
  try { await this.reloadPluginMetadata(pluginId); return { success: true } }
  catch (e) { return { success: false, error: e instanceof Error ? e.message : 'reload failed' } }
}
```

- [ ] **Step 2: getPluginProjectStatus** 遍历传入 projects，single→该目录解析的 0/1 个插件，collection→`readdirSync` 子目录解析；对每个用 `validatePluginAt` + 查 `this.plugins`/`getAll()` 得到 `loaded/enabled/isDev/idConflictWith(overriddenInstallPath)`。返回 `PluginProjectStatus[]`。
- [ ] **Step 3: tsc 检查** Run: `cd mulby && npx tsc --noEmit` Expected: PASS。
- [ ] **Step 4: Commit** `git add -A && git commit -m "feat(plugin): public reloadPlugin + getPluginProjectStatus"`

---

## 阶段 C：宿主 — Developer IPC / preload / 文档（架构师/修复专家）

### Task C1：新增 Developer IPC handlers

**Files:**
- Modify: `src/main/ipc/developer.ts`

- [ ] **Step 1: 实现 handlers**（保留旧 4 个）按设计 §4.4 实现：`addPluginProject / removePluginProject / reloadPlugin / validatePlugin / listPluginProjects / createPlugin / buildPlugin / packPlugin / openPluginDir / updateProjectMeta`。
  - `addPluginProject`: `detectProjectType` 自动判别；`appSettingsManager.updateSettings`；single→`pluginManager.init()`（或局部）；返回 `project`。
  - `createPlugin`: `spawn` 调技能脚本：`node <skill>/scripts/invoke_mulby_cli.mjs create <name> --template <t>`（cwd=targetDir）；技能脚本路径用 env `MULBY_DEV_SKILL_DIR` 或默认 `~/.cursor/skills/develop-mulby-plugin`；失败回明确 error。成功后 `addPluginProject({path, source:'created'})`。
  - `buildPlugin`/`packPlugin`: `spawn('npm', ['run','build'|'pack'], { cwd: path })`，收集 stdout/stderr 返回 `log`。
  - 全部统一 `try/catch` 返回 `{ success, error }`。

示例（节选）：
```ts
import { detectProjectType, dedupeProjects } from '../plugin/plugin-project-utils'
import { validatePluginAt } from '../plugin/plugin-validator'
import { spawn } from 'child_process'

ipcMain.handle('developer:addPluginProject', async (_e, args: { path: string; source?: string }) => {
  const p = args?.path
  if (!p || !existsSync(p)) return { success: false, error: '目录不存在' }
  const settings = appSettingsManager.getSettings()
  const resolved = require('path').resolve(p)
  if (settings.developer.pluginProjects.some(x => require('path').resolve(x.path) === resolved))
    return { success: false, error: '项目已存在' }
  const entry = {
    id: `proj-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    path: resolved, type: detectProjectType(resolved),
    source: (args.source as never) || 'added', createdAt: Date.now()
  }
  appSettingsManager.updateSettings({ developer: {
    ...settings.developer,
    pluginProjects: dedupeProjects([...settings.developer.pluginProjects, entry])
  }})
  await pluginManager.init()
  return { success: true, project: entry }
})
```

- [ ] **Step 2: tsc 检查** Run: `cd mulby && npx tsc --noEmit` Expected: PASS。
- [ ] **Step 3: Commit** `git add -A && git commit -m "feat(ipc): developer project/build/pack/validate/create handlers"`

---

### Task C2：IPC 合约测试（addPluginProject 自动判别）

**Files:**
- Test: `src/main/ipc/__tests__/developer-add-project.test.ts`

> 若直接测 IPC 需 mock `ipcMain`/settings。更简方案：把 `addPluginProject` 的纯逻辑（去重、type 判别、entry 构造）抽成 `buildProjectEntry(path, source, existing)` 纯函数置于 `plugin-project-utils.ts` 并单测。本任务测该纯函数：重复路径返回冲突、single 目录 type=single、collection 目录 type=collection。

- [ ] **Step 1: 写测试** 覆盖三种情况（用临时目录区分 single/collection）。
- [ ] **Step 2: 实现 buildProjectEntry 并在 C1 handler 复用。**
- [ ] **Step 3: 运行** Run: `node scripts/run-unit-tests.mjs` Expected: PASS。
- [ ] **Step 4: Commit** `git add -A && git commit -m "test(ipc): addPluginProject entry building"`

---

### Task C3：preload 类型与 API 文档

**Files:**
- Modify: `src/preload/apis/platform-api.ts`（developer 命名空间补全新方法）
- Modify: `src/shared/types/electron.d.ts`（developer 接口补全）
- Modify: `docs/apis/developer.md`

- [ ] **Step 1: platform-api 补全** 为每个新 channel 增加 `ipcRenderer.invoke` 包装。
- [ ] **Step 2: electron.d.ts 补全** 与实现签名一致（入参/返回类型引用 `developer.ts` 类型）。
- [ ] **Step 3: developer.md** 增补全部新方法签名、single vs collection 说明、Vibe Coding 调用示例。
- [ ] **Step 4: tsc 检查** Run: `cd mulby && npx tsc --noEmit` Expected: PASS。
- [ ] **Step 5: Commit** `git add -A && git commit -m "docs+types: developer API surface update"`

---

## 阶段 D：插件 `mulby-developer-tools`（UX/UI 设计师 + 架构师）

> 目标目录 `mulby-plugins/plugins/mulby-developer-tools/` 已有 `node_modules`（react/react-dom/vite/tailwindcss/postcss/autoprefixer/lucide-react/esbuild/typescript）。先清理残留 `dist/`、`ui/` 旧产物，保留 `node_modules`。

### Task D1：脚手架骨架与 manifest 合约

**Files:**
- Create: `manifest.json`, `package.json`, `tsconfig.json`, `vite.config.ts`, `src/main.ts`, `src/ui/main.tsx`, `src/ui/App.tsx`, `src/ui/styles.css`

- [ ] **Step 1: manifest.json**
```json
{
  "id": "mulby-developer-tools",
  "name": "mulby-developer-tools",
  "version": "1.0.0",
  "displayName": "Mulby 开发者工具",
  "description": "插件开发工作台：创建/导入/构建/打包/刷新/管理插件，并支持 AI Vibe Coding 创作",
  "author": "Mulby",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "icon": "icon.png",
  "features": [
    {
      "code": "workbench",
      "explain": "打开插件开发工作台",
      "mode": "detached",
      "cmds": [
        { "type": "keyword", "value": "开发者工具" },
        { "type": "keyword", "value": "dev" },
        { "type": "keyword", "value": "developer" }
      ]
    }
  ],
  "window": { "type": "default", "width": 1100, "height": 720, "minWidth": 880, "minHeight": 560 }
}
```
- [ ] **Step 2: package.json scripts**（与 react 模板一致）
```json
{ "scripts": {
  "build": "npm run build:backend && npm run build:ui",
  "build:backend": "esbuild src/main.ts --bundle --platform=node --outfile=dist/main.js",
  "build:ui": "vite build",
  "pack": "node ../../scripts/.. or mulby pack" } }
```
（pack 由宿主 IPC 触发 `mulby pack`；本地脚本可用技能 `invoke_mulby_cli.mjs pack`。）
- [ ] **Step 3: vite.config.ts** `base: './'`，`build.outDir: 'ui'`，root 指向 `src/ui`。
- [ ] **Step 4: src/main.ts** 最小 `run`/`onLoad`，UI 插件 main 可极简（导出 default）。
- [ ] **Step 5: 构建确认** Run: `cd mulby-plugins/plugins/mulby-developer-tools && npm run build` Expected: 生成 `dist/main.js` 与 `ui/index.html`。
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(plugin): scaffold mulby-developer-tools (manifest+build)"`

### Task D2：useDeveloper hook（封装 window.mulby.developer）
- [ ] 封装 `listPluginProjects/addPluginProject/removePluginProject/reloadPlugin/validatePlugin/createPlugin/buildPlugin/packPlugin/openPluginDir/selectDirectory` 调用 + loading/error 状态。
- [ ] Commit。

### Task D3：工作台 UI（列表 + 详情 + 状态 + 操作 + 日志）
- [ ] 左侧项目列表（来源分组 + 状态徽标）；右侧 manifest 摘要 + 操作按钮（lucide 图标）+ 诊断日志区。
- [ ] 覆盖 loading/error/empty/success 四态。
- [ ] 构建确认 `npm run build` 通过。
- [ ] Commit。

### Task D4：Vibe Coding 面板（分步向导）
- [ ] 按 `vibe-coding-workflow.md` 的 8 阶段分步呈现，调用 `createPlugin/validatePlugin/buildPlugin/addPluginProject`。
- [ ] Commit。

### Task D5：图标与 README
- [ ] `assets/icon.svg`（开发/工具主题，与 UI 配色一致）→ 用技能 `finalize_plugin_icon.mjs` 生成 `icon.png`。
- [ ] `README.md`（描述/功能/命令/用法/依赖）。
- [ ] `npm run build` + 宿主内手动验收。
- [ ] Commit。

---

## 阶段 E：集成验收（PM + QA）

### Task E1：端到端验收（对应设计 §8）
- [ ] 添加单个插件目录并成功载入。
- [ ] 添加父级开发目录批量载入（回归）。
- [ ] manifest 缺失/无效 → 明确错误。
- [ ] ID 冲突按策略处理并 UI 标记。
- [ ] 移除单个开发项目后宿主刷新。
- [ ] Developer API 类型/文档与实现一致（`npx tsc --noEmit` + 人工核对 developer.md）。
- [ ] 开发者工具插件创建新插件并跑通 build。
- [ ] Vibe Coding 生成插件满足技能 handoff checklist。
- [ ] 全量单测 Run: `node scripts/run-unit-tests.mjs` Expected: PASS。

---

## Self-Review 检查（已执行）
- **Spec 覆盖**：单目录加载(B1/B2)、设置模型 B(A1/A3)、IPC 全集(C1)、preload+docs(C3)、插件(D)、Vibe Coding(D4+独立文档)、测试(A2/A3/B2/B3/C2/E1)、验收(E1) 均有任务。
- **Placeholder**：除插件 UI 任务(D3/D4)为组件级粒度（交 UX 细化）外，无 TBD；纯函数/宿主关键路径给出完整代码。
- **类型一致**：`PluginProjectEntry/Type/Source`、`reloadPlugin`、`getPluginProjectStatus`、`validatePluginAt`、`detectProjectType/dedupeProjects/buildProjectEntry`、`PluginValidationResult/PluginProjectStatus` 全程命名一致。
- **已知取舍**：build/pack 用宿主 spawn IPC（结构化日志、避开 runCommand denylist）；createPlugin 依赖 `npx mulby-cli`（决策 C=b），离线降级明确报错。
