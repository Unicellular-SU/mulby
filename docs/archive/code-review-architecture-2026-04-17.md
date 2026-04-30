# 架构与安全审查报告

- **审查时间**：2026-04-17
- **审查范围**：`src/**`、`packages/mulby-cli/src/**`（排除 `docs/`）
- **审查方式**：阅读实际代码 + 交叉验证调用链 + CI 链路复核
- **前置**：已阅读本仓库之前的 `docs/code-review-2026-04-17.md` 和 `code-review-2026-04-17-fix-summary.md`。本次聚焦架构层漏洞与代码审查文档尚未覆盖的问题。

> ⚠️ 简要结论：主干代码质量高、分层清晰、已经建立了 IPC 调用方身份识别、命令执行沙箱等基础设施。**但 `ipc-caller-resolver` 当前只被 `shell.ts` 使用，storage / filesystem / http / input / dialog 等 30+ 通道全部默认信任 renderer**，导致多个严重等级的跨插件越权 / SSRF / 任意文件操作漏洞。修复方向清晰（统一套用 caller resolver + pluginId 注入），工作量集中、收益极高。

---

## 🔴 高危（强烈建议合入前修复）

### H1. 插件 Storage (SQLite) 全局可跨命名空间读写

**位置**：`src/main/ipc/storage.ts` 全文、`src/preload/apis/platform-api.ts:146-183`

```ts
ipcMain.handle('storage:get', (_, key, namespace = 'global') => {
  const row = stmtGet.get(namespace, key) as { value: string } | undefined
  return row ? JSON.parse(row.value) : undefined
})

ipcMain.handle('storage:set', (_, key, value, namespace = 'global') => {
  stmtSet.run(namespace, key, JSON.stringify(value), Date.now())
  ...
})
```

- `namespace` 参数**完全来自 renderer**，被直接当作 SQL 行的 `plugin_id`
- 任何插件 / 面板 renderer 调用 `window.mulby.storage.get('token', 'rival-plugin-id')` 就能读走别的插件保存在 SQLite 里的秘钥、凭据、用户偏好
- `set` / `remove` / `clear` / `transaction` / `append` 全部同样开放，可以篡改或清空他人数据
- **实际伤害**：任何被用户信任安装的插件都可以把主应用的 `global` 命名空间（含 AI 提供商 API Key 等）一次性窃走

**修复建议**（按影响面排序）：

1. 在 `storage.ts` handler 入口调用 `resolveIpcCallerSource(event.sender)`
2. 根据 caller:
   - `source: 'app'` → 允许任意 namespace
   - `source: 'plugin'` → **强制** 把 `namespace` 覆写为 `caller.pluginId`（忽略 renderer 传入的值，或报错）
   - `source: 'untrusted'` → throw
3. 同时保留 `listNamespaces` / `clear(otherNs)` 作为 app-only 路由
4. 给 storage handler 补单测：插件 renderer 访问其他 namespace 必须被拒绝

此修复可与 M4（统一 caller 注入）一并实施。

---

### H2. Filesystem IPC 不带插件身份，可跨插件读写/删除私有数据

**位置**：`src/main/ipc/filesystem.ts:1-6`、`src/main/plugin/filesystem.ts:100-144`

```ts
// IPC 层无法识别调用者插件身份，不传 pluginName
// 但仍然会启用系统路径黑名单保护（阻止写入/删除 /System, /usr 等）
const pluginFilesystem = new PluginFilesystem()
```

- 文件这一设计**显式放弃** `checkPluginDataBoundary` 保护
- `PluginFilesystem` 本身已经实现了跨插件边界校验（要求路径 `userData/plugin-data/<pluginName>/...`），但 IPC 通道绕过了这层
- 攻击面：插件 A 可以 `writeFile('/Users/.../userData/plugin-data/bank-helper/wallet.json', fakePayload)` 或 `unlink` 其它插件的核心数据文件

**修复建议**：

