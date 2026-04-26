# Mulby UI 插件常驻复用设计方案

- **日期**：2026-04-25
- **范围**：UI 插件冷启动 / 热启动、关闭后复用、后台常驻语义、Host 与 Renderer 生命周期协同
- **结论摘要**：推荐先落地“**附着 UI 单槽常驻复用（MRU=1）+ Host 绑定保活 + TTL 淘汰**”作为基础方案；后续再演进到“**受控多槽 LRU 缓存**”和“**可信插件启动即常驻**”。

---

## 1. 背景

最近几轮优化已经把 Mulby 主应用侧能压缩的冷启动路径基本压到了边界：

- Host 冷启动已通过进程池显著压缩，`prewarm()` 只做 Host ready 和入口登记，不再提前执行 `onLoad`
- 首次打开前的 preload wrapper 生成已从关键路径移出
- `onIdleLoad` 已延后，不再和首屏渲染竞争
- 插件 UI 窗口已开启 `v8CacheOptions: 'code'`

从现有日志看，真正的瓶颈已经非常清楚：

- `onLoad` 通常只有 10ms 级
- `new BrowserWindow()` 通常只有 15ms 级
- `loadFile -> dom-ready / did-finish-load` 常常仍在 500ms 以上

也就是说，**现在的主要成本不在 Host，而在插件 Renderer 自身启动**。

这也是为什么：

- 继续优化 Host 只能带来边际收益
- 真正有效的热启动方案，最终都会走向“**关闭后保留 UI 上下文，再次进入复用**”

---

## 2. 外部参考结论

### 2.1 uTools

uTools 的公开语义明确区分：

- 退出到后台
- 结束运行
- 退出到后台立即结束运行
- 跟随主程序同时启动运行

这说明它的主流方案不是“每次关闭即彻底冷启动”，而是“**后台常驻 + 需要时再复用**”。

### 2.2 ZTools

ZTools 源码里，默认保活对象不是独立 Host，而是插件的 `WebContentsView`：

- 新建后即加入缓存池 `pluginViews`
- 隐藏时仅 `removeChildView()`，不销毁 view
- 再次进入时直接把缓存 view 挂回主窗口
- 只有命中 `outKillPlugin` 才真正 kill
- 还支持“跟随主程序同时启动运行”，即启动时就先做隐藏态 preload

相关代码：

- `/Users/su/workspace/ZTools/src/main/managers/pluginManager.ts`
- `/Users/su/workspace/ZTools/src/main/core/detachedWindowManager.ts`

### 2.3 对 Mulby 的启示

可以借鉴的不是具体 API，而是两个产品语义：

1. **关闭插件 != 必须销毁插件**
2. **保活策略应该是可配置、可淘汰、可显式结束的**

不能直接照搬的点也很明确：

1. Mulby 是 `Renderer + UtilityProcess Host` 双层架构，不是单一 `WebContentsView` 架构
2. Mulby 当前部分插件窗口允许自定义 preload，安全边界比 ZTools 更敏感
3. Mulby 已经有成熟的后台 Host 体系，不能把“UI 常驻”与“后台任务”混成一个概念

---

## 3. Mulby 当前详细状态

### 3.1 已有能力

#### Host 侧

- Host 进程池：`src/main/plugin/host-manager.ts`
- Host 空闲销毁：`idleTimeoutMs`
- 活跃窗口保护：`hasActiveWindow(pluginId)`
- 搜索安全预热：`PluginManager.prewarm()`
- 后台运行与恢复：`BackgroundPluginManager`

#### UI 侧

- 附着式 UI：`src/main/plugin/panel-window.ts`
- 独立窗口 UI：`src/main/plugin/window.ts`
- 面板支持 `hide()` / `show()`，但关闭路径默认仍会真正销毁窗口
- Detached window 当前也是关闭即销毁

#### 生命周期侧

- `onLoad`
- `onIdleLoad`
- `onBackground`
- `onForeground`
- `onUnload`

