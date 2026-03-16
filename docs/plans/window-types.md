# 插件窗口类型实现

## 概述

新增了三种窗口类型配置，通过 `manifest.json` 的 `window.type` 字段控制：

- **`default`**：带 Mulby 标题栏的标准窗口（默认值，行为不变）
- **`borderless`**：无边框窗口，没有标题栏和系统边框
- **`fullscreen`**：全屏窗口，自动占满主屏幕工作区

## 修改文件

### 核心代码
- `src/shared/types/plugin.ts`：新增 `WindowType` 类型和 `type`/`titleBar` 字段
- `src/main/plugin/window.ts`：`createDetachedWindow` 和 `createAuxiliaryWindow` 根据 type 决定是否注入标题栏、是否全屏
- `src/main/plugin/panel-window.ts`：`promoteToWindow` 同样根据 type 决定标题栏行为

### 文档
- `docs/manifest-v2.md`：添加窗口类型文档和示例
- `skills/develop-mulby-plugin/references/plugin-development-guide.md`：添加 Window Types 章节
- `skills/develop-mulby-plugin/references/PLUGIN_DEVELOP_PROMPT.md`：更新设置表格

### CLI
- `packages/mulby-cli/src/commands/create/templates/react/types.ts`：PluginInfo.window 添加 type/titleBar

## 使用示例

```json
// 无边框悬浮窗
{
  "window": {
    "type": "borderless",
    "width": 300,
    "height": 200
  }
}

// 全屏画板
{
  "window": {
    "type": "fullscreen"
  }
}

// 默认带标题栏窗口（无需显式设置 type）
{
  "window": {
    "width": 800,
    "height": 600
  }
}
```

## 状态：✅ 已完成

## 第二阶段：子窗口 create() API 扩展

### 概述

扩展了 `window.mulby.window.create()` API，让子窗口也能独立指定窗口类型，不再继承 manifest 配置。

### 新增选项

- `type`: 窗口类型 (`default` / `borderless` / `fullscreen`)
- `titleBar`: 是否显示标题栏
- `fullscreen`: 是否全屏
- `alwaysOnTop`: 是否置顶
- `resizable`: 是否可调大小
- `x`, `y`: 窗口位置
- `minWidth`, `minHeight`, `maxWidth`, `maxHeight`: 尺寸约束

### 修改文件

- `src/main/plugin/window.ts`: `AuxiliaryWindowOptions` 接口 + `createAuxiliaryWindow` 扩展
- `src/preload/apis/core-api.ts`: `create()` options 类型扩展
- `skills/develop-mulby-plugin/references/apis/window.md`: API 文档更新

### 使用示例

```javascript
// 创建无边框悬浮窗
const floater = await window.mulby.window.create('/widget', {
  type: 'borderless',
  width: 300,
  height: 200,
  alwaysOnTop: true
});

// 创建全屏画板
const canvas = await window.mulby.window.create('/canvas', {
  type: 'fullscreen'
});
```

## 状态：✅ 已完成

