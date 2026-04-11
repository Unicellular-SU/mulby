# 搜索性能深度优化 v2

## 完成时间
2026-03-22

## 问题
插件搜索匹配延迟 1-2s（尤其 Windows），远未达到 uTools 毫秒级响应。

## 参考项目
- **Rubick**：渲染进程内存匹配、图标预提取到磁盘
- **ReFast**：AppInfo 预缓存 pinyin、app_cache.json 持久化、MAX_SEARCH_RESULTS=20

## 核心发现
两个项目共同的设计理念是 **零搜索时 I/O** —— 搜索只做纯内存字符串匹配。
Mulby 的瓶颈在搜索热路径中有 3 个阻塞性 I/O：`getActiveWindow`、`resolveIcon`、`pinyin-pro` 冷启动。

## 实施的 6 项优化

| 优化 | 修改文件 | 预期节省 |
|------|----------|----------|
| P0-1: 渲染器 80ms debounce | `PluginList.tsx` | 减少 60-80% 搜索请求 |
| P0-2: getActiveWindow 事件驱动缓存 | `active-window.ts`, `manager.ts`, `index.ts` | 50-500ms/次 |
| P0-3: 图标预缓存 | `ipc/plugin.ts` | 20-100ms/次 |
| P1-1: pinyin Worker 预热 | `search-worker.ts` | 50-200ms（首次） |
| P1-2: superseded 错误处理 | `manager.ts` | 减少无效回退 |
| P2: 过时请求取消 | `search-worker-manager.ts` | 减少无效计算 |

## 验证
- TypeScript 类型检查：通过
- 单元测试：194/194 通过
