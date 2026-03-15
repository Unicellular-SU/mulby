# Mulby CLI 插件打包体积优化 (2026-03-15)

## 🎯 任务目标
解决像 `pdf-tools` 等插件由于 `preload.js` 打包逻辑，将不必要的 UI 依赖全量带入产物，导致安装包超过 30MB 的问题。

## ✅ 优化方案 (已实现)
**采用了基于 `@vercel/nft` 的依赖精确分析方案。**
原先 `pack` 命令会暴力读取 `package.json` 中的所有 `dependencies` 并直接复制对应的 `node_modules` 目录；目前方案更改为使用 `@vercel/nft` (Node File Trace) 静态分析 `preload.js` 的源码依赖树。

### 具体的变更点 (@/packages/mulby-cli/src/commands/pack.ts)
1. **安装工具包**: 在 `mulby-cli` 引入了依赖追踪库 `@vercel/nft`。
2. **移除冗余逻辑**: 彻底删除了原来的 `collectAllDependencies` 长链条递归调用。
3. **精准追踪**: 从入口 `manifest.preload` 切入，根据导入关系仅把真实需要的文件抽取并打包入 zip (跳过多余的前端依赖及 Readme / 测试等没用文件)。

## 📈 预期效果
- 当开发者在插件目录中使用 `npx mulby pack` 打包时，不会再出现巨大的未使用依赖包。
- 遵循了 UTools 的安全规范（原生模块没有被混淆和压缩，以源码形式暴露），但无用依赖被完美过滤。
- 打包速度及最终生成的 `.inplugin` 文件体积将得到数量级的提升。
