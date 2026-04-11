# 快捷键抢占功能进展

> 完成日期：2026-03-22

## 背景

当其他软件比 Mulby 先启动并注册了相同全局快捷键时，Mulby 无法获取。

## 解决方案：两层防御策略

### 第 1 层：后台定时重试
`globalShortcut.register()` 失败时，每 5 秒重试。对方释放后自动接管。

### 第 2 层：底层键盘钩子（uiohook-napi）
通过 `WH_KEYBOARD_LL`（Windows）/ `CGEventTap`（macOS）在 OS 层拦截按键，设置 `event.reserved = 0x1` 抑制事件传播，确保只有 Mulby 响应。

**流程**：`globalShortcut` 优先 → 失败时激活钩子 → 持续后台重试 → 抢回后关闭钩子。

## 修改的文件

- `src/main/services/keyboard-hook.ts` — 新增底层钩子服务
- `src/main/services/app-shortcuts.ts` — 集成钩子兜底
- `src/main/index.ts` — 注入钩子服务
- `src/shared/types/settings.ts` — `ShortcutStatus.via` 字段
- `src/renderer/components/settings/ShortcutInput.tsx` — UI 状态显示
- `src/preload/apis/platform-api.ts` — IPC 事件
- `src/shared/types/electron.d.ts` — 类型声明
- `src/renderer/components/SettingsView.tsx` — 状态监听
- `package.json` — uiohook-napi 依赖

## 验证

- TypeScript 编译：零错误
- 单元测试：194 通过 / 0 失败
- API 文档同步：通过