### 3.2 当前默认行为

UI 插件执行后：

1. 创建 panel 或 detached window
2. 插件关闭窗口
3. `PluginWindowManager` 触发 `handleWindowClosed(pluginId)`
4. `PluginManager` 根据 manifest 决定：
   - 若 `pluginSetting.background === true`，转后台 Host
   - 否则直接销毁 Host

这意味着当前 Mulby 实际只有两种运行态：

- `foreground-ui`
- `background-host`

缺失的是第三种关键状态：

- `resident-ui`：UI 已隐藏，但 Renderer 上下文仍然保留，可再次进入复用

### 3.3 当前模型的优点

- 语义清晰
- 安全边界简单
- 内存和进程回收直接
- 不容易留下隐藏状态和竞态

### 3.4 当前模型的不足

- 同一 UI 插件“打开-关闭-再次打开”仍接近冷启动
- Host 即使被保留，只要 Renderer 被销毁，热启动收益也有限
- `background` 语义被迫承担了“想要热启动”的诉求，但两者本质不同

---

## 4. 设计目标

### 4.1 目标

1. 显著改善同一 UI 插件的二次进入速度
2. 不改变当前无 UI 插件的后台能力模型
3. 不在搜索 hover / 结果选中时偷偷执行插件 UI
4. 不把“UI 复用”错误地等价成“后台任务”
5. 提供可控淘汰和显式结束机制

### 4.2 非目标

1. 不修改插件代码
2. 不为所有插件默认开启启动即常驻
3. 不在第一版做跨平台内存压力自动感知
4. 不在第一版支持无限数量的 UI 上下文缓存

---

## 5. 方案选型

### 5.1 方案 A：维持现状，只继续优化冷启动链路

**优点**

- 最安全
- 逻辑最简单
- 不引入隐藏态

**缺点**

- 已接近优化上限
- 热启动体验改善有限

**结论**

不推荐继续作为主要方向。

### 5.2 方案 B：附着 UI 单槽常驻复用

即：

- 只缓存最近一个 UI 插件的附着式上下文
- 关闭时隐藏而不销毁
- 重新进入同一插件时直接恢复
- 超时、顶替、手动结束、禁用/卸载/更新时淘汰

**优点**

- 改动面最小
- 能覆盖最高频场景
- 风险可控
- 非常贴近 uTools / ZTools 的体感

**缺点**

- 只覆盖一个插件
- 第一版只对 attached panel 收益明显

**结论**

**推荐作为基础方案。**

### 5.3 方案 C：多槽 LRU 常驻复用

即：

- 最近 1 到 3 个 UI 插件上下文保留
- 按 LRU 淘汰
- 内存超限时主动清理

**优点**

- 热启动收益最大
- 更接近完整的插件上下文缓存系统

**缺点**

- 状态管理复杂度大幅上升
- Host 与 Renderer 生命周期耦合更难
- 更容易引入隐藏状态、竞态和安全语义歧义

**结论**

适合作为进阶方案，不适合第一版直接上。

---

## 6. 推荐基础方案

### 6.1 核心思路

在 Mulby 中引入独立于 `background-host` 的第三种运行态：

- `foreground-ui`
- `resident-ui`
- `background-host`

其中：

- `resident-ui` 表示插件 UI 不可见，但 Renderer 上下文和对应 Host 仍短时保留
- 它的目标是“再次进入复用”，而不是执行长期后台任务
- 它必须与现有 `background` manifest 语义分离

### 6.2 第一版范围

只覆盖：

- **附着式 panel UI**
- **最近一个插件**
- **短时保活**

不覆盖：

- detached window 多实例缓存
- 多槽 LRU
- 启动即常驻
- hover / selection 预加载 UI

### 6.3 新状态机

```text
not-running
  -> prewarmed-host
  -> foreground-ui
  -> resident-ui
  -> background-host

foreground-ui --close--> resident-ui
resident-ui --reopen same plugin--> foreground-ui
resident-ui --TTL / replaced / manual stop / disable / uninstall / reload--> not-running
foreground-ui --close and manifest.background=true--> background-host
background-host --open ui--> foreground-ui
```

