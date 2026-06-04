# Developer API (developer)

> 入口：`window.mulby.developer`
> 代码来源：`src/preload/apis/platform-api.ts`、`src/main/ipc/developer.ts`
> 类型：`src/shared/types/developer.ts`、`src/shared/types/settings.ts`（`PluginProjectEntry`）

开发者工具插件通过该命名空间管理「开发项目」（创建/导入/构建/打包/校验/刷新/移除），并支持 AI Vibe Coding 创作。

## single vs collection（重要）

开发项目分两种类型，**由宿主在添加时自动判别**：

| type | 判别依据 | 加载语义 |
|---|---|---|
| `single` | 目录根部**直接含** `manifest.json` | 作为**单个插件**加载（`loader.loadPlugin`），`isDev=true` |
| `collection` | 目录根部**无** `manifest.json` | 作为**父目录批量扫描**子插件（`loader.loadAll`），保留旧语义 |

旧的 `pluginPaths[]` 会在读取设置时自动迁移为 `collection` / `source='migrated'` 的项目，原值保留只读，向后兼容。

## 类型

```ts
type PluginProjectType = 'single' | 'collection'
type PluginProjectSource = 'added' | 'imported' | 'created' | 'migrated'

interface PluginProjectEntry {
  id: string
  path: string                 // path.resolve 后的绝对路径
  type: PluginProjectType
  source: PluginProjectSource
  label?: string
  createdAt: number
  lastOpenedAt?: number
}

interface PluginValidationResult {
  valid: boolean
  errors: string[]
  manifest?: { id?: string; name?: string; version?: string; displayName?: string; main?: string }
  mainEntryFound: boolean
  built: boolean
}

interface PluginProjectPluginStatus {
  id: string
  displayName: string
  path: string
  manifestValid: boolean
  manifestErrors: string[]
  mainEntryFound: boolean
  built: boolean
  loaded: boolean
  enabled: boolean
  isDev: boolean
  idConflictWith?: string
}

interface PluginProjectStatus {
  projectId: string
  path: string
  type: PluginProjectType
  source: PluginProjectSource
  label?: string
  exists: boolean
  plugins: PluginProjectPluginStatus[]
}
```

## 方法

### LEGACY（保留向后兼容）

#### addPluginPath(path)
添加外部插件开发目录（旧模型，直接写 `pluginPaths`）。建议改用 `addPluginProject`。

#### removePluginPath(path)
移除外部插件开发目录（旧模型）。

#### reloadPlugins()
全量重载插件列表。

#### selectDirectory()
打开系统目录选择器，返回所选路径或 `null`。
- 返回：`Promise<string | null>`

### NEW（pluginProjects[] 模型）

#### addPluginProject({ path, source? })
添加一个开发项目，**自动判别** single/collection 并触发重载。
- 入参：`{ path: string; source?: PluginProjectSource }`（`source` 缺省 `'added'`）
- 返回：`{ success: boolean; project?: PluginProjectEntry; error?: string }`
- 失败场景：目录不存在、项目已存在（按 resolve 路径去重）。

#### removePluginProject({ id? , path? })
从 `pluginProjects` 移除项目并刷新运行态。**不删除磁盘文件**。
- 入参：`{ id?: string; path?: string }`（二选一）
- 返回：`{ success: boolean; error?: string }`

#### reloadPlugin(pluginId)
局部重载单个插件（重读 manifest + 重启 host），开销低于全量 `reloadPlugins`。
- 入参：`pluginId: string`
- 返回：`{ success: boolean; error?: string }`

#### validatePlugin(path)
不落库地校验单个插件目录：manifest 解析、必填字段、平台兼容、main 解析、构建产物。
- 入参：`path: string`
- 返回：`PluginValidationResult`

#### listPluginProjects()
列出全部开发项目及其下插件的运行态状态（供 UI 列表）。
- 返回：`PluginProjectStatus[]`

