# Mulby

![Mulby Logo](resources/icons/mulby-v1.svg)

跨平台插件式效率工具箱，聚合全局启动器、插件生态、AI 能力、MCP 集成与本地自动化。

Mulby 面向两类用户：

- 希望把桌面搜索、系统动作、插件工作流和 AI 工具集中到一个入口的效率用户
- 希望开发桌面插件、接入 AI/MCP 能力、扩展本地工作流的开发者

Mulby 通过全局快捷键唤起，支持插件搜索与执行、插件商店安装、AI 能力编排、任务调度和系统集成。源码仓库公开在这里，安装包与自动更新发布在独立的 release 仓库中。

## 核心能力

- 全局启动器与系统入口：支持全局快捷键唤起、托盘菜单、自定义快捷键、设置中心、插件商店、插件管理、日志中心、AI 设置、超级面板等入口，并内置锁屏、睡眠、重启、关机、截图、取色、打开 URL、打开用户数据目录等系统命令。
- 搜索与触发：支持插件关键字、正则、文本粘贴、文件和图片附件、前台窗口上下文等触发方式；搜索结果支持拼音匹配、最近使用、固定和隐藏偏好，并可检索本机应用与文件。
- 插件运行时与 API：Node.js 插件通过 Host Worker + API Bridge 运行，支持附着面板、独立窗口、后台插件、持久会话、动态指令、AI Tools、资源限制和命令执行权限；通过 `window.mulby` 与 Host API 提供剪贴板、通知、存储、文件系统、Shell、HTTP/Network、窗口、菜单、托盘、主题、权限、截图、输入、媒体、TTS、Sharp、FFmpeg、InBrowser、插件间消息等能力。
- 插件商店与安装：支持 `.inplugin` 包安装、在线 URL 安装、多仓库源管理、安装状态识别、批量更新、来源优先级合并、`sha256` 完整性校验和安装来源记录。
- AI、MCP 与 Skills：支持多 Provider/多实例配置、流式输出、工具调用、附件上传、图片生成/编辑；支持作为 MCP Client 连接 `stdio`、`SSE`、`streamableHttp` 服务，也支持作为 MCP Server 暴露插件声明的 AI Tools 给外部客户端使用。
- 自动化与治理：支持任务调度、剪贴板历史、超级面板、深链接 `mulby://`、自动更新中心、Web Search、Git/脚本执行、能力授权策略、命令审计和范围限制。

## 下载与发布