1. 在 `registerFilesystemHandlers` 入口调用 `resolveIpcCallerSource(event.sender)`
2. 对 `source: 'plugin'` 的调用，**每次** `new PluginFilesystem(caller.pluginId)` 并用其执行；不要复用 IPC 全局单例
3. 对 `source: 'app'` 仍可使用无 pluginName 实例
4. 注意 `pluginFilesystem` 的构造函数会 mkdir，per-request 构造有 IO 开销，可以做 `Map<pluginId, PluginFilesystem>` 缓存

注释里"IPC 层无法识别调用者插件身份"已经过时——仓库早有 `ipc-caller-resolver`，只是当前没接通。

---

### H3. HTTP IPC 无调用方校验、无协议白名单、无响应大小限制

**位置**：`src/main/ipc/http.ts:1-27`、`src/main/plugin/http.ts:17-93`

- `http:request` 接受**任意 URL**（含 `file://`、`ftp://`、`data:`……）。Electron `net.request` 只支持 `http:` / `https:` / `ftp:` / `file:`，但 `file://` 足以读本地文件
- 无调用方识别 — 任何插件 renderer 可通过 Mulby 主进程发起请求，**绕过浏览器 CORS**
- 无响应大小上限 — `responseChunks: Buffer[]` 无限累积；恶意 URL 返回大文件可致主进程 OOM 崩溃
- 无 DNS rebinding / 内网黑名单 — 可请求 `http://127.0.0.1:xxxx` 内网服务（典型 SSRF）

**修复建议**：

1. 协议白名单：`['http:', 'https:']`；拒绝其它
2. 私网/环回黑名单：hostname 为 `127.0.0.1` / `localhost` / `::1` / `10.x.x.x` / `169.254.x.x` 等时需显式允许或通过 caller check（app-only）
3. 响应体大小上限（如 50 MB）和累计超时（同时间窗内最大 N 个请求）
4. 接入 `ipc-caller-resolver`，对 `source: 'plugin'` 请求可考虑要求 manifest 里声明 `permissions.network: true`（与现有 `runCommand` 权限对称）

---

### H4. Shell IPC 文件操作无调用方校验 — 任何插件可回收 / 定位任意文件

**位置**：`src/main/ipc/shell.ts:28-56`

```ts
ipcMain.handle('shell:openPath',       (_, path) => pluginShell.openPath(path))
ipcMain.handle('shell:showItemInFolder', (_, path) => pluginShell.showItemInFolder(path))
ipcMain.handle('shell:openFolder',     (_, path) => pluginShell.openFolder(path))
ipcMain.handle('shell:trashItem',      (_, path) => pluginShell.trashItem(path))
```

- `trashItem` 直接调 `shell.trashItem(path)`，**任何插件都能 trash 用户桌面上的任意文件**（只要存在）——这不是 `runCommand` 级别的高危，但 silent destruction 足够破坏用户体验并无审计痕迹
- `openPath` / `openFolder` 能被利用做社工（弹出"意外文件"引诱点击）

**修复建议**：

- 同 H1/H2，接入 `ipc-caller-resolver`
- `source: 'plugin'` 时至少限制 `trashItem` 必须在插件自己的 `plugin-data/<id>/` 下
- `shell:openExternal` 已有协议白名单，推荐保留。但它也应识别调用方，避免 phishing deep link 被插件反复打开（加频率限制或用 `deep-link-security.ts` 里的 `isRateLimited`）

---

### H5. `extract-zip` 解压无大小/条目上限 — zip bomb DoS

**位置**：`src/main/plugin/installer.ts:60, 148`

```ts
await extractZip(filePath, { dir: tempDir })        // 第 60 行
...
await extractZip(filePath, { dir: targetDir })      // 第 148 行（二次解压）
```

