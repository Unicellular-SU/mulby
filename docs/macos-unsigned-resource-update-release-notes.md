# macOS 未签名资源更新发布经验

## 当前发布方式

macOS unsigned 发行版使用资源更新模式：

- 首次安装仍发布完整 `.dmg` / `.zip`。
- 后续普通版本通过 signed manifest 指向 `mulby-update-darwin-{arch}-{version}.zip`。
- 应用内只替换 `Contents/Resources` 下允许更新的资源，不替换 `.app` 主可执行文件、Electron Framework、`Info.plist` 或 entitlements。
- Windows/Linux 继续使用 `electron-updater` 原有流程。

GitHub Actions 是推荐打包入口。发布时需要配置：

- `GH_TOKEN`：上传 release assets。
- `MAC_RESOURCE_UPDATE_PRIVATE_KEY_PEM`：Ed25519 私钥，用于签名 `latest-mac-resource*.json`。

CI 会从私钥派生公钥并注入应用构建。应用运行时只内置公钥，私钥不进入产物。

## 本地打包结论

本地构建完整安装包本身不需要 `MAC_RESOURCE_UPDATE_PRIVATE_KEY_PEM`。

但如果本地产物要作为自动更新测试的“首次安装版本”，就必须用同一把私钥派生出的公钥来构建首包，否则之后由该私钥签名的 manifest 会校验失败。也就是说：

- 只想生成一个能安装的 `.dmg`：不需要私钥。
- 想测试资源自动更新链路：首包和后续 manifest 必须使用同一组 Ed25519 key。

本地临时测试 key 可以放在 `.tmp-*` 目录，这类目录已被 `.gitignore` 忽略，不应提交。

## 本地踩坑

`package.json` 的 `build.mac.target` 显式声明了 x64 和 arm64。即使命令里传 `--x64`，当前 electron-builder 仍可能继续处理 arm64 target，并在本地沙箱无网络时尝试下载 `electron-v*-darwin-arm64.zip` 失败。

因此本地不要把“命令最终退出码失败”直接等同于 x64 产物不可用：x64 的 `.dmg` / `.zip` 可能已先生成。但正式发布不应依赖这种半成功状态，应该交给 GitHub Actions 在有网络的 macOS runner 上完成。

## 推荐发布流程

1. 更新 `package.json` 版本号。
2. 提交代码。
3. 创建并推送 `vX.Y.Z` tag。
4. GitHub Actions 自动构建：
   - Windows/Linux：`pnpm run electron:publish`
   - macOS：unsigned installer + resource update package + signed manifest

macOS 自动更新测试时，目标机器首次安装完整 DMG 后仍需要移除 quarantine：

```sh
xattr -dr com.apple.quarantine "/Applications/Mulby.app"
```

如果后续版本包含 Electron、主可执行文件、`Info.plist`、entitlements 或 updater helper 变更，应通过 manifest compatibility 标记为手动安装完整包，而不是资源替换。

## CI 修复记录

v0.6.2 第一次 tag 发布时，macOS runner 实际已经生成了 `.dmg` 和 `.zip`，但 `Generate macOS resource update assets` 步骤失败，导致后续 `Publish macOS release assets` 被跳过。失败原因是 workflow 使用：

```sh
pnpm run mac:resource-update -- --tag "v0.6.2"
```

pnpm 会把独立的 `--` 继续传给脚本，最终脚本收到：

```sh
node scripts/generate-mac-resource-update.cjs -- --tag v0.6.2
```

旧版 `parseArgs` 把独立 `--` 当成需要值的参数，于是抛出 `Missing value for --`。

修复策略：

- workflow 直接调用 `node scripts/generate-mac-resource-update.cjs --tag "$RELEASE_TAG"`，避免 npm/pnpm 参数转发歧义。
- 脚本参数解析兼容独立 `--`，以后即使用 npm-style 分隔符也不会误报。
- `workflow_dispatch` 增加 `platform` 输入；补发某个版本的 macOS 资产时选择 `platform=macos`，避免重新构建和覆盖 Windows/Linux 资产。
