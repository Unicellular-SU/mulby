# Mulby Super Panel 演进设计方案 (Evolution Design)

## 1. 演进背景与目标

当前 `super-panel` 的“选中内容 -> 静默复制 -> 匹配插件 -> 弹出执行”主链路已经成型，但功能更偏向于“文本推荐浮窗”。为了向更成熟的全局效率入口（如 uTools / Raycast）演进，基于架构评审意见，我们需要在三个维度对 Super Panel 进行系统性的重构与升级：

- **可靠性与隐私安全**：隔离对全局剪贴板历史的污染、增加权限可视化。
- **多数据源支持**：打破纯文本限制，引入对文件和图片指令的全面支持。
- **场景感知与动作流**：支持按当前应用环境展示不同推荐，并将 UI 从单点执行升级为支持二级菜单的“动作面板”。

---

## 2. 核心架构升级细节

### 2.1 Phase 1. 安全底座与数据源扩展

这是最紧急的基础建设，解决潜在的密码泄漏问题和能力死角。

#### A. 剪贴板历史污染防范 (Clipboard History Protection)
在目前工作流中，调用 `nativeSimulateCopy` 发送 `Cmd+C` 会真正改变操作系统的剪贴板，这会被 `ClipboardWatcher` 捕获并落库（如密码等不可见内容）。
- **重构方案**：
  为 `ClipboardHistoryManager` 增加 `pause()` 和 `resume()` 接口。在 `SuperPanelManager` 触发工作流前调用 `pause()`，忽略这 100~300ms 间的剪贴板变动事件，在 `restoreClipboard()` 处理完成后再调用 `resume()`。

#### B. 支持文件与图片输入类型 (Support Files & Images)
目前 `matchContent()` 只传递 `text`。
- **重构方案**：
  1. 将 `ClipboardHistoryManager.readFiles()` 逻辑抽离为公共的 `ClipboardHelper`。
  2. 在静默取词阶段，除了读取 `text`，同步调用 `readImage()` 和 `readFiles()`。
  3. 将非文本内容包装入 `InputAttachment[]`，使得 `matchType: 'img' | 'files'` 的插件特性也能进入匹配链路，最后统一传递给插件。

#### C. 超级面板控制面板与权限诊断 (Diagnostics Dashboard)
- **重构方案**：
  在渲染进程 `SuperPanelSection.tsx` 增加独立的“环境检测面板”，通过 IPC 给主进程请求：辅助功能权限状态（macOS `systemPreferences.isTrustedAccessibilityClient`），输入钩子挂载状态检查等。

### 2.2 Phase 2. 上下文感知与面板管理重构

改变当前不论在哪个软件中唤起都展示相同偏好列表的状况。

#### A. 上下文感知推荐系统 (Context-Aware Recommendation)
- **重构方案**：
  在触发阶段捕获 `getCachedActiveWindow()`（包含 `app` 和 `bundleId`）。
  扩展 `SuperPanelItem` 结构，并在 `findBestMatch` 或后续排序中，对匹配了 `activeWindow.app` 的指令给予加权，使得例如“在 VSCode 显示代码工具”、“在浏览器显示翻译/总结”成为可能。

#### B. Pinned 面板数据结构升级
- **重构方案**：
  升级 `super-panel-store.ts`，将扁平的 `pinnedItems` 变更为支持分页/目录/顺序属性的数据模型 `SuperPanelLayout`，满足纯快捷唤起时的软件导航盘需求。

#### C. 引入二级操作菜单 (Action Panel)
- **重构方案**：
  当前的触发是“点击即执行”。修改渲染层，提供类似 Raycast 的 Cmd+K / 右键触发展开“快捷侧边栏”，提供：执行、固定、分配快捷键、复制参数、禁用此推荐 等辅助操作。

### 2.3 Phase 3. 搜索底座融合与 AI 泛化

#### A. 彻底接入 DesktopSearchScorer
废弃目前简单的 `super-panel-manager.ts:448` 的排序，将拼音、缩写等逻辑与主搜索算法看齐。

#### B. 泛化 AI 动作引擎
将目前硬编码的单兵突进式“即时翻译 (`requestTranslation`) ”抽象化。利用 `aiService` 的系统提示词配置能力，允许把“概括提炼”、“解释代码”、“转换为 JSON”登记为固定操作入口动作，且使用相同的无缝流式下发 UI。

---

## 3. 分期实施计划 (Implementation Plan)

- ✅ **Step 1 (Phase 1 已完成)**：剪贴板安全底座 + 多数据源扩展
  - `src/main/utils/clipboard-helper.ts` — [NEW] 提取跨平台剪贴板工具函数
  - `src/main/services/clipboard-history.ts` — 添加 `pause()`/`resume()` 接口 + 复用 clipboard-helper
  - `src/main/services/super-panel-manager.ts` — 注入 ClipboardHistoryManager + 文件/图片附件解析
  - `src/main/index.ts` — 更新构造函数传参