关键原则：

- `resident-ui` 与 `background-host` 互斥
- `resident-ui` 不触发 `onBackground`
- `resident-ui` 也不等于 `onUnload`

---

## 7. 基础方案详细设计

### 7.1 新概念：Resident UI Session

新增一层运行时结构，建议由 `PluginManager` 管理：

```ts
interface ResidentUiSession {
  pluginId: string
  featureCode: string
  mode: 'panel'
  cachedAt: number
  lastUsedAt: number
  expireAt: number
  route?: string
  windowType: 'panel'
  hostPinned: boolean
}
```

说明：

- 第一版只需要一条记录
- 实际窗口实例仍由 `PluginPanelWindow` 持有
- `PluginManager` 负责保活策略和生命周期协调

### 7.2 窗口行为改造

当前关闭附着 UI 的路径是：

- `windowManager.closeAttached()`
- `panelWindow.close()`
- `panelWindow.cleanup()`
- 通知 `handleWindowClosed()`

基础方案改成：

- 普通关闭动作优先进入 `resident-ui`
- 不立即 `close()`，改为 `hide()`
- 保留 `panelWindow`、当前插件信息、当前 URL / route、Renderer 上下文
- 仅在明确淘汰时才走 `close() + cleanup()`

因此需要把“关闭 UI”拆成两个语义：

1. `suspendAttached()`
   - 隐藏 UI
   - 不销毁窗口
   - 不触发 `handleWindowClosed()`
   - 进入 `resident-ui`

2. `closeAttached()`
   - 真正关闭窗口
   - 清理上下文
   - 进入 `not-running` 或 `background-host`

### 7.3 Host 协同

如果只保留 Renderer、不保留 Host，缓存价值会大打折扣，因为重新进入时仍需重建 Host 状态与 IPC 桥接。

因此基础方案中，`resident-ui` 必须同时 pin Host：

- UI 进入 `resident-ui` 时，为该插件设置 `residentHostPin = true`
- Host idle cleanup 检查中把 `residentHostPin` 视为“活跃引用”
- 直到 resident session 被淘汰时，再解除 pin 并允许 Host 销毁

建议在 `PluginHostManager` 增加：

```ts
setResidentPin(pluginId: string, pinned: boolean): void
isResidentPinned(pluginId: string): boolean
```

然后在 idle cleanup 条件中，除了 `activeRequests` 和 `hasActiveWindow(pluginId)`，再多一条：

- `isResidentPinned(pluginId)`

### 7.4 生命周期钩子语义

基础方案下推荐的语义：

- `foreground-ui -> resident-ui`
  - 不调用 `onBackground`
  - 不调用 `onUnload`

- `resident-ui -> foreground-ui`
  - 可选调用 `onForeground`
  - 推荐第一版先不强制调用，避免改变现有插件行为

- `resident-ui -> not-running`
  - 若插件此前已 `onLoad`，在真正销毁时才调用 `onUnload`

理由：

- `onBackground` 当前更接近“进入后台任务模式”
- `resident-ui` 本质是“隐藏的 UI cache”
- 混用会让插件作者难以理解

### 7.5 TTL 与淘汰策略

基础方案建议：

- `resident-ui` 默认 TTL：`60s`
- 仅允许一个 resident session
- 打开其他 UI 插件时，先淘汰旧 resident，再创建新插件 UI

触发淘汰的场景：

1. TTL 到期
2. 用户显式“结束运行”
3. 插件禁用
4. 插件卸载
5. 插件代码热重载 / metadata reload
6. 渲染进程崩溃
7. Host 崩溃

### 7.6 显式用户语义

建议在产品语义上引入与 uTools 接近的表达：

- 关闭：默认隐藏并保留最近使用插件
- 结束运行：真正销毁当前插件上下文

对应上：