- `extract-zip` v2 已经内置防 zip slip（`../` 逃逸校验），这点 OK
- 但**没有条目数 / 解压后总体积 / 单文件大小上限**，构造 1MB 压缩 → 解压 10 GB 的 zip bomb 可在安装阶段耗尽磁盘 & RAM
- **重复解压**：第 60 行已经解压一次用于读 manifest，第 148 行又解压一次，安装 10 MB 的插件会做 20 MB I/O。建议从 tempDir 直接 rename 到 targetDir

**修复建议**：

```ts
const zip = new (require('yauzl').openPromise)(filePath)  // 或类似的流式读
let totalSize = 0
for await (const entry of zip) {
  if (entry.uncompressedSize > MAX_ENTRY_SIZE) throw new PluginSecurityError('zip 单文件过大')
  totalSize += entry.uncompressedSize
  if (totalSize > MAX_TOTAL_SIZE) throw new PluginSecurityError('zip 总大小超限')
  if (entriesCount > MAX_ENTRIES) throw new PluginSecurityError('zip 条目过多')
  // ... 流式写入
}
```

或保留 `extract-zip`，但先用 `yauzl` 读取 central directory 做 budget 检查，再调用 `extract-zip`。

另外：合并两次解压为一次（解压到 tempDir → 读 manifest → 重命名 / 重命名失败再 copy 到 targetDir），减少一半 I/O。

---

## 🟠 中危

### M1. macOS NSPanel 焦点死锁（本次已修复）

**位置**：`src/main/index.ts` `showMainWindow()`、`src/main/plugin/input.ts` `withHiddenWindow()`

已在本次会话修复：

- `showMainWindow()` 开头追加 `app.show()`、显示后追加 `app.focus({ steal: true })`
- `withHiddenWindow()` 的 `action()` 抛错路径自动调 `restoreHiddenWindows()`

原因追溯：NSPanel 只在 App active 时能成为 key window；`plugin/input.ts:176` 与 `ipc/window.ts:461` 里的 `app.hide()` 未被配对的 `app.show()` 平衡，导致搜索框输入不响应。详见本次会话摘要。

---

### M2. `ipc-caller-resolver` 基础设施未被大规模采纳

**位置**：grep `rg 'resolveIpcCallerSource' src/main/ipc` → **只出现在 `shell.ts`**

- `src/main/services/ipc-caller-resolver.ts` 的注释写得很清楚：
  > 解决安全问题：防止插件 renderer 通过通用 preload 暴露的 shell:runCommand IPC 通道以 source:'app' 身份绕过权限检查

- 但除了 `shell.ts`，其余 40+ IPC handler 全部直接信任 `event.sender` ——所有上面 H1–H4 的问题都是"基础设施已有，但没有应用"

**修复建议**：

1. 建立 **IPC handler 注册时统一包装**：
   ```ts
   function appOnly(handler) {
     return (event, ...args) => {
       const caller = resolveIpcCallerSource(event.sender)
       if (caller.source !== 'app') throw new Error('仅主应用可调用')
       return handler(event, ...args)
     }
   }

   function pluginAware(handler) {
     return (event, ...args) => {
       const caller = resolveIpcCallerSource(event.sender)
       return handler(caller, ...args)
     }
   }
   ```
2. 对 `settings:*` / `openclaw:*` / `developer:*` / `super-panel:action` / `system-page:*` 这些理应是 `app-only` 的通道统一用 `appOnly`
3. 对 `storage:*` / `filesystem:*` / `http:*` 用 `pluginAware`，把 pluginId 强制注入

注册审计表（部分需要 app-only 的 handler）：

| 通道 | 当前校验 | 期望 |
| --- | --- | --- |
| `shell:runCommand` | ✅ | ✅ |
| `shell:*RunCommand*` | ✅ | ✅ |
| `shell:openPath / trashItem / openFolder / showItemInFolder / openExternal` | ❌ | pluginAware |
| `storage:*` | ❌ | pluginAware |
| `filesystem:*` | ❌ | pluginAware |
| `http:*` | ❌ | pluginAware |
| `settings:*` | ❌ | appOnly |
| `developer:*` | ❌ | appOnly |
| `super-panel:action / close / getState` | ❌ | appOnly |
| `subInput:set` | ✅（限制为 panelWin 发起） | ✅ |
| `openclaw:*` | ❌ | appOnly |
| `onboarding:*` | ❌ | appOnly |
| `tray:*` / `tray-menu:*` | ❌ | appOnly |

