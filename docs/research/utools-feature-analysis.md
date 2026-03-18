# uTools 特性分析 —— 对 Mulby 的参考价值

> 分析日期：2026-03-18
> 来源：https://www.u-tools.cn/docs/developer/

## 总览

uTools 的 API 文档覆盖了以下领域：事件、窗口、复制、输入、系统、屏幕、用户、数据存储、动态指令、模拟按键、用户付费、ubrowser、MCP 工具、AI、Sharp、FFmpeg。

以下按**对 Mulby 的参考价值**从高到低排序分析。

---

## 🔴 高价值 —— 值得认真研究

### 1. 插件为 AI Agent 提供能力（MCP Tools）

**uTools 做法：**
- 插件在 `plugin.json` 中通过 `tools` 字段声明可供 AI Agent 调用的工具
- 每个 tool 有 `description`、`inputSchema`、`outputSchema`（JSON Schema）
- 运行时通过 `utools.registerTool(name, handler)` 注册处理函数
- 支持进度反馈 `ctx.sendProgress(progress, total, message)`
- 支持**纯无 UI 模式**——插件可以只有 `preload` + `tools`，没有 `main` 和 `features`

**核心思路：** 插件不仅服务用户，还能服务 AI。AI Agent 可以自主决策调用哪个插件的哪个工具来完成任务。

**对 Mulby 的价值：** ⭐⭐⭐⭐⭐
- Mulby 已经有 AI 能力，如果插件能注册自己为 MCP Tool，就形成了 **AI + 插件生态** 的闭环
- 想象场景：用户对 AI 说"帮我把这个视频转成 mp4"，AI 自动调用视频处理插件的 tool
- 插件开发者只需声明 schema + 实现 handler，无需关心 AI 的对话逻辑
- 这比 uTools 更有优势，因为 Mulby 本身就内建了 AI 对话能力

---

### 2. `hideMainWindowPasteText` / `hideMainWindowTypeString` —— 向其他应用输入内容

**uTools 做法：**
- `hideMainWindowPasteText(text)` — 隐藏窗口后，将文本复制到剪贴板并执行粘贴
- `hideMainWindowPasteImage(image)` — 同上，但粘贴图片
- `hideMainWindowPasteFile(filePath)` — 同上，但粘贴文件
- `hideMainWindowTypeString(text)` — 隐藏窗口后，模拟输入法逐字输入文本

**核心思路：** 启动器 + 文本处理插件的经典模式。用户选中文字 → 呼出 uTools → 插件处理 → 结果直接粘贴回原应用。

**对 Mulby 的价值：** ⭐⭐⭐⭐⭐
- 这是效率工具的**杀手级交互模式**
- 适用场景：AI 翻译、密码生成、代码片段、表情符号、模板文本 等
- 建议 Mulby 提供类似的 `mulby.output.paste(text)` 和 `mulby.output.type(text)` API
- 与 `over` 匹配指令配合，可以形成完整的"输入→处理→输出"流程

---

### 3. 动态指令（Dynamic Features）

**uTools 做法：**
- `utools.setFeature(feature)` — 运行时动态注册新的搜索指令
- `utools.removeFeature(code)` — 运行时删除指令
- `utools.getFeatures()` — 获取当前所有动态指令

**核心思路：** 插件不仅在 manifest 中静态声明指令，还可以在运行时根据用户行为动态添加/删除指令。

**对 Mulby 的价值：** ⭐⭐⭐⭐
- Mulby 目前的 commands 是在 manifest 中静态声明的
- 动态指令可以让插件更智能，比如：
  - 书签管理插件动态添加每个书签为搜索指令
  - 项目管理插件把最近的项目动态注册为快速打开指令
  - SSH 管理插件把常用服务器注册为指令
- 建议在 Mulby 的 `mulby.commands` API 中增加 `register()` 和 `remove()` 方法

---

### 4. `window` 类型匹配指令 —— 感知当前活动窗口

**uTools 做法：**
- 在 `cmds` 中声明 `{ type: "window", match: { app: ["xxx.app"], title: "/xxx/" } }`
- 当用户当前活动窗口匹配规则时，该插件指令会出现在搜索结果中

**核心思路：** 上下文感知。插件可以根据用户当前正在使用的应用来决定是否出现。

**对 Mulby 的价值：** ⭐⭐⭐⭐
- 这是非常好的上下文感知能力
- 场景："窗口置顶"插件只在浏览器窗口激活时出现
- 场景：当检测到用户在 VSCode 中时，出现"在终端打开"指令
- Mulby 的 manifest `commands` 可以增加一种 `trigger: "window"` 类型

---

## 🟡 中价值 —— 可以借鉴

### 5. ubrowser —— 可编程自动化浏览器

**uTools 做法：**
- 提供内置的链式 API 浏览器自动化
- `.goto(url).input(selector, text).click(selector).screenshot().run()`
- 支持 cookie 管理、代理设置、iframe 操作
- 可以在隐藏模式下运行（headless）