- 安装包与版本发布：[https://github.com/Unicellular-SU/mulby-releases/releases](https://github.com/Unicellular-SU/mulby-releases/releases)
- 当前源码仓库：[https://github.com/Unicellular-SU/mulby](https://github.com/Unicellular-SU/mulby)

Mulby 目前采用“源码仓库”和“发布仓库”分离的方式：

- `mulby`：托管应用源码、文档、Issue 和开发协作
- `mulby-releases`：托管桌面安装包、自动更新资产和 GitHub Releases

这样做的原因很直接：当前 GitHub Action、应用内更新中心和 macOS 资源更新链路都已经稳定运行在 `mulby-releases` 上，继续保持分离可以减少迁移成本和兼容性风险。

## 界面预览

### 主窗口与搜索

![主窗口](docs/screenshots/main-window.png)

![搜索结果](docs/screenshots/search.png)

### 插件生态

![插件商店](docs/screenshots/store.png)

![插件详情](docs/screenshots/plugin-1.png)

![插件管理](docs/screenshots/plugin-2.png)

### 设置与超级面板

![设置中心](docs/screenshots/settings.png)

![超级面板](docs/screenshots/super-panel.png)

![关于页面](docs/screenshots/about.png)

## 快速开始

### 使用应用

1. 前往 [mulby-releases](https://github.com/Unicellular-SU/mulby-releases/releases) 下载对应平台的安装包。
2. 安装后，通过全局快捷键或托盘入口启动 Mulby。
3. 在插件商店中订阅官方插件源，或手动安装 `.inplugin` 插件包。

### 源码开发

当前仓库更适合作为源码阅读、构建和功能开发入口。

```bash
# 安装依赖
pnpm install

# 构建原生模块
pnpm run native:build

# 构建桌面应用
pnpm run electron:build

# 仓库校验
pnpm run verify
```

## 生态仓库

Mulby 不是单一仓库项目，公开生态目前由以下几个仓库组成：

- [mulby](https://github.com/Unicellular-SU/mulby)：桌面宿主应用源码仓库
- [mulby-releases](https://github.com/Unicellular-SU/mulby-releases)：安装包、自动更新资产与 Release 发布仓库
- [mulby-plugins](https://github.com/Unicellular-SU/mulby-plugins)：官方插件仓库与默认插件商店源订阅链接：`https://raw.githubusercontent.com/Unicellular-SU/mulby-plugins/refs/heads/main/plugins.json`
- [mulby-cli](https://github.com/Unicellular-SU/mulby-cli)：插件开发 CLI，用于创建、调试、构建和打包插件
- [mulby-skills](https://github.com/Unicellular-SU/mulby-skills)：面向 AI 辅助开发插件的 Skills 与参考资料

如果你希望基于 Mulby 开发插件，通常会按下面的关系使用：

1. 在 `mulby-cli` 中创建和构建插件
2. 参考 `mulby-skills` 中的开发技能与文档
3. 将插件发布到自己的仓库，或提交到 `mulby-plugins` 收录
4. 在 Mulby 桌面应用中安装、调试和运行

## 平台与项目状态

- macOS：主力开发和持续发布平台
- Windows：已支持并持续发布
- Linux：已有构建目标，但验证相对有限

项目状态：

- 当前处于活跃开发中
- 功能面已经较完整，但部分能力仍在持续迭代
- 对插件生态、AI Provider、MCP、系统集成和兼容性优化仍然欢迎反馈与贡献

## 安全与权限

Mulby 的能力边界相对大，公开仓库后这点需要明确说明：

- 插件可以申请文件系统、Shell、HTTP、窗口、媒体、截图、AI 工具等能力
- AI 工具支持文件系统、Patch、HTTP、Git、脚本执行和 Web Search 等高权限操作
- 项目内已实现插件工具开关、能力授权策略、文件/HTTP/Git/脚本范围限制和命令执行审计

## 架构概览

- `src/main`：主进程、IPC、插件系统、AI、调度器、设置/托盘/日志服务
- `src/preload`：通过 `window.mulby` 暴露受控 API
- `src/renderer`：React 前端，包括主界面、设置中心、插件管理、插件商店、AI 设置等

## 参与贡献

欢迎提交 Issue、PR，也欢迎一起完善插件生态。比较适合贡献的方向包括：

- 编写插件，并提交到官方插件仓库
- 完善 `mulby-cli` 模板、插件 API 文档与开发示例
- 补充 Windows、macOS、Linux 的兼容性测试与问题修复
- 改进 AI Provider、MCP、Skills、Web Search、超级面板等能力

贡献流程与开发约定见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

开发前建议先运行 `pnpm install`，提交前执行 `pnpm run verify`。

## 为什么做 Mulby

最初开发 Mulby，是因为我实在无法接受 uTools 免费会员最多只能用 10 个插件的限制。后来发现 AI 编码已经足够强，于是决定自己做一个同类型但更偏向“本地大一统”的工具，把插件、系统动作、AI 能力和各种桌面工作流整合到一起。（然而AI花费已经够买好几个uTools的永久会员了...）

从一月份立项，断断续续写到了五月份，做了一大半才发现优秀的开源项目 ZTools，严格说这确实属于“重复造轮子”，但既然已经开始做，也就继续把它做成一个完整、可扩展、可公开协作的项目。后续的开发过程中也参考了 [Ztools](https://github.com/ZToolsCenter/ZTools)、[rubick](https://github.com/rubickCenter/rubick) 等优秀开源项目的很多实现细节。Mulby 的整体理念和 uTools / zTools / Rubick 并无本质冲突，都是全局启动器加插件生态，只是实现方式和能力侧重点有所不同。

这个项目的代码实现几乎完全依赖 AI 辅助完成，这既是 Mulby 的开发方式，也是它为什么会自然延伸出 `mulby-cli` 和 `mulby-skills` 这两个生态仓库的原因。

> PS: Linux 目前不是我的主力开发环境，验证有限，欢迎补充测试和 PR。

## 许可证

[MIT License](./LICENSE)

安全漏洞报告方式见 [SECURITY.md](./SECURITY.md)。

## 致谢

再次鸣谢 [uTools](https://www.u-tools.cn/)、[zTools](https://github.com/threezh1/zTools)、[Rubick](https://github.com/clouDr-f2e/rubick) 等优秀工具的启发与借鉴。