---

### M3. Permission Request Handler 默认允许

**位置**：`src/main/plugin/permission-manager.ts:110-138`

```ts
session.defaultSession.setPermissionRequestHandler(
  (_webContents, permission, callback, details) => {
    const permType = this.mapElectronPermission(permission)
    if (permType) {
      if (process.platform === 'darwin') {
        const status = this.getStatus(permType)
        callback(status === 'granted')
      } else {
        // Windows/Linux: 默认允许（可以在这里添加自定义 UI）
        callback(true)  // ← 这行
      }
    } else {
      callback(false)
    }
  }
)
```

- `_webContents` 没有被识别 — 任何 webContents（包括插件窗口）请求 camera / microphone / geolocation 都自动放行
- 注释已经埋了 TODO "可以在这里添加自定义 UI"
- 这是 Electron 安全白皮书里明确警告的反模式

**修复建议**：

- Windows/Linux 上接入 `windowFromWebContents` → `resolveIpcCallerSource`
- 对 `source: 'plugin'` 的调用，必须有显式 `permissions.media / camera / microphone` 声明才放行
- 对其它来源返回 `callback(false)`，或弹 `showInternalMessageBox` 让用户确认

---

### M4. 插件 API 表面缺"网络/文件"细分权限

**位置**：`src/main/plugin/manager.ts`、`src/shared/types/plugin.ts` manifest 定义

当前 `manifest.permissions` 只有 `runCommand` / `envKeys`。但以下能力其实都应该受 manifest 约束：

- 任意 `http:*`（H3）
- 任意 `filesystem:*` 路径范围
- 任意 `trashItem` / `openPath`
- `input:*`（模拟键盘鼠标 → 可盗取其它 App 焦点）
- `shortcut:register` / `tray:create` / `menu:showContextMenu`（UI 资源消耗 & spoofing）
- `openclaw:*`（远程命令执行通道）

**建议模型**：

```ts
manifest.permissions = {
  runCommand: true,
  envKeys: ['JAVA_HOME'],
  network: { http: true, allowedHosts?: string[] },
  filesystem: { readPaths?: string[], writePaths?: string[] },
  input: true,
  tray: true,
  shortcut: true
}
```

实施可分阶段：先加声明字段、默认不强制；第二阶段再在对应 IPC handler 里强制。配合 M2 的 `pluginAware` 包装统一落地。

---

### M5. `super-panel-manager.ts` `viewPlugin` 直接 `require('electron')`

**位置**：`src/main/services/super-panel-manager.ts:724-730`

```ts
case 'viewPlugin': {
  ...
  this.hidePanel()
  try {
    const { BrowserWindow: BW } = require('electron')
    ...
```

- 运行时 `require('electron')` 是反模式，阻断 tree-shaking，还让 TS 类型检查弱化
- `BrowserWindow.getAllWindows().find(w => ...)` 来"猜"主窗口 id 很脆弱，多个主 app 窗口 + detached plugin 窗口混合时会挑错

**修复建议**：改成构造器注入 `getMainWindow` 回调，跟 `system-page-window-manager` 保持一致模式。

---

### M6. `plugin/input.ts` `hideAllAppWindows()` 会误伤 detached 插件窗口

**位置**：`src/main/plugin/input.ts:162-178`

```ts
function hideAllAppWindows(): void {
  hiddenWindows.clear()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.isVisible()) {
      hiddenWindows.add(win.id)
      win.hide()
    }
  }
  if (process.platform === 'darwin') {
    app.hide()
  }
}
```

