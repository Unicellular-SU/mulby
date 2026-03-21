# Mulby 首次启动引导窗口 — 开发进展

## 2026-03-21 — 初始实现完成

### 已完成
- 7 步引导流程（欢迎 → 快捷键 → 主题 → 插件商店 → AI 配置 → 功能快览 → 完成）
- 独立 Electron 窗口（720×520, frameless, 居中）
- TypeScript 编译通过
- 涉及 10 个文件（4 新建 + 7 修改）

### 关键文件
- 窗口管理: `src/main/services/onboarding-window.ts`
- IPC: `src/main/ipc/onboarding.ts`
- 组件: `src/renderer/components/OnboardingView.tsx`
- 样式: `src/renderer/styles/onboarding.css`

### 待手动验证
- 完整引导流程交互
- 配置持久化
- 二次启动不再显示引导