- 普通 ESC / blur close -> `resident-ui`
- 菜单中的“结束插件” -> 强制淘汰 resident session + destroy Host

---

## 8. 与当前后台机制的关系

### 8.1 不混用 `background`

`pluginSetting.background === true` 代表的是：

- 插件在无 UI 时仍要继续工作
- 需要 Watchdog、maxRuntime、persistent 恢复等后台能力

`resident-ui` 代表的是：

- 插件虽然不可见，但只是为了更快返回 UI

因此两者必须并行存在，而不是互相替代。

### 8.2 交互规则

建议规则如下：

1. 如果插件进入 `resident-ui`，则不自动转 `background-host`
2. 如果插件显式支持后台，且用户选择“关闭并转后台”，再进入 `background-host`
3. 第一版默认不要实现“resident-ui 与 background-host 同时存在”

原因：

- 同时存在会让生命周期极其复杂
- Host 中到底是“UI 复用态”还是“后台任务态”会变得不清晰

---

## 9. 需要修改的主干模块

### 9.1 `src/main/plugin/manager.ts`

新增职责：

- 维护 resident session 元数据
- 负责 TTL、替换、显式结束
- 协调 resident pin 与 Host 销毁

### 9.2 `src/main/plugin/window.ts`

新增能力：

- `suspendAttached()` 或等价语义
- `restoreAttachedIfResident(pluginId, featureCode, input, route)`

### 9.3 `src/main/plugin/panel-window.ts`

新增约束：

- `hide()` 与 `close()` 语义彻底分离
- `cleanup()` 仅在真实销毁时调用
- 恢复显示时补发 `plugin:init` 或 `plugin:resume`

### 9.4 `src/main/plugin/host-manager.ts`

新增能力：

- resident pin
- idle cleanup 时识别 resident pin

### 9.5 `src/main/plugin/background-manager.ts`

主要不改语义，只需确保：

- resident-ui 不被错误识别成 background
- stop / shutdown 时能顺带驱逐 resident session

---

## 10. 观测与日志

必须新增专门的日志，否则后续会很难判断“热启动到底命中了哪一层缓存”。

建议新增日志分类：

- `[ResidentUI] create`
- `[ResidentUI] suspend`
- `[ResidentUI] resume`
- `[ResidentUI] evict`
- `[ResidentUI] ttl-expired`
- `[ResidentUI] replaced-by-plugin=...`
- `[ResidentUI] force-close reason=...`

关键指标：

1. `resident resume hit rate`
2. `resident session lifetime`
3. `resident session eviction reason`
4. `reopen latency` 与 `cold launch latency` 对比

---

## 11. 基础方案的风险

### 11.1 安全语义风险

隐藏的 Renderer 仍然是活着的：

- JS 定时器仍可能存在
- preload 暴露的 IPC 仍可调用
- 内存状态仍被保留

所以它不能被包装成“完全关闭”。

### 11.2 状态脏化风险

再次进入同一插件时，UI 可能保留上一次页面状态、表单数据、滚动位置、路由状态。

这既是收益，也是风险。

基础方案应采用：

- 只缓存同一插件的最近一次上下文
- 恢复时仍补发初始化事件，由插件自行决定是否覆盖输入

### 11.3 竞态风险

重点关注：

- resident session 还未恢复，用户又切换到其他插件
- host 崩溃但 resident window 仍在
- metadata reload / disable / uninstall 与 resident TTL 同时发生

第一版必须把所有淘汰动作收敛到一个统一入口，例如：

```ts
evictResidentSession(pluginId, reason)
```

---

## 12. 进阶方案

### 12.1 进阶方案 A：多槽 LRU Resident UI

在基础方案稳定后，可扩展为：

- 最近使用的 2 到 3 个 UI 插件可同时保留
- 每个 resident session 有独立 TTL
- 超出上限时按 LRU 淘汰

适用场景：

- 用户在少量高频插件间频繁切换
- 插件 UI 启动成本普遍较高

