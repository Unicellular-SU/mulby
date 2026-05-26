# 剪贴板历史 API (clipboardHistory)
本文档描述 剪贴板历史 API (clipboardHistory) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.clipboardHistory`
> - 插件后端：`context.api.clipboardHistory`

插件必须在 `manifest.json` 中声明剪贴板权限：

```json
{
  "permissions": {
    "clipboard": true
  }
}
```

未声明时宿主会拦截调用并抛出 `Plugin "<pluginId>" lacks manifest.permissions.clipboard`。

## 功能概述

剪贴板历史管理器会自动记录所有剪贴板变化，并提供查询、收藏、删除等功能。

**特性：**
- 自动记录文本、图片、文件
- 持久化存储（SQLite）
- 支持搜索和过滤
- 收藏功能
- 自动清理旧记录（保留最近 1000 条）
- 使用 Native 剪贴板监听（零性能开销）
- 自动检测来源应用（Windows: `GetClipboardOwner`、macOS: `org.nspasteboard.source`、Linux: 活动窗口）

## API 方法

### query(options)
[Renderer] [Backend]
查询剪贴板历史记录。

```javascript
const items = await clipboardHistory.query({
  type: 'text',        // 可选：'text' | 'image' | 'files'
  search: 'hello',     // 可选：搜索文本内容
  favorite: true,      // 可选：只查询收藏的
  sourceApp: 'Chrome', // 可选：按来源应用过滤
  limit: 20,           // 可选：返回数量限制
  offset: 0            // 可选：分页偏移
});
```

**参数**:
- `options` (object) - 查询选项
  - `type` (string, 可选) - 过滤类型：`'text'` | `'image'` | `'files'`
  - `search` (string, 可选) - 搜索文本内容（仅对文本类型有效）
  - `favorite` (boolean, 可选) - 是否只查询收藏的记录
  - `sourceApp` (string, 可选) - 按来源应用名过滤
  - `limit` (number, 可选) - 返回数量限制
  - `offset` (number, 可选) - 分页偏移量

**返回值**: `Promise<ClipboardHistoryItem[]>` - 历史记录数组

```typescript
interface ClipboardHistoryItem {
  id: string;              // 唯一标识
  type: 'text' | 'image' | 'files';  // 类型
  content: string;         // 文本内容或 base64 图片
  plainText?: string;      // 纯文本（用于搜索）
  files?: string[];        // 文件路径列表
  timestamp: number;       // 时间戳
  size: number;            // 字节数
  favorite: boolean;       // 是否收藏
  tags?: string[];         // 标签
  sourceApp?: string;      // 来源应用名（如 "Chrome"、"Visual Studio Code"）
  sourceTitle?: string;    // 来源窗口标题
}
```

> **来源检测原理**：
> - Windows: 通过 `GetClipboardOwner()` Win32 API 直接获取写入剪贴板的进程
> - macOS: 优先读取 `org.nspasteboard.source` pasteboard type，回退到前台窗口
> - Linux: 基于当前活动窗口

### get(id)
[Renderer] [Backend]
获取单条历史记录。

```javascript
const item = await clipboardHistory.get('clip_1234567890_abc');
```

**参数**:
- `id` (string) - 记录 ID

**返回值**: `Promise<ClipboardHistoryItem | null>` - 历史记录或 null

### copy(id)
[Renderer] [Backend]
将历史记录复制到剪贴板。

```javascript
const result = await clipboardHistory.copy('clip_1234567890_abc');
if (result.success) {
  console.log('已复制到剪贴板');
}
```

**参数**:
- `id` (string) - 记录 ID

**返回值**: `Promise<{ success: boolean; error?: string }>` - 操作结果

### toggleFavorite(id)
[Renderer] [Backend]
切换收藏状态。

```javascript
await clipboardHistory.toggleFavorite('clip_1234567890_abc');
```

**参数**:
- `id` (string) - 记录 ID

**返回值**: `Promise<{ success: boolean }>` - 操作结果

### delete(id)
[Renderer] [Backend]
删除单条记录。

```javascript
await clipboardHistory.delete('clip_1234567890_abc');
```

**参数**:
- `id` (string) - 记录 ID

**返回值**: `Promise<{ success: boolean }>` - 操作结果

### clear()
[Renderer] [Backend]
清空所有历史记录（保留收藏的记录）。

```javascript
await clipboardHistory.clear();
```

**返回值**: `Promise<{ success: boolean }>` - 操作结果

### stats()
[Renderer] [Backend]
获取统计信息。

```javascript
const stats = await clipboardHistory.stats();
// 返回: { total: 150, text: 100, image: 30, files: 20, favorite: 10 }
```

**返回值**: `Promise<ClipboardHistoryStats>` - 统计信息

```typescript
interface ClipboardHistoryStats {
  total: number;      // 总记录数
  text: number;       // 文本记录数
  image: number;      // 图片记录数
  files: number;      // 文件记录数
  favorite: number;   // 收藏记录数
}
```

## 完整示例

### 示例 1：查询最近的文本记录

```javascript
module.exports = {
  async run(context) {
    const { clipboardHistory, notification } = context.api;

    // 查询最近 10 条文本记录
    const items = await clipboardHistory.query({
      type: 'text',
      limit: 10
    });

    if (items.length === 0) {
      await notification.show('暂无历史记录');
      return;
    }

    // 显示第一条记录
    const first = items[0];
    await notification.show(`最近复制: ${first.content.substring(0, 50)}...`);
  }
};
```

### 示例 2：搜索并复制

```javascript
module.exports = {
  async run(context) {
    const { clipboardHistory, notification } = context.api;

    // 搜索包含 "password" 的记录
    const items = await clipboardHistory.query({
      type: 'text',
      search: 'password',
      limit: 1
    });

    if (items.length > 0) {
      // 复制到剪贴板
      await clipboardHistory.copy(items[0].id);
      await notification.show('已复制到剪贴板');
    } else {
      await notification.show('未找到匹配记录');
    }
  }
};
```

### 示例 3：管理收藏

```javascript
module.exports = {
  async run(context) {
    const { clipboardHistory, notification } = context.api;

    // 获取所有收藏
    const favorites = await clipboardHistory.query({
      favorite: true
    });

    await notification.show(`你有 ${favorites.length} 条收藏`);

    // 切换第一条记录的收藏状态
    if (favorites.length > 0) {
      await clipboardHistory.toggleFavorite(favorites[0].id);
      await notification.show('已取消收藏');
    }
  }
};
```

### 示例 4：统计信息

```javascript
module.exports = {
  async run(context) {
    const { clipboardHistory, notification } = context.api;

    const stats = await clipboardHistory.stats();

    const message = `
      总记录: ${stats.total}
      文本: ${stats.text}
      图片: ${stats.image}
      文件: ${stats.files}
      收藏: ${stats.favorite}
    `;

    await notification.show(message);
  }
};
```

## 注意事项

1. **自动记录**：剪贴板历史会自动记录所有剪贴板变化，无需手动调用
2. **存储限制**：默认保留最近 1000 条记录（收藏的记录不受限制）
3. **图片大小**：图片最大 5MB，超过会被忽略
4. **敏感信息**：建议不要复制密码等敏感信息，或及时删除相关记录
5. **性能**：使用 Native 剪贴板监听，零性能开销
6. **持久化**：所有记录存储在 SQLite 数据库中，重启应用后仍然可用

## 数据库位置

剪贴板历史存储在应用数据目录的 SQLite 数据库中：
- macOS: `~/Library/Application Support/Mulby/data.db`
- Windows: `%APPDATA%/Mulby/data.db`
- Linux: `~/.config/Mulby/data.db`
