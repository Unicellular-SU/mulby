# Shell API (shell)
本文档描述 `shell` API 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.intools.shell`
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
shell.showItemInFolder('/path/to/file.txt');
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
shell.beep();
```

**返回值**
- `void`（Renderer 侧调用返回 `Promise<void>`）

## 命令执行能力

### runCommand(input)
[Renderer] [Backend]
执行系统命令。支持任意可执行命令（不限 `*.py`，可执行 `js`/`node`/shell 命令等）。

执行前会经过全局策略校验：
- 总开关（`enabled`）
- 插件权限声明校验（插件必须声明 `manifest.permissions.runCommand: true`）
- `shell=true` 策略（`allowShell`）
- 黑名单/白名单规则
- 首次命令指纹用户确认（`requireConsent`）

```javascript
// 推荐在插件后端使用（Node 环境可用 process.execPath）
const result = await shell.runCommand({
  command: process.execPath,
  args: ['-e', 'console.log("hello from js")'],
  timeoutMs: 10000,
  shell: false
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

若插件需要调用 `runCommand`，必须在 `manifest.json` 中声明权限：

```json
{
  "permissions": {
    "runCommand": true
  }
}
```

未声明时调用会被拒绝，并记录为 `blocked` 审计事件。
