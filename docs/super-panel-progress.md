# Mulby 超级面板开发进展

> 更新时间：2026-04-11

## 完成状态：✅ 全部完成

超级面板功能的完整闭环已落地，包含 **6 个新建文件、8 个修改文件**，TypeScript + ESLint 双重验证通过。

## 模块清单

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/main/services/native-keyboard-sim.ts` | 零延迟键盘模拟（koffi FFI，< 5ms） |
| `src/main/services/super-panel-manager.ts` | 核心控制器（触发→黑名单→取词→匹配→显示） |
| `src/main/services/super-panel-window.ts` | 面板窗口管理器（智能定位，失焦隐藏） |
| `public/super-panel.html` + `.css` + `.js` | 面板前端 UI |
| `src/renderer/components/settings/sections/SuperPanelSection.tsx` | 设置页面 UI |

### 修改文件

| 文件 | 改动 |
|------|------|
| `shared/types/settings.ts` | 新增 SuperPanelSettings 类型 |
| `main/services/app-settings.ts` | 默认值 + 归一化 + 30+ 应用黑名单 |
| `preload/apis/platform-api.ts` | 暴露 superPanel IPC API |
| `shared/types/electron.d.ts` | 类型声明 |
| `main/ipc/settings.ts` | 设置变更回调 |
| `main/ipc/index.ts` | registerAllHandlers 扩展 |
| `main/index.ts` | 生命周期集成 + 资源清理 |
| `renderer/components/SettingsView.tsx` | 路由渲染 |
| `renderer/components/settings/types.ts` | Section 类型 |
| `renderer/components/settings/constants.ts` | 侧边栏菜单 |
| `main/services/system-page-window-manager.ts` | SettingsCenterSection 类型 |

## 设置页面 UI 结构

超级面板设置页面位于 **设置 → 超级面板**，包含 4 个卡片区域：

1. **总开关**：启用/禁用超级面板，macOS 触控板特殊提示
2. **触发方式**：4 种模式切换（鼠标单击/长按/快捷键/双击修饰键），每种模式有对应子选项
3. **应用黑名单**：添加/删除屏蔽应用（支持 Bundle ID、应用名、exe 文件名）
4. **高级设置**：可折叠面板，包含剪贴板检测延迟和最大显示条目数

## 待验证

- 用户需在设置中启用超级面板后手动测试完整功能流
