# Mulby 快速开始

## 1. 第一次打开先做什么

1. 打开设置里的“快速开始”卡片，先进入插件商店。
2. 安装一个简单插件，验证搜索、执行、通知这条主链路。
3. 如果需要 AI 功能，再进入 AI 设置配置 Provider、模型和默认策略。
4. 如果需要自动化，再进入任务调度器创建定时任务。

## 2. 插件商店安全规则

- 远程仓库源默认要求 `HTTPS`
- 只有 `localhost` / `127.0.0.1` 这类本地开发源允许 `HTTP`
- 插件索引如果提供 `sha256`，Mulby 会在安装前自动校验下载包
- 安装后的来源元数据会写入插件目录下的 `.mulby-install.json`

## 3. 从仓库里的示例开始

示例目录:
- `examples/plugins/hello-clipboard`
- `examples/plugins/timestamp-tools`

建议顺序:
1. 先看各目录下的 `manifest.json`
2. 再看 `main.js`
3. 最后看各自的 `README.md`

## 4. 本轮推荐验证项

- 能否从插件商店正常加载索引
- HTTPS 来源能否正常安装
- 缺少 `sha256` 的插件是否能看到提醒
- 提供 `sha256` 的插件是否能看到校验通过提示
- Windows 上 `npm run verify` 是否可正常执行
