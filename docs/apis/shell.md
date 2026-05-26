# Shell API (shell)
本文档描述 `shell` API 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.shell`
> - 插件后端：`context.api.shell`

Shell API 提供系统级操作，包括打开文件、URL、文件管理器，以及受策略保护的命令执行能力（`runCommand`）。

## 基础能力

### openPath(path)
[Renderer] [Backend]
使用系统默认应用打开文件。

```javascript
await shell.openPath('/path/to/image.png');
await shell.openPath('/path/to/document.pdf');
```

**参数**
- `path` (string): 文件路径

**返回值**
- `Promise<string>`: 错误信息，成功时为空字符串

### openExternal(url)
[Renderer] [Backend]
使用系统默认浏览器打开 URL。

```javascript
await shell.openExternal('https://www.example.com');
await shell.openExternal('mailto:test@example.com');
```

**参数**
- `url` (string): URL 地址（支持 `http`、`https`、`mailto` 等协议）

**返回值**
- `Promise<void>`

### showItemInFolder(path)
[Renderer] [Backend]
在文件管理器中显示并选中文件。

```javascript
await shell.showItemInFolder('/path/to/file.txt');
```

**参数**
- `path` (string): 文件路径

**返回值**
- `void`（Renderer 侧调用返回 `Promise<void>`）

### openFolder(path)
[Renderer] [Backend]
打开文件所在目录（传目录则直接打开目录）。

```javascript
await shell.openFolder('/path/to/file.txt');
await shell.openFolder('/path/to/directory');
```

**参数**
- `path` (string): 文件或目录路径

**返回值**
- `Promise<string>`: 错误信息，成功时为空字符串

### trashItem(path)
[Renderer] [Backend]
将文件移动到回收站/废纸篓。

```javascript
await shell.trashItem('/path/to/file.txt');
```

**参数**
- `path` (string): 文件路径

**返回值**
- `Promise<void>`

### beep()
[Renderer] [Backend]
播放系统提示音。

```javascript
await shell.beep();
```

**返回值**
- `void`（Renderer 侧调用返回 `Promise<void>`）

## 命令执行能力

### runCommand(input)
[Renderer] [Backend]
执行系统命令。支持任意可执行命令（不限 `*.py`，可执行 `js`/`node`/shell 命令等）。

执行前会经过全局策略校验：
- 总开关（`enabled`）
- 插件权限声明校验（插件直接调用需声明 `manifest.permissions.commandExecution.direct.enabled: true`；旧版 `runCommand: true` 仍兼容）
- `shell=true` 策略（`allowShell`）
- 黑名单/白名单规则
- allowList 命中可免确认；allowList 未命中不会硬拒绝，会进入用户确认流程
- 首次命令指纹用户确认（`requireConsent`）
- 执行环境 profile（`sandbox` / `workspace` / `trusted`）与调用方允许的最大 profile
- `sandbox` profile 的 cwd/root、环境变量、网络和 OS sandbox/policy sandbox 策略
- 插件动态目录授权；`directoryAccess` 的 `readwrite` 授权会扩展该插件可用的命令 root

```javascript
// 推荐在插件后端使用（Node 环境可用 process.execPath）
const result = await shell.runCommand({
  command: process.execPath,
  args: ['-e', 'console.log("hello from js")'],
  timeoutMs: 10000,
  shell: false,
  executionProfile: 'sandbox'
});

