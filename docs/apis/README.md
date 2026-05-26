# Mulby API 接口参考（代码对齐）

> 最后更新：2026-05-14
> 对齐基准：`src/preload/apis/*.ts`、`src/main/plugin/api.ts`、`src/main/ipc/index.ts`；自动校验命令：`npm run check:api-docs`（已接入 CI 的 `verify:app`）

## 系统与应用
- [System API (system)](./system.md)
- [Power API (power)](./power.md)
- [Tray API (tray)](./tray.md)
- [Tray Menu API (tray-menu)](./tray-menu.md)
- [权限 API (permission)](./permission.md)
- [Security API (security)](./security.md)
- [Settings API (settings)](./settings.md)
- [Developer API (developer)](./developer.md)
- [App Events API (app-events)](./app-events.md)
- [System Plugin API (system-plugin)](./system-plugin.md)
- [System Page API (system-page)](./system-page.md)
- [Log API (log)](./log.md)
- [AI API (ai)](./ai.md)

## 窗口与界面
- [窗口 API (window)](./window.md)
- [主题 API (theme)](./theme.md)
- [Dialog API (dialog)](./dialog.md)
- [Menu API (menu)](./menu.md)
- [通知 API (notification)](./notification.md)
- [TTS API (tts)](./tts.md)
- [Super Panel API (superPanel)](./super-panel.md)

## 输入与快捷
- [GlobalShortcut API (shortcut)](./shortcut.md)
- [剪贴板 API (clipboard)](./clipboard.md)
- [剪贴板历史 API (clipboardHistory)](./clipboard-history.md)
- [输入 API (input)](./input.md)
- [全局输入监听 API (inputMonitor)](./input-monitor.md)

## 插件与调度
- [插件管理 API (plugin)](./plugin.md)
- [插件商店 API (plugin-store)](./plugin-store.md)
- [插件 Host API (host)](./host.md)
- [任务调度 API (scheduler)](./scheduler.md)
- [动态指令 API (features)](./features.md)
- [插件间通信 API (messaging)](./messaging.md)
- [InBrowser API (inbrowser)](./inbrowser.md)

## 文件、网络与位置
- [文件系统 API (filesystem)](./filesystem.md)
- [存储 API (storage)](./storage.md)
- [目录授权 API (directoryAccess)](./directory-access.md)
- [Shell API (shell)](./shell.md)
- [Desktop 搜索 API (desktop)](./desktop.md)
- [HTTP API (http)](./http.md)
- [Network API (network)](./network.md)
- [Geolocation API (geolocation)](./geolocation.md)

## 媒体与图像
- [Media API (media)](./media.md)
- [屏幕 API (screen)](./screen.md)
- [Sharp 图像处理 API (sharp)](./sharp.md)
- [FFmpeg 音视频处理 API (ffmpeg)](./ffmpeg.md)

## 说明
- 文档以代码实现为准，接口签名请同时参考 `src/shared/types/electron.d.ts`。
- 如发现文档与实现不一致，请以代码为准并提报文档修正。
- 日常可执行 `npm run check:api-docs` 做一致性检查；CI 会在 `npm run verify:app` 中强制校验。