#### createPlugin({ targetDir, name, template? })
通过 `npx mulby-cli`（技能脚本 `invoke_mulby_cli.mjs`）在 `targetDir` 下创建新插件；成功后自动登记为 `source='created'` 的项目。
- 入参：`{ targetDir: string; name: string; template?: 'react' | 'basic' }`（缺省 `'react'`）
- 返回：`{ success: boolean; path?: string; log: string; error?: string }`
- 依赖网络/CLI 可用性：离线或未安装时返回明确 `error`，提示手动 `mulby create` 或改用「导入目录」。
- CLI 解析顺序（脚本内部）：`MULBY_CLI_ENTRY` → `MULBY_CLI_BIN` → 本地 `node_modules/.bin/mulby` → 全局 `mulby` → `npx --yes mulby-cli@latest`。
- 技能脚本路径：`MULBY_DEV_SKILL_DIR/scripts/invoke_mulby_cli.mjs`，缺省 `~/.cursor/skills/develop-mulby-plugin`。

#### buildPlugin(path)
在项目目录执行 `npm run build`（宿主 spawn，合并 stdout/stderr 流式日志）。
- 入参：`path: string`
- 返回：`{ success: boolean; log: string; error?: string }`

#### packPlugin(path)
在项目目录执行 `npm run pack`。
- 入参：`path: string`
- 返回：`{ success: boolean; outFile?: string; log: string; error?: string }`（`outFile` 从日志中解析 `*.inplugin`）

> 说明：build/pack 用**宿主 IPC + spawn**（锁定工作目录、提供结构化日志、绕开 `shell.runCommand` 默认 denylist），而非插件内 `shell.runCommand`。

#### openPluginDir(path)
在系统文件管理器中打开插件目录（`shell.openPath`）。
- 入参：`path: string`
- 返回：`{ success: boolean; error?: string }`

#### updateProjectMeta({ id, lastOpenedAt?, label? })
更新项目元数据（最近打开时间 / 展示名）。
- 入参：`{ id: string; lastOpenedAt?: number; label?: string }`
- 返回：`{ success: boolean; error?: string }`

## 示例

### 导入单个插件目录并校验

```ts
const dir = await window.mulby.developer.selectDirectory()
if (dir) {
  const v = await window.mulby.developer.validatePlugin(dir)
  if (!v.valid) {
    console.warn('插件无效：', v.errors)
  }
  const res = await window.mulby.developer.addPluginProject({ path: dir, source: 'imported' })
  if (res.success) {
    console.log('已添加项目', res.project)  // project.type 自动判别为 single
  } else {
    console.error(res.error)
  }
}
```

### 列出项目并刷新单个插件

```ts
const projects = await window.mulby.developer.listPluginProjects()
for (const p of projects) {
  for (const plugin of p.plugins) {
    if (plugin.loaded && !plugin.built) {
      await window.mulby.developer.buildPlugin(p.path)
      await window.mulby.developer.reloadPlugin(plugin.id)
    }
  }
}
```

### Vibe Coding：脚手架创建 → 构建 → 校验

```ts
// 1. 选择目标父目录
const targetDir = await window.mulby.developer.selectDirectory()
if (!targetDir) return

// 2. 通过 mulby-cli 创建（自动登记为 created 项目）
const created = await window.mulby.developer.createPlugin({
  targetDir,
  name: 'my-awesome-plugin',
  template: 'react'
})
if (!created.success) {
  console.error('创建失败：', created.error, created.log)
  return
}

// 3. 首次构建
const built = await window.mulby.developer.buildPlugin(created.path!)
console.log(built.log)

// 4. 校验产物
const result = await window.mulby.developer.validatePlugin(created.path!)
console.log('valid =', result.valid, 'built =', result.built)

// 5. 打包分发
const packed = await window.mulby.developer.packPlugin(created.path!)
if (packed.success) console.log('产物：', packed.outFile)
```
