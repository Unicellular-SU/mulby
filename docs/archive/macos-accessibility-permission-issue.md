# macOS 辅助功能权限显示已授权但插件无效问题复盘

## 最终结论

这次线上 GitHub Actions 打包的 macOS 包无法使用桌面宠物鼠标跟随等能力，最终根因不是 macOS 辅助功能权限本身，也不是 TCC 授权记录失效，而是**项目原生模块 `.node` 在 CI 产物中架构不匹配，导致输入监听模块加载失败**。

用户看到的表现是：

1. 系统设置 -> 隐私与安全 -> 辅助功能中 `Mulby.app` 显示已开启
2. Mulby 设置页也显示辅助功能已授权
3. 但桌面宠物无法跟随鼠标、录屏助手鼠标轨迹和键盘监听无效

实际运行日志已经给出关键证据：

```text
NativeInputMonitor 原生模块加载失败
mach-o file, but is an incompatible architecture (have 'arm64', need 'x86_64h' or 'x86_64')
PluginInputMonitor desktop-pet: 原生模块不可用
desktop-pet input-monitor.no-session
```

也就是说，权限检查返回了“已授权”，但 `input_monitor.node` 没有成功 `dlopen`，后续根本没有创建输入监听 session。

## 影响范围

受影响能力集中在依赖 `native/build/Release/*.node` 的功能：

| 模块 | 功能 | 失败表现 |
|------|------|----------|
| `input_monitor.node` | 全局键盘/鼠标监听，底层使用 `CGEventTap` | 桌面宠物无法跟随鼠标，插件输入监听不可用 |
| `window_watcher.node` | 活动窗口监听 | 活动窗口相关能力降级或不可用 |
| `clipboard_watcher.node` | 剪贴板原生监听 | 回退到 polling 模式 |
| `screen_capture.node` | 截屏相关原生能力 | 需要按具体调用确认 |
| `finder_selection.node` | Finder 选中文件读取 | 需要按具体调用确认 |

其中桌面宠物跟随鼠标主要依赖 `input_monitor.node`。

## 为什么本地包正常，GitHub Actions 包异常

本地打包后首次启动设置辅助功能权限，桌面宠物可以跟随鼠标，说明：

- macOS 辅助功能授权流程本身是可用的
- `input_monitor.node` 的原生实现是可用的
- 应用运行时加载 native addon 的路径逻辑基本可用

GitHub Actions 包异常的原因在构建链路：

1. CI 的 macOS runner 按 runner 当前架构构建了一次项目 native addon。
2. `electron-builder` 随后同时产出 `x64` 和 `arm64` 两套 macOS App。
3. CI 产物里的 `Resources/native/build/Release/*.node` 是 `arm64`。
4. `x64` App 启动后需要加载 `x86_64` native addon，却拿到了 `arm64` `.node`。
5. Electron/Node 在 `require()` `.node` 时直接报 `incompatible architecture`，输入监听不可用。

用户日志中的加载路径也符合这一点：

```text
/Applications/Mulby.app/Contents/Resources/app.asar.unpacked/native/build/Release/input_monitor.node
  -> Cannot find module

/Applications/Mulby.app/Contents/Resources/native/build/Release/input_monitor.node
  -> mach-o file, but is an incompatible architecture (have 'arm64', need 'x86_64h' or 'x86_64')
```

第一个路径不存在不是核心问题，因为运行时本来还有第二个 `extraResources` 路径；真正失败的是第二个路径里的 `.node` 架构不匹配。

## 为什么会误判为辅助功能权限问题

`systemPreferences.isTrustedAccessibilityClient(false)` 只能说明 TCC 数据库里有授权记录，不能证明：

- 原生输入监听模块已经成功加载
- `CGEventTapCreate` 已经成功创建 event tap
- 插件已经拿到可用的 input monitor session

因此会出现“权限显示已授权，但功能无效”的假象。

这次问题中，功能无效发生在更早的阶段：`input_monitor.node` 没有加载成功。此时继续重置辅助功能权限、重新勾选系统设置，都不能解决问题。

## 已修复版本

修复版本：`0.7.4`

核心修复：

1. `scripts/build-native.mjs`
   - macOS 下分别构建 `x64` 和 `arm64` 两份项目 native addon
   - 使用 `lipo -create` 合成为 universal binary
   - 目标模块包括：
     - `clipboard_watcher.node`
     - `finder_selection.node`
     - `input_monitor.node`
     - `screen_capture.node`
     - `window_watcher.node`

2. `scripts/electron-builder-after-pack.cjs`
   - 在 `afterPack` 阶段读取 App 主可执行文件架构
   - 校验 `Contents/Resources/native/build/Release/*.node` 是否覆盖 App 所需架构
   - 如果再出现 x64 App 携带 arm64-only `.node`，构建会直接失败

