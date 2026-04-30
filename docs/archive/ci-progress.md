# CI/CD 及代码检查进展

## 2026-04-13
- **目标**：检查代码，确保能够顺利通过 `.github/workflows/ci.yml` 中的门禁检查。
- **排查与修复**：
  - 本地运行了 `npm run verify:repo` 进行完整检查（包括 `verify:app` 和 `verify:cli`）。
  - 在 `src/renderer/App.tsx` 的类型检查中发现了错误：
    - `openPluginManager` 函数调用传入了 3 个参数，但类型定义只接受 2 个。
    - 缺少 `pluginId` 的定义。
  - 修复了 `openPluginManager` 的类型定义，并为其添加了 `pluginId?: string` 参数的支持。
  - 在检查 `window.mulby.systemPage.open` 的类型定义时（位于 `src/shared/types/electron.d.ts`），发现其入参 `payload` 缺少 `detailsPluginId` 字段。
  - 在 `electron.d.ts` 中补全了 `detailsPluginId?: string`。
- **结果**：
  - 再次执行 `npm run verify:repo` 时，成功通过所有类型检查（Typecheck）、代码规范检查（Lint）、文档同步检查（Docs Sync）、单元测试（Unit Tests）和 Smoke 构建任务。
  - CI 门禁任务验证通过，符合代码入库质量要求。

## 2026-04-14
- **目标**：检查代码，确保能够顺利通过 `.github/workflows/ci.yml` 中的门禁检查。
- **排查与修复**：
  - 本地运行了 `npm run verify:app` 和 `npm run verify:cli`。
  - `verify:app` 成功通过（Typecheck, Lint, Test, Build）。
  - `verify:cli` 中发现 `check:template-api-sync` 脚本报错，提示 react 模板的 API 类型定义 (`mulby.d.ts`) 存在遗漏 (`missing`)，包括：
    - `app.onSetSearchText`
    - `plugin.getSearchPreferences`
    - `plugin.hideFeature`
    - `plugin.pinFeature`
    - `plugin.removeRecentUsage`
    - `plugin.unhideFeature`
    - `plugin.unpinFeature`
  - 更新了 `packages/mulby-cli/src/commands/create/templates/react/types.ts` 中的 `MulbyApp` 和 `MulbyPlugin` 接口，补全了所缺少的 API 声明。
- **结果**：
  - 代码已完全匹配模板类型，`npm run verify:cli` 现已成功通过 `[ok] renderer template API` 和 `[ok] backend template API` 校验并完成构建。
  - CI 所有步骤验证闭环完成。