- **Step 2 (待开始)**：更新 IPC 接口与 UI，完成诊断信息的联调，解决最迫切的用户接入困扰。
- **Step 3 (待开始)**：开启 **Phase 2**，实现上下文（Active Window）的加权与插件管理体验重构。

_（本文档将随着超级面板的开发进度持续迭代）_

---

## 下方是 codex 建议改进的内容原文：

我看完本地实现和同类产品后，判断是：当前 super-panel 的“选中内容 → 静默复制 → 匹配插件 → 弹出执行”主链路已经成型，但还更像一个“文本插件推荐浮窗”，距离 uTools / Quicker / PopClip / Raycast 这类成熟入口的差距主要在多数据源、面板组织、生态联动和可靠性上。

**本地依据**：  
核心链路在 `src/main/services/super-panel-manager.ts:251`，窗口是独立 BrowserWindow，高度固定上限在 `src/main/services/super-panel-window.ts:77`，固定项只保存扁平数组和文本偏好在 `src/main/services/super-panel-store.ts:54`，前端是独立 vanilla JS 在 `public/super-panel.js:1`。设置页已经支持鼠标、键盘、双击修饰键等触发方式，见 `src/renderer/components/settings/sections/SuperPanelSection.tsx:70`。

### 优先改进项

1. **补齐文件、图片、文件夹输入**  
   这是最大缺口。uTools 超级面板明确支持选中文本、图片、文件、文件夹后匹配对应功能，并对英文、时间戳给顶部结果提示；当前 Mulby 的 `matchContent()` 只传 text，`attachments` 固定是空数组，所以 `files` / `img` 类型理论上存在于匹配器里，但 super-panel 实际用不上，见 `src/main/services/super-panel-manager.ts:407`。  
   建议先复用现有 `clipboard.readFiles()` / `readImage()` 能力，把静默复制后的剪贴板解析成 `InputAttachment[]`，让 `files`、`img`、`over`、`regex`、`window` 都进入同一条推荐链路。这个优先级应高于继续美化 UI。

2. **把固定列表从“收藏数组”升级成“可管理桌面”**  
   uTools 的超级面板支持拖拽排序、合并文件夹、移除、重命名、加号添加功能指令；Quicker 则有全局面板区、上下文面板区、翻页和外观自定义。当前 Mulby 的固定列表只是 `pinnedItems[]`，没有排序编辑、文件夹、分页、每应用配置，见 `src/main/services/super-panel-store.ts:59`。  
   建议新增 `groups` / `pages` / `order` / `context` 存储结构：全局固定项、按应用固定项、文件夹、拖拽排序、右键编辑。这样 super-panel 才能在“未选中文本”时成为真正的常用工具入口，而不是空面板或简单列表。

3. **做上下文面板，而不只是黑名单**  
   现在只有 `blockedApps`，且是精确匹配 `app` / `bundleId`，见 `src/main/services/super-panel-manager.ts:483`。Quicker 的思路更强：同一个面板根据当前软件加载不同动作；Listary 也强调按习惯智能排序。  
   建议增加：当前应用专属固定项、当前窗口标题规则、应用级触发策略、应用级默认动作。例如浏览器里优先翻译 / 总结 / 网页快开，IDE 里优先格式化 / 解释代码 / 打开项目，Finder / Explorer 里优先文件处理。

4. **和 Mulby 主搜索、插件商店、桌面搜索打通**  
   Raycast、Alfred、Flow Launcher 的共同点是“一个入口能搜应用、文件、系统命令、剪贴板、网页、插件命令”。Mulby 已经有 `DesktopSearchService`、插件搜索、剪贴板历史、命令快捷键、插件商店，但 super-panel 现在只扫已安装插件的匹配指令。  
   建议当匹配结果不足时显示：应用、文件、最近剪贴板、网页快搜、系统命令、插件商店推荐。uTools 2025-06-25 更新里已经加入“根据粘贴文本、文件推荐未安装插件并一键安装”的方向，这一点很值得跟进。

5. **AI 不应只有“即时翻译”**  
   当前即时翻译实现已经比较谨慎：限制长度、关闭工具 / 技能 / MCP、异步推送，见 `src/main/services/super-panel-manager.ts:700`。但 Raycast 已经把 AI 做成系统级快捷动作，PopClip 也靠扩展库覆盖大量文本处理动作。  
   建议把 AI 动作变成可配置的顶部动作区：翻译、总结、改写、解释、提取表格、生成回复、代码解释。每个动作都应能设模型、目标语言、是否流式、是否复制结果、是否直接粘贴回前台应用。

