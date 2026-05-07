# Mulby CLI 插件打包体积优化 (2026-03-15)

## 🎯 任务目标
解决像 `pdf-tools` 等插件由于 `preload.js` 打包逻辑，将不必要的 UI 依赖全量带入产物，导致安装包超过 30MB 的问题。

## ✅ 优化方案 (已实现)
**采用了基于 `@vercel/nft` 的依赖精确分析方案。**
原先 `pack` 命令会暴力读取 `package.json` 中的所有 `dependencies` 并直接复制对应的 `node_modules` 目录；目前方案更改为使用 `@vercel/nft` (Node File Trace) 静态分析 `preload.js` 的源码依赖树。

### 具体的变更点 (@/packages/mulby-cli/src/commands/pack.ts)
1. **安装工具包**: 在 `mulby-cli` 引入了依赖追踪库 `@vercel/nft`。
2. **移除冗余逻辑**: 彻底删除了原来的 `collectAllDependencies` 长链条递归调用。
32. **精准追踪**: 从入口 `manifest.preload` 切入，根据导入关系仅把真实需要的文件抽取并打包入 zip (跳过多余的前端依赖及 Readme / 测试等没用文件)。

### 第二阶段补充优化点
#### 1. esbuild `external: ['electron']` (build.ts)
默认的 esbuild 会将任何发现的原生依赖全部打包。由于插件通常运行在 Electron 主进程（或预加载沙箱）中，如果在 `package.json` 引进了类似于 `electron` 的库，也会被直接卷入 `main.js`。这显然是不对的。
- 增加了 `external: ['electron']` 配置，使任何引用被直接标记为外部依赖跳过打包。
- 增加了 `treeShaking: true` 配置，深度修剪未使用代码。

#### 2. 自定义打包白名单 `assets: []` (pack.ts)
由于旧版的打死逻辑，任何不是写死的特定的目录（如 `locales/` 等等）都被抛弃。
- 在 `PluginPackageManifest` 和文件收集逻辑中，增加了对 `manifest.assets` 字段的遍历支持。
- 现在开发者可在 `manifest.json` 中配置 `"assets": ["locales", "my-config.json"]`，打包时会自适应将它们加入 zip 文件内。
- 旧插件兼容模式中通过 `window.mulby.window.create(path, { loadMode: "file" })` 加载的额外 HTML、窗口专属 preload、`.node` 原生模块、`.exe`、`aperture` 等资源也需要列入 `assets`，否则打包后的 `.inplugin` 中不会包含这些文件。

## 📈 预期效果
- 当开发者在插件目录中使用 `npx mulby pack` 打包时，不会再出现巨大的未使用依赖包。
- 遵循了 UTools 的安全规范（原生模块没有被混淆和压缩，以源码形式暴露），但无用依赖被完美过滤。
- 打包速度及最终生成的 `.inplugin` 文件体积将得到数量级的提升。
