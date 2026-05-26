# Directory Access API (directoryAccess)

本文档描述插件动态目录授权 API。它用于让插件在运行时向用户申请某个目录的读取或读写权限。

> 使用入口：
> - UI/渲染进程：`window.mulby.directoryAccess`
> - 插件后端：`context.api.directoryAccess`

目录授权不需要在 `manifest.json` 中预声明。授权由用户在运行时确认，持久保存，直到用户或插件主动撤销。

授权目录会扩展该插件的工作区根目录：

- `read`：允许插件承载的 AI 文件读取、目录列表、文本搜索、`git.status`、`git.diff` 在该目录下工作。命令读取场景会把该目录纳入只读 root。
- `readwrite`：包含 `read` 能力，并允许 `shell.runCommand` 的 `workspace`/`sandbox` profile、AI `patch.apply` 和命令型能力在该目录下作为可写 root 工作。

> 目录授权只扩展 root 范围，不等于命令执行授权。插件直接调用 `shell.runCommand` 仍需要 `permissions.commandExecution.direct.enabled: true`；插件承载 AI 使用 `shell.exec`、`shell.script`、`patch.apply`、`git.status`、`git.diff` 等命令型能力仍需要 `permissions.commandExecution.ai.enabled: true`。

## 数据结构

```ts
type PluginDirectoryAccessMode = 'read' | 'readwrite'

interface PluginDirectoryAccessGrant {
  id: string
  pluginId: string
  path: string
  mode: PluginDirectoryAccessMode
  source: 'picker' | 'path-confirmation'
  reason?: string
  createdAt: number
  lastUsedAt?: number
}

interface PluginDirectoryAccessRequestInput {
  path?: string
  mode?: PluginDirectoryAccessMode
  title?: string
  message?: string
  reason?: string
}
```

## 方法

### directoryAccess.request(input)
[Renderer] [Backend]
申请目录授权。

不传 `input.path` 时，Mulby 会打开系统目录选择器；传入 `input.path` 时，Mulby 会显示确认弹窗，让用户确认是否授权这个具体目录。目标路径必须是已存在的目录。

```ts
const grant = await window.mulby.directoryAccess.request({
  mode: 'readwrite',
  reason: '在用户选择的项目目录中运行构建命令'
})

if (grant) {
  await window.mulby.shell.runCommand({
    command: 'git',
    args: ['status'],
    cwd: grant.path,
    executionProfile: 'workspace'
  })
}
```

插件后端也可以申请：

```ts
export async function run(context: BackendPluginContext) {
  const grant = await context.api.directoryAccess.request({
    path: '/Users/me/project',
    mode: 'read',
    reason: '读取项目文件用于分析'
  })

  if (!grant) return
  const status = await context.api.shell.runCommand({
    command: 'git',
    args: ['status', '--short'],
    cwd: grant.path,
    executionProfile: 'workspace'
  })
  console.log(status.stdout)
}
```

**参数**

- `input.path` (string, optional): 申请访问的具体目录。不传时打开目录选择器。
- `input.mode` (`"read" | "readwrite"`, optional): 权限范围，默认 `"read"`。
- `input.title` (string, optional): 选择器或确认弹窗标题。
- `input.message` (string, optional): 确认弹窗正文，仅 `path` 模式使用。
- `input.reason` (string, optional): 展示给用户的申请原因，也会保存到授权记录中。

**返回值**

- `Promise<PluginDirectoryAccessGrant | null>`：用户授权时返回授权记录；取消或拒绝时返回 `null`。

### directoryAccess.list()
[Renderer] [Backend]
列出当前插件已有的目录授权。

```ts
const grants = await window.mulby.directoryAccess.list()
```

**返回值**

- `Promise<PluginDirectoryAccessGrant[]>`

### directoryAccess.revoke(grantIdOrPath)
[Renderer] [Backend]
撤销当前插件的某条目录授权。参数可以是 `grant.id`，也可以是授权目录路径。

```ts
const grants = await window.mulby.directoryAccess.list()
if (grants[0]) {
  await window.mulby.directoryAccess.revoke(grants[0].id)
}
```

**参数**

- `grantIdOrPath` (string): 授权 ID 或目录路径。

**返回值**

- `Promise<boolean>`：成功撤销返回 `true`；没有匹配授权返回 `false`。

## 安全说明

- 授权按插件 ID 隔离，一个插件不能列出或撤销其他插件的目录授权。
- `read` 授权会被 Mulby 内置文件工具严格校验；命令只读场景在可用的 OS sandbox 后端中会把该目录作为只读 root，回退到 policy sandbox 时无法完整阻止子进程自行写文件。
- `readwrite` 授权会进入命令执行 root 计算，但仍受全局 `denyList`、`allowList`/确认、profile、网络和 sandbox 策略约束。