3. `scripts/verify-mac-app-signing.cjs`
   - 发布前校验 app bundle、native code object 签名
   - 新增 extraResources native addon 架构校验

4. `src/main/services/__tests__/native-addon-packaging.test.ts`
   - 增加静态测试，防止 macOS universal native addon 构建和架构校验逻辑被误删

## 0.7.4 验证记录

本地验证：

```bash
pnpm run native:build
pnpm run electron:build:mac:unsigned
pnpm run mac:verify-signing
node --import tsx --test src/main/services/__tests__/native-addon-packaging.test.ts
```

本地 `pnpm run native:build` 输出确认 5 个 `.node` 均为 universal：

```text
Architectures in the fat file: clipboard_watcher.node are: x86_64 arm64
Architectures in the fat file: finder_selection.node are: x86_64 arm64
Architectures in the fat file: input_monitor.node are: x86_64 arm64
Architectures in the fat file: screen_capture.node are: x86_64 arm64
Architectures in the fat file: window_watcher.node are: x86_64 arm64
```

GitHub Actions `0.7.4` 发布验证：

- Run: `26023184144`
- macOS job: 成功
- CI 日志中 `Build app native modules` 和 `Build macOS unsigned installers` 两个阶段均确认 5 个 `.node` 是 `x86_64 arm64`
- `afterPack` 日志确认：

```text
[afterPack] Signed extraResources native modules: 5
```

发布资产：

- `Mulby-0.7.4.dmg`
- `Mulby-0.7.4-mac.zip`
- `Mulby-0.7.4-arm64.dmg`
- `Mulby-0.7.4-arm64-mac.zip`
- `mulby-update-darwin-x64-0.7.4.zip`
- `mulby-update-darwin-arm64-0.7.4.zip`

用户安装 GitHub Actions 产出的 `0.7.4` 后已确认：辅助功能授权后桌面宠物可以正常跟随鼠标。

## 快速排查方法

如果以后再次出现“辅助功能显示已授权，但插件无效”，优先不要从 TCC 入手，先检查 native addon 是否加载成功。

### 1. 看日志

重点搜索：

```text
NativeInputMonitor
PluginInputMonitor
input-monitor.no-session
Cannot find module
incompatible architecture
mach-o file
```

如果看到下面这种日志，说明是架构问题：

```text
mach-o file, but is an incompatible architecture (have 'arm64', need 'x86_64h' or 'x86_64')
```

### 2. 检查已安装 App 的架构

```bash
lipo -archs /Applications/Mulby.app/Contents/MacOS/Mulby
lipo -archs /Applications/Mulby.app/Contents/Resources/native/build/Release/input_monitor.node
```

判断标准：

- x64 App：`input_monitor.node` 必须包含 `x86_64`
- arm64 App：`input_monitor.node` 必须包含 `arm64`
- universal `.node`：应输出 `x86_64 arm64`

也可以用：

```bash
file /Applications/Mulby.app/Contents/Resources/native/build/Release/input_monitor.node
```

预期输出应包含：

```text
Mach-O universal binary with 2 architectures
```

### 3. 检查签名

架构匹配后再检查签名：

```bash
codesign --verify --deep --strict /Applications/Mulby.app
codesign --verify --strict /Applications/Mulby.app/Contents/Resources/native/build/Release/input_monitor.node
```

签名仍然重要，但这次事故的直接原因是 native addon 架构不匹配。

## 和签名/TCC 的关系

早期排查曾怀疑是未签名构建、ad-hoc 签名或资源更新后 CDHash 变化导致 TCC 假阳性。这些方向仍然有参考价值，但不是这次 GitHub Actions 包的最终根因。

当前结论：

1. TCC 授权显示“已授权”不等于输入监听可用。
2. native addon 加载失败时，插件表现会和“没有辅助功能权限”非常像。
3. GitHub Actions 同时产出 x64/arm64 包时，项目 native addon 不能只按 runner 架构构建一次。
4. macOS 发布包必须在 CI 中验证 `.app` 主进程架构和 `.node` 架构兼容。

## 后续防线

为了避免复发，发布前至少保留以下防线：

1. `pnpm run native:build` 在 macOS 上必须输出 `x86_64 arm64`
2. `afterPack` 必须校验 `extraResources/native/build/Release/*.node` 架构
3. `mac:verify-signing` 必须校验已打包 `.app` 内的 native addon 架构和签名
4. 发布后用 GitHub Actions 日志确认：

```text
Architectures in the fat file: ... are: x86_64 arm64
[afterPack] Signed extraResources native modules: 5
```

功能验收流程：

1. 安装 GitHub Actions 产出的 DMG
2. 首次启动并授权辅助功能
3. 启动桌面宠物
4. 确认桌面宠物能跟随鼠标
5. 查看日志中不再出现 `input-monitor.no-session` 或 `incompatible architecture`
