# InTools 插件 API 状态

本文档记录 InTools 插件系统已实现和待实现的底层 API。

## 已实现的 API（共 20 个）

### 基础 API

| API | 文件 | 功能 | 跨平台 |
|-----|------|------|--------|
| **Clipboard** | `plugin/api.ts` | 剪贴板读写 | ✅ |
| **Notification** | `plugin/api.ts` | 系统通知 | ✅ |
| **Storage** | `plugin/storage.ts` | 数据持久化 | ✅ |
| **Filesystem** | `plugin/filesystem.ts` | 文件系统操作 | ✅ |
| **HTTP** | `plugin/http.ts` | 网络请求 | ✅ |
| **Window** | `ipc/window.ts` | 窗口控制 | ✅ |
| **Theme** | `ipc/theme.ts` | 主题管理 | ✅ |

### 系统集成 API

| API | 文件 | 功能 | 跨平台 |
|-----|------|------|--------|
| **Screen** | `plugin/screen.ts` | 截图、录屏、屏幕信息 | ✅ |
| **Shell** | `plugin/shell.ts` | 打开文件/URL/文件管理器 | ✅ |
| **Dialog** | `plugin/dialog.ts` | 系统对话框 | ✅ |
| **System** | `plugin/system.ts` | 系统/应用信息 | ✅ |
| **Shortcut** | `plugin/shortcut.ts` | 全局快捷键 | ✅ |
| **Security** | `plugin/security.ts` | 加密存储 | ✅ |
| **Tray** | `plugin/tray.ts` | 系统托盘 | ✅ (title 仅 macOS) |
| **Menu** | `plugin/menu.ts` | 原生右键菜单 | ✅ |
| **Network** | `plugin/network.ts` | 网络状态监控 | ✅ |

### 媒体/硬件 API

| API | 文件 | 功能 | 跨平台 |
|-----|------|------|--------|
| **Media** | `plugin/media.ts` | 摄像头/麦克风权限 | ✅ (权限检查仅 macOS) |
| **Power** | `plugin/power.ts` | 电源监控、休眠事件 | ✅ (热状态仅 macOS) |
| **Geolocation** | `plugin/geolocation.ts` | 地理位置 | ✅ |
| **TTS** | `preload/index.ts` | 语音合成 | ✅ |

## 待实现的 API

### 高优先级

| API | 功能 | 使用场景 | 复杂度 |
|-----|------|----------|--------|
| **Dock** | macOS Dock 操作 | 角标、进度条、弹跳提醒 | 低 |
| **Print** | 打印功能 | 打印文档、票据 | 中 |

### 中优先级

| API | 功能 | 使用场景 | 复杂度 |
|-----|------|----------|--------|
| **PDF** | PDF 生成 | 导出 PDF 文档 | 中 |
| **TouchBar** | macOS 触控栏 | 快捷操作（仅 macOS） | 低 |
| **AutoLaunch** | 开机自启动 | 后台服务插件 | 低 |

### 低优先级（高级功能）

| API | 功能 | 使用场景 | 复杂度 |
|-----|------|----------|--------|
| **Bluetooth** | 蓝牙设备 | 连接蓝牙设备 | 高 |
| **USB** | USB 设备 | 读取硬件设备 | 高 |
| **Serial** | 串口通信 | Arduino、硬件调试 | 高 |
| **HID** | 人机接口设备 | 游戏手柄、特殊键盘 | 高 |

## 文件结构

```
src/main/
├── plugin/           # 插件 API 实现
│   ├── api.ts        # API 入口，整合所有 API
│   ├── storage.ts    # Storage API
│   ├── filesystem.ts # Filesystem API
│   ├── http.ts       # HTTP API
│   ├── screen.ts     # Screen API
│   ├── shell.ts      # Shell API
│   ├── dialog.ts     # Dialog API
│   ├── system.ts     # System API
│   ├── shortcut.ts   # GlobalShortcut API
│   ├── security.ts   # Security API
│   ├── media.ts      # Media API
│   ├── power.ts      # Power API
│   ├── tray.ts       # Tray API
│   ├── network.ts    # Network API
│   ├── menu.ts       # Menu API
│   └── geolocation.ts # Geolocation API
│
├── ipc/              # IPC 处理器
│   ├── index.ts      # 注册所有 IPC 处理器
│   ├── clipboard.ts
│   ├── notification.ts
│   ├── window.ts
│   ├── theme.ts
│   ├── plugin.ts
│   ├── screen.ts
│   ├── shell.ts
│   ├── dialog.ts
│   ├── system.ts
│   ├── shortcut.ts
│   ├── security.ts
│   ├── media.ts
│   ├── power.ts
│   ├── tray.ts
│   ├── network.ts
│   ├── menu.ts
│   └── geolocation.ts
│
src/preload/
└── index.ts          # 暴露 API 给渲染进程

src/shared/types/
└── electron.d.ts     # TypeScript 类型定义
```

## 相关文档

- [API 参考文档](./api-reference.md) - 详细的 API 使用说明
- [插件开发规范](./plugin-spec.md) - 插件开发指南
- [Manifest 规范](./manifest-v2.md) - 插件配置文件说明

## 贡献指南

如需添加新的 API，请按以下步骤：

1. 在 `src/main/plugin/` 创建 API 实现文件
2. 在 `src/main/ipc/` 创建 IPC 处理器
3. 更新 `src/main/ipc/index.ts` 注册处理器
4. 更新 `src/main/plugin/api.ts` 添加到插件 API
5. 更新 `src/preload/index.ts` 暴露给渲染进程
6. 更新 `src/shared/types/electron.d.ts` 类型定义
7. 更新 `docs/api-reference.md` 文档
8. 更新本文档的 API 列表

