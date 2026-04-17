## 修复总结 — 2026-04-17

基于 `docs/code-review-2026-04-17.md` 的审查结果，本次共处理 **5 项高优先级** 与 **5 项中优先级** 问题。所有修复均通过：

- `pnpm typecheck` ✅
- `pnpm lint` ✅ 0 errors（仅保留原有 40 条 warnings）
- `pnpm test:unit` ✅ 226/226 全部通过（新增 10 条单测）

---

## 高优先级修复

### H1. 插件 `envKeys` 未贯通到 `buildSafeEnv`

**文件**：
- `src/shared/types/plugin.ts` — `PluginPermissions.envKeys?: string[] | '*'`
- `src/main/services/command-runner-core.ts` — `RunCommandContext.envKeys` + `buildSafeEnv(context, env, context.envKeys)`
- `src/main/ipc/shell.ts` — IPC 路径透传 `envKeys`
- `src/main/index.ts` — AI 工具调用路径透传 `envKeys`

**效果**：插件 manifest 声明的 `envKeys` 现在真正控制继承环境变量范围，覆盖 未声明 / 白名单数组 / `*` 三种模式。

### H2. `shell:true` allowList 深度不足

**文件**：`src/main/services/command-runner-core.ts` (`ensureAllowed`)

- 对 `shell:true` 的命令做深度 token 提取
- 过滤掉 `sh/bash/cmd/powershell` 等包装器，对内层真实业务 token 逐个匹配 allowList
- 关键修正：`findMatchingRule(enabledAllowRules, token, token)` — 使用 token 本身作为 commandLine，防止外层 shell wrapper 的前缀匹配误放行内层命令

### H3. `extractShellTokens` 未处理 `$()` / 反引号 + 混淆攻击兜底

**文件**：`src/main/services/command-runner-core.ts`

- `extractShellTokens` 支持递归展开 `$(...)` 与 \`\`，正确处理引号包裹的内层命令
- 新增 `hasObfuscatedShellPatterns` 检测 `-EncodedCommand` / `base64 -d | sh` / `eval $(...)` 等混淆模式
- `ensureAllowed` 中对 `shell:true` 先做混淆特征拦截

### H4. Windows `search/service.ts` 参数引用与 `chcp` 协议

**文件**：`src/main/plugin/search/service.ts`

- 新增 `quoteCmdArg` 专用转义（处理空格、引号、`&|^` 等 cmd.exe 元字符）
- Windows 下改用 `cmd.exe /d /s /c` + `windowsVerbatimArguments: true`
- `chcp 65001>nul && <cmd>` 作为完整命令串传递，避免 Node 的 CommandLineToArgv 风格 quoting 与 cmd.exe 解析冲突

### H5. `spawn(env)` 回退到 `process.env`

**文件**：`src/main/services/command-runner-core.ts` (`execute`)

- `input.env === undefined` 时直接 `reject` 而非 fallback
- 杜绝 safeEnv 构造失败时静默泄漏主进程全部环境变量

### 新增单测（10 条）

`src/main/services/__tests__/command-runner.test.ts`：

- `plugin without envKeys gets minimal safe env baseline only`
- `plugin with envKeys array inherits declared variables`
- `plugin with envKeys="*" inherits full process env`
- `shell:true allowList blocks inner command even if wrapper matches`
- `shell:true allowList passes when all inner tokens are whitelisted`
- `shell:true denyList catches command inside $() substitution`
- `shell:true denyList catches command inside backtick substitution`
- `shell:true rejects obfuscated patterns (-EncodedCommand / eval base64)`
- `app source without input env still runs (safeEnv inherits process.env)`

---

## 中优先级修复

### M1. `@electron/rebuild` + pnpm 兼容性

**文件**：
- `package.json` — `postinstall` 改为 `electron-rebuild --force --types prod,optional --which-module better-sqlite3,sharp,koffi,usocket,node-mac-permissions`
- `.github/workflows/ci.yml` — 新增 native 模块 smoke test 步骤（三平台 `require()` 验证）

**效果**：明确指定依赖类型与需重建模块，避免 pnpm symlink 化 `node_modules` 下 `electron-rebuild` 漏建 native 依赖；CI 中主动验证避免"本地跑通，用户启动白屏"。

### M2. BrowserWindow 未注册时的 untrusted 漏报 + 系统内部窗口显式注册

**文件**：
- `src/main/services/ipc-caller-resolver.ts` — 新增 `systemInternalWindowIds` + `registerSystemInternalWindow` / `unregisterSystemInternalWindow`，并对真正的"非系统、未注册"窗口按 winId 去重打印告警
- 6 处系统内部窗口显式注册：
  - `src/main/services/ui-dialog-service.ts`
  - `src/main/services/search-window-service.ts`（解析 worker + 搜索 session 两种）
  - `src/main/openclaw/handlers/canvas-handler.ts`
  - `src/main/plugin/color-pick.ts`
  - `src/main/plugin/region-capture.ts`
  - `src/main/browser/InBrowserWindow.ts`

**效果**：`resolveIpcCallerSource` 对系统内部窗口静默归类为 `app` 来源；真正可疑的 untrusted IPC 会打印一条（去重）告警，便于事后排查。

### M3. 队列满 / 并发拒绝路径未写入审计

**文件**：`src/main/services/command-runner-core.ts`

- `acquire()` 失败路径独立 `try/catch`，写入 `status=blocked, reason=<队列已满>` 审计条目再抛出
- 不会触发 `release()`（未进入主 try）

### M4. `destroy` 路径显式 `unregister` 插件窗口

**文件**：`src/main/plugin/window.ts`

- `closeAll()` / `closeDetached()` / `closeDetachedWindowsByPlugin()` 在关闭前显式 `unregisterPluginWindow(windowId)`
- 防御 `closed` 事件因进程提前退出或外部 `destroy()` 未触发导致的注册表残留

### M5. `super-panel-window.ts` 事件注册顺序

**文件**：`src/main/services/super-panel-window.ts`

- 先 `registerAppWindow(winId)`，再绑定 `closed` 事件，最后赋值 `this.window`
- 消除极端时序下 `unregister` 先于 `register` 的可能
- 去除冗余的 `if (win)` 判断，改用闭包 `winId` 避免窗口对象访问

---

## 变更统计

```
35 files changed, 862 insertions(+), 16859 deletions(-)
```
（大量 delete 来自移除旧的 `package-lock.json`，与本次安全修复无关，属于 pnpm 迁移分支的组合提交范围）

## 仍未处理（低优先级）

参见 `docs/code-review-2026-04-17.md` 的 🟢 章节，包含若干风格/日志类建议，本次未纳入修复范围。