- 调用方初衷只是让"主窗口"和"当前插件面板"让出焦点，但循环里把**所有可见窗口全部 hide**，包括用户已经 detach 成独立窗口的其它插件，以及系统页面
- 用户体验：在用「翻译插件」时打开了「笔记插件」并拖出成独立窗口，接下来翻译插件 `pasteText` 时笔记插件被强制隐藏，得重新调出

**修复建议**：

- 只 hide `mainWindow` + `panelWindow` + 当前插件 detached 窗口（如有）
- 保留其它 detached 插件窗口可见
- detached window registry 可以从 `pluginWindowManager.getAllDetachedWindows()` 拿

---

### M7. `installer.ts` 双重解压 + 同步读 manifest

**位置**：`src/main/plugin/installer.ts:60, 148, 70`

同 H5 提到，还有：

- 第 70 行 `JSON.parse(readFileSync(manifestPath, 'utf-8'))` 对未校验的 manifest.json **直接 JSON.parse + 取 name/id/version 用作路径**
- `safeName = basename(String(manifest.name)).replace(/[<>:"|?*]/g, '_')` 对 NUL 字节（`\0`）没处理，POSIX 系统会把 `name\0.real` 截断
- 第 148 行使用的 `targetDir = existing?.path || join(this.pluginsDir, safeName)`，**如果是更新路径**（existing 存在），`targetDir` 是旧的 existing.path，但此时旧目录刚在 126 行被 `rmSync(existing.path, { recursive: true, force: true })` —— 安全；但 `findInstalledById` 依赖 manifest.id 反查，和 safeName 不一致时会出现"逻辑旧路径被删，物理新路径却走不同目录"的情况

**修复建议**：

- `safeName` 清洗后再加一层 `assert(!safeName.includes('\0'))`
- 更新路径下也要对 existing.path 做 `normalize() + startsWith(pluginsDir + sep)` 校验
- 合并为单次解压（streams + yauzl）

---

## 🟡 低危 / 可维护性

### L1. `src/main/index.ts` 已膨胀到 1700+ 行

承担了：单实例锁、主窗口生命周期、阴影窗口、blur 管理、快捷键、IPC 注册统筹、deep link、托盘、activeWindow 缓存、app lifecycle、AI tool executor、system-page 路由、plugin store 路由、updater……

**建议渐进拆分**：

- 主窗口相关：已经开始有 `main-window-frame.ts`，可继续拉 `services/main-window-service.ts`
- AI tool executor（`setAiToolExecutor` 回调内 300 多行）拉到 `main/ai/tool-executor.ts`
- Deep link 已经有独立文件，但 `pendingDeepLinkUrl` / `lastDeepLinkTime` 等变量留在 `index.ts`
- `handleAppActivate` / `handleSecondInstance` 拉到 `services/app-lifecycle.ts`

### L2. `blur-manager.ts` 的 stopIgnoringBlur 100ms 延迟开关

**位置**：`src/main/services/blur-manager.ts:50-60`

```ts
export function stopIgnoringBlur(): void {
  ignoreCount = Math.max(0, ignoreCount - 1)
  if (ignoreCount === 0) {
    setTimeout(() => {
      if (ignoreCount === 0) {
        ignoringBlur = false
      }
    }, 100)
  }
}
```

- 计数器 + 延迟 flag 的双层机制会有短暂"计数为 0 但 flag 仍 true"的窗口期
- `withIgnoringBlur` / `withDialogMode` 并发时偶发竞态（比如 dialog 开-关-开 间隔 <100ms 时 flag 永远不会被真正关掉）
- 推荐：用单一计数器，`isIgnoringBlur = ignoreCount > 0`，去掉延迟 flag

### L3. `storage.ts` `watchRegistry` 可能累积

**位置**：`src/main/ipc/storage.ts:246-263`

- `storage:watch` 的清理只绑定 `event.sender.once('destroyed')`，如果同一 webContents 多次 watch 然后不显式 unwatch，注册表会累积（destroyed 会一次性全清）
- `storage:unwatch` 接受任意 renderer 传入的 `watchId` 删注册表条目 → 插件 A 可删插件 B 的 watchId（只是观察性漏洞，影响有限）

