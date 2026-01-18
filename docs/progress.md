# 权限管理器实现进度

> **更新时间**: 2026-01-11
> **状态**: ✅ 已完成

## 完成内容

### 核心模块
- [x] `src/main/plugin/permission-manager.ts` (310 行)
  - 跨平台权限管理器
  - macOS: `node-mac-permissions` 集成
  - Windows/Linux: `session.setPermissionRequestHandler`

### 地理位置模块
- [x] `src/main/plugin/geolocation.ts` - 重构使用权限管理器
- [x] `src/main/ipc/geolocation.ts` - 新增 IPC 端点
- [x] `src/preload/index.ts` - 暴露新 API

### 类型定义
- [x] `src/shared/types/electron.d.ts` - 更新 geolocation 类型

### 构建配置
- [x] `package.json` - 添加 `node-mac-permissions`，electron-builder 配置
- [x] `resources/Info.plist` - macOS 权限描述

### 插件集成
- [x] `plugins/intools-showcase/src/types/intools.d.ts`
- [x] `plugins/intools-showcase/src/ui/hooks/useIntools.ts`
- [x] `plugins/intools-showcase/src/ui/modules/SystemInfo/index.tsx`

### 文档
- [x] `docs/api-reference.md` - 更新 Geolocation API 文档

## 新增 API

```typescript
geolocation.getAccessStatus()   // 获取权限状态
geolocation.requestAccess()     // 请求权限
geolocation.canGetPosition()    // 能否获取位置
geolocation.openSettings()      // 打开系统设置
geolocation.getCurrentPosition() // 获取当前位置
```

## 测试方法

1. 运行 `npm run electron:dev`
2. 打开 intools-showcase 插件
3. 进入"系统信息"模块
4. 点击"获取位置"按钮
5. 观察终端日志和系统权限弹窗

## 依赖项

- `node-mac-permissions@^2.5.0` (macOS 权限检查)

---

# 系统文件搜索支持进度

> **更新时间**: 2026-01-18
> **状态**: ✅ 已完成

## 完成内容

### 核心模块
- [x] `src/main/plugin/desktop.ts`
  - 跨平台文件搜索实现
  - macOS: `mdfind`
  - Windows: `es` (Everything CLI)
  - Linux: `locate`

### IPC 通信
- [x] `src/main/ipc/desktop.ts` - 注册搜索处理程序
- [x] `src/main/ipc/index.ts` - 整合 Desktop 模块

### 预加载脚本
- [x] `src/preload/index.ts` - 暴露 `intools.desktop.searchFiles`

## API 说明

```typescript
// 搜索系统文件
// query: 关键词
// limit: 限制返回数量 (默认 100)
intools.desktop.searchFiles(query: string, limit?: number): Promise<FileSearchResult[]>

interface FileSearchResult {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}
```

## 注意事项
- Windows 平台强依赖 "Everything" 及其命令行工具 `es.exe`。
- Linux 平台依赖 `locate` 命令（需确保 `updatedb` 定期运行）。
- macOS 使用原生 Spotlight 索引，无需额外配置。
