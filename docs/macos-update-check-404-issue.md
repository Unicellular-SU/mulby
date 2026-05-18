# macOS 未签名构建检查更新 404 问题分析

## 问题现象

macOS 打包版本检查更新时报错：

```
Cannot find latest-mac.yml in the latest release artifacts
(https://github.com/Unicellular-SU/mulby-releases/releases/download/v0.7.1/latest-mac.yml):
HttpError: 404
```

应用尝试用 electron-updater 查找 `latest-mac.yml`，但 GitHub Releases 中不存在该文件。

## 已落地修复

1. `src/main/services/update-center.ts` 不再让已打包的 macOS 应用落入 `electron-updater` 分支。macOS packaged runtime 始终走 `checkMacResourceUpdates()` / `downloadMacResourceUpdate()` / `installMacResourceUpdatePackage()`，避免 unsigned 构建去请求 `latest-mac.yml`。
2. `src/main/services/mac-resource-update.ts` 增加 `shouldUseMacResourceUpdates()`，把“当前发布策略下已打包 macOS 应使用资源更新”作为运行时兜底，而不是完全依赖编译时常量。
3. `package.json` 的 `electron:build:mac:unsigned` 脚本在执行 `vite build` 时强制设置 `MULBY_MAC_UNSIGNED_RESOURCE_UPDATES=true`，降低本地手工构建漏配环境变量的概率。
4. `src/main/services/__tests__/mac-resource-update-routing.test.ts` 和 `src/main/services/__tests__/native-addon-packaging.test.ts` 增加运行时路由与发布脚本约束测试，防止后续回归。

## 背景：两条更新路径

项目有两条互斥的更新检测路径。修复前 macOS 是否走资源更新完全由**编译时常量**决定；修复后已打包的 macOS 应用由运行时 `shouldUseMacResourceUpdates()` 固定走资源更新，避免误入 `electron-updater`。

### 路径 A：electron-updater（Win/Linux 默认）

`src/main/services/update-center.ts:227`：

```typescript
await autoUpdater.checkForUpdates()
```

electron-updater 会去 GitHub Release 查找 `latest-mac.yml`（或 `latest.yml`），由 `electron-builder --publish` 生成。

### 路径 B：macOS 资源更新（macOS unsigned 专用）

`src/main/services/update-center.ts`：

```typescript
if (shouldUseMacResourceUpdates()) {
    return checkMacResourceUpdates()
}
```

`shouldUseMacResourceUpdates()` 定义在 `src/main/services/mac-resource-update.ts`：

```typescript
export function shouldUseMacResourceUpdates(): boolean {
    return process.platform === 'darwin' && app.isPackaged
}
```

这个路径会查找 `latest-mac-resource-{arch}.json`（由 `scripts/generate-mac-resource-update.cjs` 生成），有 Ed25519 签名校验。

### 编译时常量

`BUILD_MAC_UNSIGNED_RESOURCE_UPDATES` 来自 `vite.config.ts:17,32`：

```typescript
const macUnsignedResourceUpdates = process.env.MULBY_MAC_UNSIGNED_RESOURCE_UPDATES === 'true'
// ...
__MULBY_MAC_UNSIGNED_RESOURCE_UPDATES__: JSON.stringify(macUnsignedResourceUpdates)
```

**这是编译时常量**——必须在 `vite build` 时设置环境变量，打包进 `app.asar`。修复后它不再是 macOS packaged runtime 的唯一分流依据，但仍应在 unsigned 构建中正确注入，保证编译产物语义一致。

最终在 `src/main/services/mac-resource-update.ts:20-25` 读取：

```typescript
declare const __MULBY_MAC_UNSIGNED_RESOURCE_UPDATES__: boolean | undefined
const BUILD_MAC_UNSIGNED_RESOURCE_UPDATES = typeof __MULBY_MAC_UNSIGNED_RESOURCE_UPDATES__ === 'boolean'
  ? __MULBY_MAC_UNSIGNED_RESOURCE_UPDATES__
  : false
```

## 根因分析

### 路由失败，走了错误的路径

修复前，macOS 打包版本检查更新时 `isMacResourceUpdateRuntime()` 返回 `false`，穿过了这个 guard，进入 electron-updater 分支。但 GitHub Release 中没有 `latest-mac.yml`（它是 unsigned 构建，CI 中 macOS 用的是 `electron:build:mac:unsigned --publish never`），所以 404。

### 为什么 isMacResourceUpdateRuntime() 返回 false

`BUILD_MAC_UNSIGNED_RESOURCE_UPDATES` 为 `false`，原因可能是以下之一：

**情况一：构建时没设置环境变量**

