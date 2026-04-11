# 应用搜索优化 — 进展记录

## Phase 1-2: 内存优先搜索
- macOS/Windows: 完全移除外部进程，纯内存 catalog 搜索

## Phase 3: 拼音索引预计算
- `preheatKeywordIndexes()` + `MAX_KEYWORD_CACHE_SIZE` 3000→8000

## Fix 1: .lnk 快捷方式图标
- `system.ts` `resolveNativeIcon()`: `shell.readShortcutLink()` → 目标 .exe → 递归解析图标

## Fix 2: AppX/UWP 搜索
- `collectAppxApps()`: Get-StartApps 获取 Name+AppID
- `mergeAppxEntries()`: 不匹配的 UWP 应用创建独立条目

## UWP 图标解析策略
- `resolveAppxIconPaths()`: 单次 PowerShell 获取 PackageFamilyName→InstallLocation
- `findAppxLogoAsset()`: 从 AppxManifest.xml 解析 Logo 路径 + scale 变体查找
- 优先级: Square44x44Logo > Square150x150Logo > Logo
- 变体: .scale-200 > .scale-150 > .scale-100 > .targetsize-256 > .targetsize-48

## 验证
- TypeScript: 0 错误 | 单元测试: 194/194 通过
