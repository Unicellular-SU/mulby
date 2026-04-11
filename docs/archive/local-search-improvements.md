# 本地搜索引擎改进进展

## 完成日期
2026-04-02

## 改进项

### ✅ 已完成

1. **搜索页 Snippet 提取** — 从搜索引擎结果页直接提取摘要描述
   - Bing: `.b_caption p, .b_caption .b_algoSlug`
   - Google: `[data-sncf] span, .VwiC3b`

2. **搜索后正文获取** — BrowserWindow + cheerio 启发式提取
   - 3 并发，单页 ≤15s，默认截断 2000 字符
   - 移除 script/style/nav 等噪声标签，优先取 article/main 语义容器

3. **搜索结果去重** — 基于 origin + pathname 的 URL 去重

4. **域名黑名单** — 可配置 `resultDenyHosts`，统一适用于所有 Provider

5. **web_fetch 本地降级** — Jina Reader 失败后自动降级到 BrowserWindow 获取

6. **语言过滤** — 本地搜索自动追加 `lang:xx` 过滤

### 🔧 关键文件

| 文件 | 改动 |
|---|---|
| `src/shared/types/settings.ts` | 新增 snippetSelector/fetchContent/maxContentPerResult/resultDenyHosts 类型 |
| `src/main/services/app-settings.ts` | 默认引擎 snippetSelector 配置 + 归一化 |
| `src/main/ai/tools/web-search-service.ts` | 接口扩展 + 黑名单 + 正文获取 + Jina 降级 |
| `src/main/services/search-window-service.ts` | 核心重写：snippet/去重/语言/正文提取 |
| `src/main/ai/tools/internal-tool-runtime.ts` | 正文输出截断从 500→2000 |

### 📝 前序修复（本次会话早期）

- Session 隔离：每次搜索用独立 partition + `cache: false`
- Bing 选择器修正：`#b_results h2` → `#b_results li.b_algo`

### 🔧 搜索质量修复（2026-04-09）

1. **移除 `ensearch=1`** — 该参数强制英文搜索，导致中文查询结果严重偏差
2. **移除 `lang:xx` 查询追加** — Bing 不支持该语法，追加后反而污染搜索词
3. **更新 Chrome UA 版本** — 120 → 131，避免过旧 UA 被目标网站降级
4. **添加搜索调试日志** — `[SearchWindow]` / `[WebSearch]` 日志覆盖搜索全流程
5. **选择器失效诊断** — 0 结果时输出 HTML 片段，方便后续排查
6. **SSRF 防护** — `fetchContentsForResults` 新增 `isPrivateUrl()` 检查，阻止搜索结果 URL 指向内网地址
7. **修复假成功** — Jina 降级到本地获取后，空内容不再误报 `success: true`

### 🚀 添加 DuckDuckGo 搜索引擎（2026-04-09）

**背景**：Bing 对中文搜索质量差，AI 多次重试仍无法获取相关结果。

1. **新增 DuckDuckGo（local-ddg）** — 使用 `html.duckduckgo.com` 静态 HTML 版
2. **快速路径** — DuckDuckGo 不走 BrowserWindow，直接 `net.fetch` + cheerio，更快且不占渲染进程
3. **DDG URL 解码器** — 处理 `//duckduckgo.com/l/?uddg=...` 重定向链接
4. **设为默认** — `activeProvider` 默认值改为 `local-ddg`，Bing/Google 保留为备选

### 🐛 修复 Bing 搜索无结果（2026-04-09）

**根因**：对比 Cherry Studio 发现，Mulby 每次搜索都新建随机 partition（`cache: false`），Bing 面对无 Cookie 的全新浏览器会返回同意页/CAPTCHA，导致选择器匹配不到结果。

**修复**：改用固定 `persist:search` partition，Cookie 在搜索间持久化，与 Cherry Studio 行为一致。

### 🏗️ Provider 架构拆分（2026-04-09）

将 `web-search-service.ts`（780 行）拆分为 Provider 模块：

```
src/main/ai/tools/web-search/
├── index.ts                 — 统一导出
├── types.ts                 — 共享类型
├── http.ts                  — HTTP 辅助 + SSRF 检查
├── providers/
│   ├── jina-provider.ts     — Jina Search + Reader
│   ├── tavily-provider.ts   — Tavily Search
│   └── custom-provider.ts   — 自定义 API
└── web-search-service.ts    — 精简调度器
```

### 🧠 Parser Worker 架构重构（2026-04-09）

**问题**：原实现在主进程（Node.js）中使用 Cheerio 进行 DOM 解析，阻塞主线程且无法使用高质量前端提取库。