CI release workflow（`.github/workflows/release.yml:132`）中虽然写了：

```yaml
env:
  MULBY_MAC_UNSIGNED_RESOURCE_UPDATES: "true"
```

但如果 tag push 触发 CI 时环境变量注入失败、或被覆盖、或 CI 步骤执行顺序有问题，`vite build` 时拿到的就是空值 → 编译出的常量就是 `false`。

**情况二：手工发布（不在 CI 中构建）**

如果 v0.7.1 是在本地打包并手工上传到 GitHub Release 的，本地构建时如果没有手动设置 `MULBY_MAC_UNSIGNED_RESOURCE_UPDATES=true`，编译出的 `BUILD_MAC_UNSIGNED_RESOURCE_UPDATES` 就是 `false`。

通过以下命令确认：

```bash
# 从 app.asar 中提取 update-center 编译产物，检查常量值
npx asar extract-file /Applications/Mulby.app/Contents/Resources/app.asar \
  dist/main/mac-resource-update-*.js /tmp/check.js
grep -o 'BUILD_MAC_UNSIGNED[^,]*' /tmp/check.js
```

**情况三：Release 中缺少 resource update manifest 文件**

即使路由正确走了 `checkMacResourceUpdates()`，如果 `latest-mac-resource-{arch}.json` 没有上传到 release，也会报错。但这个场景下报错信息不同（不是 `latest-mac.yml` 404）。

### 为什么 Win/Linux 正常

Win/Linux 构建走 `electron:build:publish`，electron-builder 会自动生成 `latest.yml` 并上传到 GitHub Release。macOS unsigned 构建用 `electron:build:mac:unsigned --publish never`，不会生成这些文件。

## 最终方案与不采纳项

### 方案一：确保编译时常量正确注入

`package.json` 的 `electron:build:mac:unsigned` 已改为：

```json
"electron:build:mac:unsigned": "pnpm run native:build && MULBY_MAC_UNSIGNED_RESOURCE_UPDATES=true vite build && electron-builder --mac --publish never"
```

这样本地手工执行 macOS unsigned 构建时，也会把资源更新开关编译进 `app.asar`。

### 方案二：增加运行时兜底

`update-center.ts` 的检查、下载、安装入口均改为使用 `shouldUseMacResourceUpdates()`：

```typescript
export async function checkAppUpdates(): Promise<UpdateCenterState> {
  if (shouldUseMacResourceUpdates()) {
    return checkMacResourceUpdates()
  }

  if (!app.isPackaged) {
    return checkAppUpdatesFallback()
  }

  // Win/Linux 正常走 electron-updater
  await autoUpdater.checkForUpdates()
}
```

### 不采纳：CI 生成 latest-mac.yml 兜底

在 macOS CI 构建中额外运行 `electron-builder --publish always` 生成 `latest-mac.yml`，使 electron-updater 路径也能工作。

不采纳原因：这与 unsigned 设计矛盾。当前 macOS 发布资产是 signed manifest + resource update zip，且 Squirrel.Mac 自动更新要求签名应用；让 unsigned app 继续走 `electron-updater` 不是可靠路径。

## 涉及的完整调用链

```
checkAppUpdates()                          ← update-center.ts:213
  ├─ shouldUseMacResourceUpdates()         ← mac-resource-update.ts
  │   └─ process.platform === 'darwin' && app.isPackaged
  │
  ├─ [macOS packaged] → checkMacResourceUpdates()         ← 查找 latest-mac-resource-*.json（正确路径）
  │
  ├─ [!isPackaged] → checkAppUpdatesFallback()            ← GitHub API（开发环境）
  │
  └─ [Win/Linux packaged] → autoUpdater.checkForUpdates() ← 查找 latest.yml / 平台 updater 元数据
```

## 关键文件

| 文件 | 作用 |
|------|------|
| `src/main/services/update-center.ts` | 更新入口路由 |
| `src/main/services/mac-resource-update.ts` | macOS 资源更新逻辑，含 `shouldUseMacResourceUpdates()` |
| `src/main/services/mac-resource-update-manifest.ts` | manifest 解析和签名校验 |
| `scripts/generate-mac-resource-update.cjs` | CI 中生成 `latest-mac-resource-*.json` |
| `.github/workflows/release.yml` | CI release 流程 |
| `package.json` | unsigned macOS 构建脚本 |
| `src/main/services/__tests__/mac-resource-update-routing.test.ts` | macOS 资源更新路由防回归测试 |
| `src/main/services/__tests__/native-addon-packaging.test.ts` | 发布脚本防回归测试 |
| `vite.config.ts` | 设置 `__MULBY_MAC_UNSIGNED_RESOURCE_UPDATES__` 编译时常量 |
