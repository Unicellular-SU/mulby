# Attached 插件 UI WebContentsView Shell 迁移方案

## 背景

当前 attached 插件 UI 每次打开都会创建一个新的 `BrowserWindow`，插件页面直接加载在该窗口的 `webContents` 中。日志显示 Host/UtilityProcess 预热后通常只消耗 3-15ms，主要耗时集中在插件 Renderer 页面加载、preload 执行、DOM ready、did-finish-load 和 show 流程。继续压缩 Host 冷启动收益有限，attached UI 容器复用才是更有效的方向。

Mulby 不能直接照搬 ZTools/uTools 的“所有插件长期常驻同一上下文”模型，因为 Mulby 当前的安全边界依赖 Host/UtilityProcess、IPC caller resolver、权限和独立 kill 能力。迁移目标必须保留这些边界。

## 目标

- Attached 插件 UI 从“插件直接占用 BrowserWindow”迁移到“可复用 shell BrowserWindow + 插件 WebContentsView”。
- Shell 只负责窗口形态、定位、阴影、焦点和平台差异；插件能力只存在于 WebContentsView。
- 保持现有 Host/UtilityProcess 隔离，不把第三方插件代码放回主进程或主应用 Renderer。
- 保持 detached 独立窗口、resident-ui、IPC 权限解析、主题同步、console 捕获和 reload 能力。
- 为后续 LRU resident UI、多插件 Renderer 复用、attached/detached view 迁移打基础。

## 非目标

- 不保留非后台插件的 Host 进程。非后台插件退出后 Host 仍按现有策略销毁。
- 不在搜索结果 hover/键盘选择时运行插件 `onLoad`。
- 不把所有插件 UI 默认无限期缓存。
- 不在本轮实现 detached 关闭后回收到 resident cache；本轮只实现 attached shell/view 与 attached→detached view 迁移。

## 目标架构

### 当前

```text
mainWindow
  └─ attached BrowserWindow
       └─ plugin webContents
```

问题：

- 每次打开 attached UI 都要创建插件 BrowserWindow。
- BrowserWindow 的生命周期和插件 Renderer 生命周期绑定太紧。
- resident-ui 只能缓存一个完整 panel window，后续 LRU 管理粒度不足。
- detached 标题栏模式已经有 WebContentsView，但 attached 路径没有复用这一套能力。

### 第一阶段

```text
mainWindow
  └─ reusable attached shell BrowserWindow
       └─ plugin WebContentsView
```

职责划分：

- `PluginPanelWindow` 持有一个可复用 shell `BrowserWindow`。
- 每次 attached 启动创建或恢复插件 `WebContentsView`。
- 插件 preload、sandbox、nodeIntegration、v8CacheOptions 只配置在插件 view 上。
- Shell 使用安全空页面，不暴露插件 preload。
- IPC caller 通过 `registerView(view, shellWindow)` 和 `registerPanelWindow(shellWindow.id, plugin.id)` 保持插件身份解析。
- 主题、reload、子窗口父级解析通过 `getPluginWebContents(shellWindow)` 继续命中插件 view。

## 生命周期

### 打开 attached 插件

1. `PluginWindowManager.attachPlugin()` 关闭或挂起旧 attached 插件。
2. `PluginPanelWindow.createPanel()` 确保 shell 存在。
3. 创建插件 `WebContentsView`，注册到 `webcontents-registry`。
4. 将 view 加入 shell `contentView`，布局为填满 shell。
5. 加载插件 UI，并在 `dom-ready` 或首次 `did-finish-load` 发送 `plugin:init`。
6. 插件 view 首次 ready 后显示 shell 和阴影。

### 隐藏 attached 插件

- `hide()` 只隐藏 shell 和阴影，不销毁 view。
- 主窗口失焦保护逻辑保持不变。

### 普通关闭

- 若 resident-ui 命中，则 `suspend()` 隐藏 shell，保留插件 view。
- resident-ui 只保留 UI Renderer；非后台插件 Host 会被销毁，恢复时重新执行 `onLoad`。
- 若未命中，则销毁插件 view、注销 IPC 身份，shell 保持隐藏可复用。

### 强制关闭