不建议第一版就做的原因：

- 窗口与 Host 绑定关系更复杂
- 会明显提高隐藏态内存占用

### 12.2 进阶方案 B：Detached Window 也支持 Resident Cache

当前建议基础方案只做 panel。

后续如果要做 detached 复用，需要再细分：

- 用户点关闭是“隐藏到常驻”还是“真正关闭”
- 多窗口插件如何识别主实例与子实例
- `single=false` 的插件是否允许多个 resident window

这部分复杂度明显高于 panel，不建议与第一版一起做。

### 12.3 进阶方案 C：可信插件启动即常驻

这更接近 uTools 的“跟随主程序同时启动运行”。

但必须满足：

- 非默认开启
- 仅可信插件或用户显式 pin 的插件可用
- 明确告诉用户该插件会在应用启动后就保留 UI 上下文

此方案收益最高，但语义变化也最大。

### 12.4 进阶方案 D：多层淘汰策略

在具备多槽 resident 后，可加入更精细的淘汰规则：

- TTL 淘汰
- LRU 淘汰
- 手动“结束运行”
- 应用空闲时批量清理
- 内存超阈值时主动清理

注意：

跨平台“内存压力感知”不应作为第一版依赖。更稳妥的顺序是：

1. 先做固定槽位 + TTL
2. 再做应用内存阈值
3. 最后再考虑系统级 memory pressure 信号

### 12.5 进阶方案 E：Renderer 与 Host 解耦恢复

更远期的方案是允许：

- Resident UI 仍在
- Host 因资源策略被回收
- 再次显示 UI 时自动重连 Host

这需要一套更完整的：

- Host reconnection 协议
- preload 侧 bridge 重建
- 插件运行态恢复语义

该方案价值很高，但实现复杂度显著高于基础方案，建议放在后续独立阶段。

---

## 13. 不建议做的方案

1. **搜索结果 hover / 方向键选中时预加载 UI**
   - 会提前执行插件 preload / Renderer 代码
   - 扩大信任边界
   - 可能拖慢搜索页自身

2. **默认保留所有 UI 插件 Renderer**
   - 内存和状态不可控
   - 隐藏态过多，排障困难

3. **第一版就做“后台 Host + Resident UI 双常驻”**
   - 生命周期过于复杂
   - `onBackground` / `onForeground` 语义容易混乱

---

## 14. 推荐落地顺序

### Phase 1

- 引入 `resident-ui` 状态
- 仅支持 attached panel
- 仅缓存最近一个插件
- 引入 Host resident pin
- 60s TTL
- 加日志和基础指标

### Phase 2

- 增加“结束运行”显式入口
- 完善 disable / uninstall / reload / crash 驱逐路径
- 增加恢复命中统计

### Phase 3

- 评估是否扩展到 LRU=2 或 3
- 评估 detached window 常驻需求
- 评估可信插件启动即常驻

---

## 15. 验收标准

基础方案验收时，至少应满足：

1. 同一 attached UI 插件二次进入延迟显著低于当前热启动
2. 插件关闭后不会被错误记为后台任务
3. TTL 到期后 Host 与窗口能正确释放
4. 插件禁用、卸载、热重载不会遗留 resident session
5. 日志能明确区分：
   - cold launch
   - host prewarm hit
   - resident-ui resume hit

---

## 16. 最终建议

对于 Mulby，最佳路线不是直接照搬 ZTools 的“全量 WebContentsView 缓存”，也不是继续只做 Host 冷启动优化。

**最佳路线是：**

- 先补上 Mulby 缺失的 `resident-ui` 层
- 第一版只做 `attached panel + MRU=1 + TTL`
- 把它明确建模为“UI 上下文短时复用”，而不是“后台运行”
- 在这版稳定后，再逐步演进到多槽 LRU、可信插件启动即常驻、Renderer/Host 解耦恢复

这条路线最符合 Mulby 当前代码结构，也最容易在性能收益、复杂度和安全边界之间取得平衡。
