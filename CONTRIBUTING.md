# Contributing to Mulby

感谢你考虑参与 Mulby。

Mulby 是一个桌面宿主应用仓库，但它同时又和插件生态、发布仓库、插件开发 CLI、AI Skills 资料一起组成完整生态。开始贡献前，建议先确认你要改动的是哪个层面的问题。

## 仓库关系

- `mulby`：桌面应用源码、Issue、PR、文档
- `mulby-releases`：安装包与自动更新发布资产
- `mulby-plugins`：官方插件仓库与默认插件商店源
- `mulby-cli`：插件开发 CLI
- `mulby-skills`：AI 辅助插件开发的 Skills 与参考资料

如果你的改动涉及插件模板、插件开发流程或 AI 开发资料，变更可能不只发生在本仓库。

## 适合贡献的方向

- 修复桌面应用 Bug
- 改进插件系统、AI Provider、MCP、系统集成、超级面板等能力
- 补充 Windows、macOS、Linux 的兼容性测试与问题修复
- 改进 API 文档、开发说明和用户文档
- 编写插件，并提交到 `mulby-plugins` 收录

## 开发环境

当前 CI 使用：

- Node.js `24`
- pnpm `10`

建议本地也保持一致，避免原生模块、锁文件或构建行为不一致。

安装依赖：

```bash
pnpm install
```

常用命令：

```bash
# 构建原生模块
pnpm run native:build

# 构建桌面应用
pnpm run electron:build

# 类型检查 + Lint + API 文档校验 + 单测 + 构建校验
pnpm run verify:app
```

## 提交前要求

提交 PR 前，请至少确认以下几点：

1. 相关改动已经通过 `pnpm run verify:app`
2. 如果改动影响插件 API、预加载 API 或 IPC 能力，相关文档已同步更新
3. 如果改动影响跨仓库行为，例如 `mulby-cli` 模板、`mulby-skills` 文档或插件源结构，已经在 PR 描述中写明
4. 如果改动涉及系统权限、命令执行、文件访问、网络访问、MCP 或 AI 工具能力，已经说明安全影响

## 文档与 API 对齐

Mulby 对 API 文档和代码一致性有明确校验。

相关参考：

- `docs/apis/README.md`
- `src/preload/apis/*.ts`
- `src/main/plugin/api.ts`
- `src/main/ipc/index.ts`

提交前建议直接运行：

```bash
pnpm run check:api-docs
```

如果你的改动让 API 行为发生变化，但没有同步文档，CI 会在 `verify:app` 中拦住。

## PR 说明建议

请在 PR 描述里尽量写清楚下面几项：

- 问题背景
- 改动范围
- 用户可感知变化
- 是否影响插件兼容性
- 是否影响发布、自动更新或平台差异行为
- 是否需要同步其他仓库

对于 UI、交互或跨平台问题，建议附截图、录屏或平台说明。

## 插件生态贡献

如果你要贡献的是插件，而不是宿主应用本身，通常更合适的路径是：

1. 使用 `mulby-cli` 创建和构建插件
2. 参考 `mulby-skills` 中的开发技能和文档
3. 将插件发布到自己的仓库，或提交到 `mulby-plugins`

不要把独立插件直接塞进本仓库，除非它是确实属于宿主应用内建能力的一部分。

## 安全相关改动

如果改动涉及以下内容，请在 PR 中单独标注：

- Shell / 脚本执行
- 文件系统访问
- HTTP / Network 能力
- MCP 连接与工具暴露
- AI 工具权限
- 命令审计、范围限制、权限策略

这类改动需要比普通功能更严格的审查。

## 行为约定

- 保持改动聚焦，不混入无关重构
- 优先沿用现有实现风格和已有抽象
- 不要在没有必要时扩散改动面
- 对外文档优先写真实状态，不写“理想上应该如此”

## 安全漏洞报告

请不要在公开 Issue 中直接披露可利用的安全漏洞。

安全问题请参考 [SECURITY.md](./SECURITY.md) 中的报告方式。