6. **权限和可靠性需要可见化**  
   Raycast 的 Quick Search 明确提示需要辅助功能权限；Mulby 现在主要是在设置里做说明，但 super-panel 依赖全局输入钩子、模拟复制、剪贴板、macOS 辅助功能权限、Linux `xdotool` / `libxdo` 等，失败时用户不一定知道为什么。  
   建议新增“超级面板诊断”：辅助功能权限、输入钩子状态、模拟复制测试、剪贴板恢复测试、当前前台应用识别、触发冲突检测、Linux 依赖检测。失败时在设置页直接给“打开系统设置 / 重试 / 查看日志”。

7. **避免污染剪贴板历史和敏感内容**  
   当前流程会模拟复制，再恢复剪贴板。问题是项目里还有全局剪贴板历史服务，super-panel 的临时复制内容可能被记录下来，尤其是密码、token、私密文本。  
   建议给剪贴板历史加一个“静默捕获抑制窗口”：super-panel 触发前通知 clipboard watcher 暂停采样，恢复后再继续。还应支持敏感应用默认屏蔽，比如密码管理器、银行、远程桌面、浏览器隐私窗口、终端 sudo 输入场景。

8. **排序和二次搜索要复用主搜索能力**  
   当前排序是匹配分 + 最近使用次数 + 对“同一段文本”的 hash 偏好，二次搜索只是简单 `includes()`，见 `src/main/services/super-panel-manager.ts:448` 和 `src/main/services/super-panel-manager.ts:674`。项目里主搜索已经有拼音、模糊匹配、习惯排序等基础，不应在 super-panel 里另起一套弱搜索。  
   建议统一 scorer：拼音 / 缩写 / 模糊、上下文权重、固定项权重、最近使用衰减、用户纠偏、插件质量权重，并在 UI 上展示“为什么推荐”。

9. **面板交互需要从列表升级成动作面板**  
   Alfred 有 Actions，Raycast 有 Action Panel，Listary 对搜索结果有 copy path 等动作。Mulby 当前点击就是执行，右键只有固定 / 取消固定。  
   建议每个结果支持二级动作：执行、复制结果、复制参数、固定、设置快捷键、查看插件、禁用此推荐、以后对类似文本优先使用。键盘上可以用 Tab 或 Cmd / Ctrl + K 打开动作面板。

10. **补测试和性能观测**  
    文档里仍写着“用户需手动测试完整功能流”，见 `docs/super-panel-progress.md:25`。这个功能涉及全局输入、剪贴板、窗口焦点、插件执行，回归风险很高。  
    建议至少补：`SuperPanelStore` 单测、匹配输入构造测试、剪贴板恢复测试、黑名单匹配测试、翻译请求取消测试、窗口高度计算测试；再加一个手动 / Playwright 冒烟脚本验证面板显示、键盘导航、复制翻译、关闭恢复剪贴板。

### 参考的同类产品要点

- **uTools 超级面板**强调鼠标触发、常用应用 / 文件 / 网址启动、选中文本 / 图片 / 文件 / 文件夹智能匹配、翻译和时间戳顶部结果、语音交互；这些都比当前 Mulby 更完整。来源：uTools 帮助中心《超级面板，轻点鼠标完成工作》https://www.u-tools.cn/docs/guide/uTools-super-panel.html  
- **PopClip**的核心是“选中文本即弹出动作”，并靠扩展库覆盖复制、搜索、分享、翻译等场景。来源：https://www.popclip.app/  
- **Quicker**的优势是面板组织和场景化：全局区、上下文区、多触发方式、翻页、外观、动作库和自动化。来源：https://getquicker.net/  
- **Raycast**的优势是可扩展启动器、Quicklinks、选中文本 Quick Search、权限提示、剪贴板 / 文件 / 窗口 / 系统 / AI 等核心扩展。来源：https://www.raycast.com/core-features/quicklinks 和  
- **Alfred**的优势是结果动作、剪贴板历史、片段、文件 / Web / System / Shell 能力，以及工作流编辑体系。来源：https://www.alfredapp.com/help/overview/ 和 https://www.alfredapp.com/help/workflows/  
- **Listary / Flow Launcher**的启发是文件 / 应用搜索性能、习惯排序、系统命令、插件商店和 Everything / Windows Search 集成。来源：https://www.listary.com/ 和 https://www.flowlauncher.com/

### 建议路线

我的建议路线是：**先做多数据源捕获 + 剪贴板历史抑制 + 权限诊断**，把可靠性和安全底座补上；**第二阶段做可管理固定面板 + 上下文面板**；**第三阶段再做 AI 动作、插件商店推荐、统一搜索入口**。这样改动顺序最贴合当前项目结构，也最容易把 super-panel 从“能用”推进到“每天会用”。