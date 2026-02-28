# Mulby API 状态（代码对齐）

> 最后更新：2026-02-28  
> 对齐基准（Source of Truth）：
> - `src/preload/index.ts`
> - `src/main/ipc/index.ts`
> - `src/main/plugin/api.ts`
> - `src/shared/types/electron.d.ts`

本文档只记录“代码中已实现并可调用”的 API 面，避免文档与实现漂移。

## 1. 渲染进程 API（`window.mulby`）

当前主 API 面（按模块）如下：

- `window` / `subInput` / `theme`
- `ai` / `app` / `systemPlugin` / `systemPage`
- `clipboard` / `input` / `notification`
- `plugin` / `pluginStore` / `scheduler`
- `screen` / `shell` / `desktop` / `filesystem` / `dialog` / `system`
- `permission` / `shortcut` / `security` / `storage`
- `settings` / `developer`
- `media` / `power` / `tray` / `trayMenu`
- `http` / `network` / `menu` / `geolocation`
- `tts` / `host` / `inbrowser` / `sharp` / `ffmpeg` / `log`

另外包含事件类入口：
- `onThemeChange`
- `onWindowStateChange`
- `onPluginInit` / `onPluginAttach` / `onPluginDetached`

## 2. 插件后端 API（`context.api`）

当前插件运行时 API（`src/main/plugin/api.ts`）包含：

- `clipboard`
- `clipboardHistory`
- `notification`
- `storage`
- `filesystem`
- `http`
- `screen`
- `shell`
- `dialog`
- `system`
- `shortcut`
- `security`
- `media`
- `power`
- `tray`
- `network`
- `input`
- `permission`
- `features`
- `messaging`
- `ai`
- `scheduler`

## 3. IPC 模块注册状态

`src/main/ipc/index.ts` 当前注册模块：

- `clipboard`
- `clipboard-history`
- `notification`
- `window`
- `plugin`
- `theme`
- `screen`
- `shell`
- `dialog`
- `system`
- `desktop`
- `shortcut`
- `security`
- `media`
- `power`
- `tray`
- `network`
- `http`
- `menu`
- `geolocation`
- `input`
- `permission`
- `host`
- `filesystem`
- `storage`
- `inbrowser`
- `sharp`
- `ffmpeg`
- `settings`
- `developer`
- `log`
- `scheduler`
- `ai`
- `system-plugin`
- `system-page`

说明：`tray-menu` 相关 handler 位于服务层（`src/main/services/tray-menu-window.ts`），不在 `src/main/ipc` 目录内。

## 4. 当前已知差异（代码已实现但文档曾遗漏）

已补齐至 `docs/apis/` 的模块：
- `app-events`
- `desktop`
- `developer`
- `log`
- `plugin-store`
- `settings`
- `system-page`
- `system-plugin`
- `tray-menu`

## 5. 延后事项（非本轮）

- 插件商店安全增强（签名/校验链）
- Python 插件运行时（废弃）
- i18n 多语言体系（待定）

## 6. 维护规则

1. 任何 API 变更，先改代码，再同步 `docs/apis/*.md` 与本文档。  
2. 若文档与实现冲突，以代码为准。  
3. 每次迭代结束至少更新一次“最后更新”日期。
