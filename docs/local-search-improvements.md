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