**修复建议**：unwatch 时校验 `watchRegistry.get(watchId)?.wcId === event.sender.id`，否则忽略。

### L4. `InBrowserWindow.executeJavaScript` 直接拼 JSON.stringify

**位置**：`src/main/browser/InBrowserWindow.ts` 多处

```ts
const rect = await contents.executeJavaScript(`
  (function() {
    ${qFn}
    const el = queryDeep(${JSON.stringify(selector)});
    ...
  })()
`)
```

- `JSON.stringify` 输出在 JS 字符串字面量上下文里不足以防注入：`'</script>'` 等 HTML 终结符不相关；但 `JSON.stringify` 输出对于 JS 字面量是安全的（没有 `\u2028` / `\u2029` 问题吗？是有的，早期 V8 会把 U+2028 当行终结符）
- 当前 selector 由上游（plugin `inbrowser.run` 调用链）传入，上游是否可信影响这里的安全级别
- 建议：传参通过 `executeJavaScript('(selector) => { ... }', true, selector)` 的参数注入形式，或在嵌入前对 `\u2028` / `\u2029` 做转义

### L5. `platform-api.ts:44` 有行尾空格

旧 code-review 已提过（L1），仍未修，属于 style 漂移。建议开启 eslint `no-trailing-spaces` + pre-commit 修复。

### L6. `permission-manager.ts` 字符串拼接权限方法名

**位置**：`src/main/plugin/permission-manager.ts:272-275`

```ts
const askMethod = `askFor${macType.charAt(0).toUpperCase() + macType.slice(1)}Access`
const askFn = permissions[askMethod]
if (typeof askFn === 'function') {
  const result = await askFn()
  ...
}
```

- 用字符串拼出方法名再去找 — TypeScript 完全失去类型检查
- `permissions` 是 `MacPermissionsModule` 类型，`[key: string]: unknown`

**建议**：显式白名单映射 `{ location: permissions.askForLocationAccess, contacts: permissions.askForContactsAccess, ... }`，丢掉 `as` / `string`。

### L7. CLI 包引入 `react@17` + `ink@3` 与主项目 `react@19` 不一致

**位置**：`packages/mulby-cli/package.json:30, 37`

- 双版本 React 在 pnpm 里靠 workspace resolution 分离，但 `shamefully-hoist=true`（主项目 `.npmrc`）可能把 react@17 提升到根 `node_modules`
- 主进程侧不使用 React，渲染层锁定 19，理论上没冲突；但 IDE workspace view 和 esbuild bundler 可能混乱
- 建议：CLI 包用 local `node_modules` 独立解析，`.npmrc` 里对 mulby-cli 关 hoist

### L8. 缺少测试覆盖

以下模块几乎无对应单测：

- `ipc-caller-resolver.ts`（所有安全判定依赖它）
- `webcontents-registry.ts`
- `blur-manager.ts`（withDialogMode 异常路径）
- `installer.ts`（zip slip 防御、downgrade block）
- `deep-link.ts` / `deep-link-security.ts`（rate limit 边界、URL 解析）
- `super-panel-manager.ts` / `super-panel-store.ts`（固定分组筛选、黑名单命中）
- `withHiddenWindow` 异常恢复（M1 修复的路径）

---

## 🟢 架构层观察（非 bug）

### O1. 主进程 / 渲染 / preload / plugin host 分层清晰

- `src/main/ipc/` 按领域切片（storage、shell、filesystem...）
- `src/preload/apis/` 对应镜像暴露
- `src/shared/types/` 供两端共享 DTO
- `plugin/host-*` 把插件代码跑在独立 host 进程，和主进程通过 RPC 协议（`host-protocol.ts`）通信

这套分层在 Electron 应用里已属上乘。后续改造围绕"每个 IPC 通道必须声明 caller 约束"即可。

### O2. 插件 host 多进程隔离 + 受限 preload