**方案**：引入 **Parser Worker** 机制 — 创建一个持久化的隐藏 BrowserWindow，通过 preload 脚本暴露前端原生解析能力：

1. **`@mozilla/readability`**：Firefox 阅读模式核心引擎，精准剥离广告/侧边栏/导航
2. **`turndown`**：将干净 HTML 转为 Markdown，完美匹配大模型输入格式
3. **浏览器原生 `DOMParser`**：替代 Cheerio，解析搜索引擎结果页

**数据流**：
```
AI Tool → WebSearchService → SearchWindowService
  ├─ fetchRenderedHtml (BrowserWindow 加载搜索页)
  ├─ fetchStaticHtml   (net.fetch 轻量获取)
  └─ 委派 Parser Worker (隐藏 Renderer) 执行解析
       ├─ parseSearchResults → DOMParser + querySelectorAll
       └─ extractContent     → Readability + Turndown → Markdown
```

**关键文件**：
- `src/preload/web-parser.ts` — Parser Worker preload，暴露 `window.webParser` API
- `src/main/services/search-window-service.ts` — 重构后的服务，零 Cheerio
- `vite.config.ts` — 新增 web-parser preload entry

**依赖变更**：
- ✅ 新增：`@mozilla/readability`、`turndown`、`@types/turndown`
- ❌ 移除：`cheerio`（21 个包）

### 🔧 Bing 搜索反爬限制修复（2026-04-09）

**问题**：在使用 Electron 发起 Bing 搜索时，无论搜索什么中文词汇，返回的 10 个自然搜索结果全部为 `zhihu.com`。

**根因**：Bing （`www.bing.com` 和 `cn.bing.com`）利用反爬规则判断当前查询来自非支持的脚本或客户端环境（如 `Electron` 隐藏 BrowserWindow 默认特性）。它会采取降级处理，将结果硬性替换为某种低质量的「知乎回答」结构化聚合聚合或特定站内结果，而不是真正的 Web 有机索引。

**修复**：
1. 经过对比 Cherry Studio 的源代码实现（`cs/src/renderer/src/config/webSearchProviders.ts`），确认需要更新 `app-settings.ts` 使用 `https://cn.bing.com/search?q=%s&ensearch=1` 规避 URL 重定向与降级限制。`ensearch=1` 可以绕过纯国内 IP 强制问答聚合的 Trap。
2. 彻底伪装 Chromium Client Hints，补全了 `SearchWindowService` 中 `loadURL` 的 `extraHeaders`：
   - 增加全套的 `Sec-Ch-Ua`、`Sec-Ch-Ua-Mobile`、`Sec-Ch-Ua-Platform` 模拟完整桌面版 Chrome 131。
   - 加上 `Accept-Language: zh-CN,zh;q=0.9,en;q=0.8`。
3. 这些修改结合 `ensearch=1` 恢复了输出多元化的搜索结果。

### 排查三：中文检索结果充斥“百度经验”等低价值内容的终极处理

**问题**：修复完上一阶段后，通过用户反馈发现，诸如“电脑没声音怎么办”这类中文问题检索仍全篇返回 `jingyan.baidu.com` 和 `zhidao.baidu.com` 等百度系聚合网站。

**根因**：这非程序错误，而是 Bing 国际版（`ensearch=1`）及国内版算法的自身调度行为（Bing 此类词汇原生倾向百度相关链接）。在此情境下强加 `ensearch=1` 会让包含过多英文编码且对国内 SEO 支持较差的连接干扰最终查询。

**修复**：
1. **彻底废除 `ensearch=1` 注入**：移除所有 `web-search-service` 中对其的拦截，及 `app-settings.ts` 中基于 `ensearch=1` 的保底，恢复原生的 `https://cn.bing.com/search?q=%s` 以贴合最优中文索引。
2. **构建极致防御欺骗**：摒弃通用 Chrome 签名，将 `SearchWindowService` 的请求头换成几乎一模一样的现代 Edge 特征。写入了涵盖 `Sec-Fetch-Dest`、`Sec-Fetch-Mode` 等多达 9 项防抓取检测绕过，在不用 `ensearch` 的情况下完美防患“纯知乎”霸榜。
3. **发现问题**：由于取消了 `ensearch`，对于“电脑没声音”类的问题，Bing 原生算法会排布前置大量的百度经验或知乎（因为检索相关性判定）。这并非程序或抓取错误，用户若不想看到可自行在黑名单配置，应用框架层不可贸然全局屏蔽。
