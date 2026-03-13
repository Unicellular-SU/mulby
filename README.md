# Mulby

跨平台插件式效率工具箱（Electron Desktop App）

> 声明：本项目完全由AI编码完成。

## 项目简介

Mulby 是一个面向开发者和效率用户的桌面启动器，通过全局快捷键唤起，支持插件搜索与执行、插件商店安装、AI 能力编排和任务调度。

当前实现以代码为准：
- `src/main`
- `src/preload`
- `src/renderer`

## 当前能力

- 全局唤起与页面入口：支持主窗口、设置中心、AI 设置、插件商店、插件管理、后台插件、任务调度、日志中心等入口。
- 插件系统：Node.js 插件运行链路（Host Worker + API Bridge），支持附着面板与独立窗口、后台插件、拖拽 `.inplugin` 安装。
- 插件商店：支持多仓库源管理、在线索引加载、安装/更新状态识别。
- 商店安全策略：仅允许 `HTTPS` 或本地 `HTTP(localhost/127.0.0.1)` 来源安装，支持 `sha256` 完整性校验与来源元数据记录。
- AI 能力中心：多 Provider 配置（如 OpenAI、Anthropic、Gemini、DeepSeek 及 OpenAI-compatible）、模型管理、MCP、Skills、附件与工具调用。
- 自动化与治理：任务调度、命令执行安全策略、审计记录、能力授权策略，以及类型检查/Lint/单测/构建的校验链路。

## 架构概览

- `src/main`：主进程、IPC、插件系统、AI、调度器、设置/托盘/日志服务。
- `src/preload`：通过 `window.mulby` 暴露受控 API。
- `src/renderer`：React 前端（主界面、设置中心、插件管理、插件商店、AI 设置等）。
- `packages/mulby-cli`：插件开发 CLI（创建、调试、构建、打包）。


## 快速开始

```bash
# 安装依赖（主应用）
npm install

# 启动开发模式（Electron + Vite）
npm run electron:dev

# 构建桌面应用
npm run electron:build
```

## 常用脚本

```bash
# 主应用校验：类型检查 + Lint + 单测 + 构建烟测
npm run verify

# 仓库校验：主应用 + CLI
npm run verify:repo

# 安装 CLI 子包依赖（首次需要）
npm run install:cli-deps
```

## 插件开发入口

- [Mulby CLI 文档](./packages/mulby-cli/README.md)
- [插件示例仓库（mulby_plugins）](https://github.com/Unicellular-SU/mulby_plugins)

## 文档导航

- [文档索引](./docs/README.md)
- [产品需求文档（PRD）](./docs/PRD.md)
- [技术架构设计](./docs/architecture.md)
- [插件系统规范](./docs/plugin-spec.md)
- [API 接口参考](./docs/api-reference.md)
- [快速开始（产品内流程）](./docs/QUICK_START.md)

## 许可证

MIT License