- disable、uninstall、reload、显式 kill 走 `force=true`。
- 必须绕过 resident-ui，销毁插件 view 和 Host。

### 恢复 resident

- 只在用户主动打开同插件同路由能力时恢复。
- 恢复时补发 `plugin:init` 和主题。
- 如果 route 不同，必须 reload/更新 hash，不能复用旧路由。

### 转为独立窗口

当前落地方案直接迁移同一个插件 `WebContentsView`：

1. 从 attached shell `removeChildView()`。
2. 注销旧的 shell → view 映射。
3. 创建 detached shell/titlebar window。
4. 将同一个 plugin view `addChildView()` 到 detached window。
5. 重新注册 view → detached window 映射，并补发 `plugin:init(mode=detached)`。

如果后续发现某个平台 reparent `WebContentsView` 不稳定，再增加 reload fallback。

## 安全边界

- 插件 view 继续使用插件 preload wrapper。
- Shell 不加载插件 preload，不允许插件 API。
- 所有插件 IPC 依旧依赖 `ipc-caller-resolver` 验证来源。
- View 销毁时必须 `unregisterView()`。
- Shell 没有当前插件时必须 `unregisterPanelWindow()`，避免空 shell 被误判为插件来源。
- Speculative prewarm 只能准备 Host，不执行 `onLoad`。

## 性能策略

### 冷启动

- 继续使用 HostPool 预热 UtilityProcess。
- 使用 `v8CacheOptions: 'code'` 保持 Renderer JS 编译缓存。
- Shell BrowserWindow 常驻复用，减少 attached 冷启动中的窗口创建和平台 surface 初始化成本。

### 热启动

- Resident UI 只缓存用户刚使用过的 UI Renderer，不缓存非后台 Host。
- 默认策略建议：
  - 初始 MRU=1，TTL=60s，风险低。
  - 进阶 LRU=2，TTL=3-5min，适合效率工具默认值。
  - LRU=3 作为高性能模式，必须配合内存压力淘汰和用户设置。
- 内存压力策略：
  - RSS 超过阈值时先淘汰最久未使用 resident UI。
  - 插件 view 单个进程占用过高时优先淘汰该插件。
  - 应用进入长时间 idle 后缩短 TTL。

## 分阶段计划

### Phase 1: Attached shell/view 解耦

- 新增 shell 空页面加载逻辑。
- `PluginPanelWindow` 增加 `pluginView` 字段。
- `createPanel()` 改为 shell + `WebContentsView`。
- `send()`、`restore()`、主题、console、reload 目标改为插件 view。
- `close()` 销毁插件 view 但保留 shell。
- 类型检查和基础启动验证通过。

### Phase 2: 正确性补齐

- 确认 route 差异时 resident restore 会 reload 正确 hash。
- 强制关闭路径永远不 resident。
- detached single-window guard 在 resident restore 前执行。
- 窗口失焦、主应用隐藏、global shortcut 唤醒不自动显示 resident panel。

### Phase 3: LRU Resident UI

- 从 MRU=1/60s 扩展为可配置 LRU。
- 默认 LRU=2，TTL=180s。
- 设置页暴露 “插件 UI 热缓存数量/时长/关闭”。
- 控制中心展示应用 RSS、CPU、磁盘缓存，辅助用户判断性能模式。

### Phase 4: Attached/Detached View 迁移

- 将插件 view 生命周期抽成 `PluginRendererSession`。
- 支持 view 从 attached shell 移动到 detached titlebar window。（当前已在 `promoteToWindow()` 中完成基础落地）
- 支持 detached window 关闭后按策略回收到 resident cache。
- 对不稳定平台保留 reload fallback。

## 验收标准

- Attached 插件能打开、关闭、恢复主搜索框。
- 关闭 resident 插件后，唤醒主应用不会自动显示插件 panel。
- 打开不同 route 不会复用旧页面。
- 转独立窗口仍可用，single-window 约束不退化。
- 插件 IPC、console、theme、reload 都命中插件 view。
- `pnpm run typecheck` 通过。
- 手工验证同一插件两次打开，`new BrowserWindow()` 不应再出现在每次 attached 打开的主耗时路径中；后续主要观察 view load 时间。