**典型场景：** 网盘自动提取密码、快递查询、微信传文件

**对 Mulby 的价值：** ⭐⭐⭐
- 这是一个很酷的功能，但实现成本较高
- Mulby 可以考虑未来提供轻量级的浏览器自动化 API
- 或者先支持 `mulby.shell.openUrl(url)` + 外部脚本的方式
- 也可以考虑集成 Playwright 或类似工具作为可选能力

---

### 6. 本地数据库（db + dbStorage + dbCryptoStorage）

**uTools 做法：**
- **db** — NoSQL 文档数据库，支持 CRUD、批量操作、附件存储
- **dbStorage** — 类 LocalStorage 的简化 KV 存储
- **dbCryptoStorage** — 加密版 KV 存储
- **云端同步** — 用户开启后，数据可在多设备间秒级同步

**对 Mulby 的价值：** ⭐⭐⭐
- Mulby 目前提供了 `mulby.storage` KV 存储
- uTools 多提供了：
  - **附件存储**（文件/二进制数据）
  - **加密存储**（敏感数据如 token、密码）
  - **云端同步**（多设备）
- 加密存储可以优先考虑添加，因为插件存储 API Key 等敏感信息的需求很常见
- 云端同步是长期规划项

---

### 7. 模拟按键（Simulate）

**uTools 做法：**
- `simulateKeyboardTap(key, ...modifiers)` — 模拟键盘按键
- `simulateMouseMove(x, y)` — 模拟鼠标移动
- `simulateMouseClick(x, y)` — 模拟鼠标点击
- `simulateMouseDoubleClick(x, y)` — 模拟双击
- `simulateMouseRightClick(x, y)` — 模拟右键

**对 Mulby 的价值：** ⭐⭐⭐
- 系统级模拟输入是自动化工具的基础能力
- 与"向其他应用输入内容"配合使用效果更佳
- 安全风险需要考虑，建议需要用户授权

---

### 8. `utools.ai()` —— 统一 AI 调用 API

**uTools 做法：**
- 插件直接调用 `utools.ai({ messages, tools }, streamCallback)`
- 支持流式/非流式
- 支持 Function Calling
- 用户在 uTools 设置中统一配置 AI 模型，插件无需关心具体模型
- `utools.allAiModels()` 获取用户配置的所有 AI 模型

**对 Mulby 的价值：** ⭐⭐⭐
- Mulby 已经有 AI 能力，但目前的 API 实现情况需要确认
- 关键点是**统一管理**：用户只需在设置中配置一次 AI Provider，所有插件共用
- Function Calling 的支持让插件可以轻松让 AI 调用本地函数

---

### 9. `feature.mainPush` —— 主动推送到搜索框

**uTools 做法：**
- 当 `mainPush: true` 时，插件可以在用户打开搜索框时主动推送内容
- 类似于 Spotlight 的"建议"功能

**对 Mulby 的价值：** ⭐⭐⭐
- 可以让插件更主动，比如：
  - 天气插件推送今日天气
  - 日历插件推送下一个事件
  - 待办插件推送未完成项
- 需要控制推送频率，避免干扰用户

---

## 🟢 低价值 —— Mulby 已有或不太需要

### 10. `feature.mainHide` —— 隐藏主窗口执行

- 指令触发时不显示主搜索框，直接执行功能
- Mulby 通过全局快捷键 + 后台任务已经覆盖了这个场景

### 11. `pluginSetting.single` —— 单例模式

- 控制插件是否以单例模式运行
- Mulby 的 plugin host 管理机制已经处理了这个问题

### 12. Sharp / FFmpeg 内置 API

- uTools 内置了图像处理（Sharp）和视频处理（FFmpeg）
- Mulby 的插件可以通过 Node.js 原生调用这些工具，不需要平台内置
- 但 uTools 内置的好处是插件体积更小、部署更简单

### 13. 用户付费

- uTools 提供了内置的付费/订阅体系
- 这是商业化基础设施，Mulby 暂时可能不需要

---

## 总结优先级

| 优先级 | 特性 | 难度 | 价值 |
|--------|------|------|------|
| P0 | 向其他应用输入内容 (paste/type) | 中 | 非常高 |
| P0 | 插件为 AI Agent 提供能力 (MCP Tools) | 高 | 非常高 |
| P1 | 动态指令 (register/remove) | 中 | 高 |
| P1 | 窗口匹配指令 (window trigger) | 中 | 高 |
| P2 | 主动推送 (mainPush) | 低 | 中 |
| P2 | 加密存储 (cryptoStorage) | 低 | 中 |
| P3 | 模拟按键 | 中 | 中 |
| P3 | 可编程浏览器 (ubrowser) | 高 | 中 |
| P4 | 统一 AI API | 中 | 中 (已有基础) |
| P5 | 内置 Sharp/FFmpeg | 低 | 低 |