`plugin/host-worker.ts` + `plugin-preload-wrapper.ts` 保证插件 JS 不跑在主进程；搭配 `sandbox: true` 的插件窗口很好。只要把 IPC 边界收紧（M2），攻击面就相当小。

### O3. Deep Link 做到了动作级确认 + 速率限制

`deep-link.ts` + `deep-link-security.ts` 处理外部唤起是"小而完整"的实现，SAFE_ACTIONS 白名单、`confirmRunPlugin` / `confirmInstallPlugin` / `confirmAdhocSourceFetch` 分级弹窗都有。可以作为其它"外部来源输入"处理的模板。

### O4. 命令执行服务（`command-runner-*`）整体方向正确

- `command-runner-core.ts` 已引入 denyList/allowList、trusted fingerprint、队列上限、审计日志
- 前次代码审查的 H1/H5（envKeys 接通、env fallback）**已在当前代码中修复**（H1 仍部分存在，见 fix-summary）
- 仍有改进空间：`extractShellTokens` 覆盖已提（H3），allowList shell-case 深度匹配可继续加强

### O5. AI/MCP 层结构良好

- `aiService` 把多 provider 适配（anthropic、google、openai）收敛到 `providerAdapterCatalog` / `providerMethodAdapters`
- `mcp-server/` 独立目录，`stdio-bridge.cjs` 作为外部 MCP client 桥接
- 工具注入点（`setAiToolExecutor`）统一在 `src/main/index.ts`，耦合但集中
- MCP 的 IPC handler（`ipc/mcp-server.ts`）也应检查 caller source（目前未校验）

---

## 📋 修复优先级建议

| 顺序 | 项 | 理由 |
| --- | --- | --- |
| 1 | H1 Storage 跨 namespace 越权 | 秘钥/凭据泄漏，影响最大 |
| 2 | H2 Filesystem 跨插件读写 | 数据完整性 |
| 3 | H4 Shell.trashItem 等无校验 | 可静默破坏用户数据 |
| 4 | M2 `ipc-caller-resolver` 统一注入 | H1/H2/H3/H4 的根因 |
| 5 | H3 HTTP SSRF / 响应无上限 | 主进程 OOM + 内网侦测 |
| 6 | H5 zip bomb 保护 | 安装阶段 DoS |
| 7 | M3 Permission request 默认允许 | macOS 有系统级兜底，Windows/Linux 裸奔 |
| 8 | M6 `hideAllAppWindows` 误伤 detached 窗口 | UX 严重退化，修复成本低 |
| 9 | M4 manifest 细分权限声明 | 下一代权限模型；可分两期落地 |
| 10 | 其余 M / L 项 | 可纳入后续迭代 |

**统一实施入口**：建议在 `src/main/ipc/_shared/caller-middleware.ts`（新增）写 `appOnly` / `pluginAware` / `systemOnly` 三个包装器，现有 `register*Handlers` 逐步迁移，单 PR 聚焦一个领域（storage / filesystem / http 各一 PR）。

---

## 🧪 对 CI 的要求

当前 `.github/workflows/ci.yml` 只跑 `verify:app` + `verify:cli`（typecheck / lint / unit test / build / api-docs），没有：

- **IPC 越权回归测试**：跨 namespace storage 读取、filesystem 跨插件写入 → 落地后应加
- **Zip bomb fixture**：安装一个 10 MB 压缩 → 10 GB 的 inplugin，确认被 H5 新增的保护拦住
- **Smoke E2E**：启动 Electron，按下快捷键，打开搜索框，检查输入框接收焦点（回归 M1）

---

## 附录：本次会话做的改动

- `src/main/index.ts` `showMainWindow()` 顶部 `app.show()`、展示后 `app.focus({ steal: true })`
- `src/main/plugin/input.ts` `withHiddenWindow()` action 异常自动 `restoreHiddenWindows()`

已通过 CI 全部检查（typecheck / lint / unit 226 pass / build:smoke / verify:cli / native smoke）。
