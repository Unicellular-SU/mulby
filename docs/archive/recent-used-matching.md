# 最近使用匹配逻辑改造记录

## 完成时间
2026-04-13

## 改造背景
原始逻辑仅按 `lastUsedAt` 纯时间倒序排列"最近使用"列表，忽略了 `useCount`（频次），
且有搜索词时不对 recent 区做相关性重排，导致匹配度体感极差。

## 核心改动

### 算法：Frecency Score（频次 × 时间衰减）
参考 Mozilla Firefox 书签算法 + Alfred Frecency 模型：
- 今天用 1 次 → 1.0
- 7天内用 10 次 → 9.0（优先于单次今日使用）
- 衰减档：1天/7天/14天/31天/90天

### 查询感知重排
有搜索词时，recent 区按 `frecency + 查询相关性` 综合排序，而非直接 filter+时间序：
- 精确匹配 +200，前缀匹配 +120，包含 +60
- 完全不相关：× 0.05 降权推到末尾（不剔除，避免区域为空）

### best 区加权升级
从 `recentIndex` 位置加成（最大 +70）改为 frecency 加权（最大 +200）

## 修改文件
1. `src/shared/types/electron.d.ts`：SearchResultItem 加 `lastUsedAt?`/`useCount?` 字段
2. `src/main/ipc/plugin.ts`：`getRecentUsed` handler 附加频次元数据
3. `src/renderer/components/PluginList.tsx`：核心算法替换
   - 新增 `computeFrecency()`、`getRecentItemScore()` 函数
   - `recentOrderMap` → `frecencyMap`
   - `recentDisplayItems` 改为 frecency+查询感知综合排序
   - `getSearchScore` 的 recent 加分改用 frecency

## 向后兼容
- 旧数据没有 `lastUsedAt`/`useCount` 字段时，fallback 到 `Date.now()`/`1`（保守值）
- 不破坏任何现有接口