console.log(result.stdout);
```

```javascript
// Python 示例（前提：python3 在 PATH 中）
const result = await shell.runCommand({
  command: 'python3',
  args: ['-c', 'print("hello from py")'],
  timeoutMs: 10000
});
```

**参数**
- `input.command` (string): 要执行的命令（必填）
- `input.args` (string[], optional): 参数列表
- `input.cwd` (string, optional): 工作目录
- `input.env` (Record<string, string>, optional): 额外环境变量
- `input.timeoutMs` (number, optional): 超时时间（毫秒，受全局最大值约束）
- `input.shell` (boolean, optional): 是否通过 shell 执行（默认 `false`）
- `input.executionProfile` (`"sandbox" | "workspace" | "trusted"`, optional): 请求的执行环境。不能超过调用方权限允许的最大 profile。
- `input.network` (boolean, optional): 是否请求网络能力。`sandbox` 默认禁止网络；除非全局 sandbox 设置允许，否则会被拒绝。
- `input.writableRoots` (string[], optional): 本次命令希望使用的可写根目录。只能在全局配置根目录和当前插件已获 `directoryAccess` `readwrite` 授权的目录内收窄，不能扩大到任意路径。

**执行环境 profile**

| Profile | 适用场景 | 默认约束 |
| --- | --- | --- |
| `sandbox` | AI 生成命令、低信任命令 | 受限继承环境变量（继承完整 `process.env`，但过滤全局安全黑名单 `denyEnvKeys` 与危险注入变量，除非在 `manifest.envKeys` 中显式声明）、限制 cwd/root、禁止 `shell=true`、默认禁网；优先使用 OS sandbox 后端，不可用时回退 policy sandbox。 |
| `workspace` | 明确授权的插件直接命令、OpenClaw 等 | 限制 cwd/root，仍受 denyList/allowList/consent 保护。 |
| `trusted` | 主应用或 legacy 兼容场景 | 不做 root 限制，仍受全局命令策略保护。 |

> `sandbox` 的 OS 后端按平台选择：macOS 使用 `sandbox-exec`，Windows 使用 Job Object 进程约束，Linux 使用 namespace/unshare。后端不可用时默认回退到 policy sandbox，并在审计中记录 `sandboxFallbackReason`。

> 如果插件需要在用户项目目录中执行命令，推荐先通过 [`directoryAccess.request()`](./directory-access.md) 获取目录授权，再把返回的 `grant.path` 作为 `cwd`。目录授权只扩展 root 范围，不替代 `commandExecution.direct` 或 `commandExecution.ai` 命令权限。

**返回值**
- `Promise<RunCommandResult>`

```ts
type RunCommandResult = {
  success: boolean
  command: string
  args: string[]
  cwd?: string
  shell: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
}
```

## 命令策略与审计

### getRunCommandPolicy()
[Renderer] [Backend]
读取命令执行策略。

- Renderer：返回完整策略
- 插件后端：返回脱敏策略子集（`enabled`、`requireConsent`、`allowShell`、`allowList`、`denyList`）

```javascript
const policy = await shell.getRunCommandPolicy();
```

### updateRunCommandPolicy(patch)
[Renderer]
更新命令执行策略（系统级配置，仅 Renderer 可用）。

```javascript
await shell.updateRunCommandPolicy({
  enabled: true,
  requireConsent: true,
  allowShell: false
});
```

### listRunCommandAudit(limit?)
[Renderer] [Backend]
读取命令审计记录。

- Renderer：读取全局审计
- 插件后端：仅返回当前插件自身相关审计记录

```javascript
const records = await shell.listRunCommandAudit(100);
```

审计记录会包含执行来源、caller identity、profile 和 sandbox 后端信息。常用字段：

```ts
type CommandAuditItem = {
  source: 'app' | 'plugin'
  pluginId?: string
  executionProfile?: 'sandbox' | 'workspace' | 'trusted'
  sandboxLevel?: 'os' | 'policy' | 'none'
  sandboxBackend?: 'policy' | 'macos-sandbox-exec' | 'windows-job-object' | 'linux-namespace'
  sandboxFallbackReason?: string
  networkAllowed?: boolean
  rootScope?: string[]
  status: 'allowed' | 'blocked' | 'error' | 'timeout'
}
```

### clearRunCommandAudit()
[Renderer]
清空全局命令审计记录（仅 Renderer 可用）。

```javascript
await shell.clearRunCommandAudit();
```

### clearRunCommandTrusted()
[Renderer]
清空已信任命令指纹（仅 Renderer 可用）。

```javascript
await shell.clearRunCommandTrusted();
```

## 插件权限声明示例

若插件后端代码需要直接调用 `context.api.shell.runCommand`，新插件推荐声明 `commandExecution.direct`：

```json
{
  "permissions": {
    "commandExecution": {
      "direct": {
        "enabled": true,
        "defaultProfile": "workspace",
        "maxProfile": "workspace"
      }
    }
  }
}
```

旧插件仍可使用 `runCommand: true`，它只表示“插件自身直接调用命令”的 legacy 授权：

```json
{
  "permissions": {
    "runCommand": true
  }
}
```

未声明时调用会被拒绝，并记录为 `blocked` 审计事件。

如果插件承载自己的 AI 聊天/Agent，并希望这个 AI 使用 Mulby 内置命令工具，必须额外声明 `commandExecution.ai`。`runCommand: true` 不会授权 AI 生成命令：

```json
{
  "permissions": {
    "commandExecution": {
      "ai": {
        "enabled": true,
        "defaultProfile": "sandbox",
        "maxProfile": "workspace"
      }
    }
  }
}
```

## 与 AI / Skills 联动

内置命令工具属于 **AI 会话能力**，并不只属于 Skills：

- 工具名：`mulby_run_command`
- Skills 作用：提供提示词/能力需求信号，影响本次会话的 capability 选择与策略裁决
- 是否最终可执行：由主进程策略层统一决定（capability policy + runCommand policy）

也就是说，普通 AI 调用与启用 Skills 的 AI 调用都走同一执行链路；Skills 只改变“请求什么能力”，不直接绕过安全策略。

该工具的执行仍然完全受 `runCommand` 全局策略约束：

- 总开关、黑白名单、`allowShell`
- 用户同意确认流（`requireConsent`）
- 插件承载 AI 场景下的 `manifest.permissions.commandExecution.ai.enabled` 校验
- profile / sandbox / root / network 策略

如果命令被 capability/runCommand 策略拦截或用户拒绝，工具会返回结构化失败结果（`success: false` + `stderr/error`），AI 可继续给出降级方案。
