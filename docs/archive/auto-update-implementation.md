# 全自动化构建、发布与应用内自动更新 - 完成总结

## 改动概览

| 文件 | 改动 |
|---|---|
| `src/main/services/update-center.ts` | 重写：集成 electron-updater，支持下载进度推送 |
| `src/main/ipc/settings.ts` | 新增 downloadUpdate / installUpdate IPC 通道 |
| `src/preload/apis/platform-api.ts` | 新增 downloadUpdate / installUpdate / onUpdateStateChanged API |
| `src/shared/types/electron.d.ts` | 新增 downloading/downloaded 状态、downloadProgress 字段 |
| `src/renderer/components/settings/sections/AboutSection.tsx` | 重写：动态按钮 + 下载进度条 |
| `src/renderer/components/settings/utils.ts` | 新增 downloading/downloaded 状态格式化 |
| `src/renderer/components/SettingsView.tsx` | 新增 handler + 实时状态监听器 |
| `src/main/index.ts` | 初始化 autoUpdater（仅生产环境） |
| `package.json` | 添加 electron-updater 依赖、publish 配置、electron:publish 脚本 |
| `.github/workflows/release.yml` | 新建：Mac + Windows 双平台构建发布 workflow |

## 更新流程

```
git tag v0.2.0 → git push --tags
  → GitHub Actions 自动触发
  → macos-latest + windows-latest 并行构建
  → 产物上传到 mulby-releases 仓库 Release
  → 用户端自动检测 → 下载 → 安装重启
```

## 用户待办

1. **创建公开仓库** `Unicellular-SU/mulby-releases`
2. **配置 GitHub Secret**：在 **mulby（代码仓库）** 的 Settings → Secrets → Actions 中添加 `GH_TOKEN`（需对 mulby-releases 有 write 权限的 PAT）
3. **首次发布测试**：`git tag v0.1.0 && git push --tags`

## 验证结果

- ✅ TypeScript 类型检查通过
- ✅ Vite 生产构建通过
