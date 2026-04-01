# 存储 API (storage)
本文档描述 存储 API (storage) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.storage`
> - 插件后端：`context.api.storage`

---

## 基础方法（V1）

### get(key[, namespace])
[Renderer] [Backend]
获取存储的数据。

```javascript
// 渲染进程
const value = await storage.get('myKey');
const pluginValue = await storage.get('myKey', 'myPlugin');

// 插件后端（同步）
const backendValue = context.api.storage.get('myKey');
```

**参数**:
- `key` (string) - 键名
- `namespace` (string, 可选，仅渲染进程) - 命名空间，默认 `global`

**返回值**:
- 渲染进程：`Promise<any>` - 存储的值，如果不存在返回 `undefined`
- 插件后端：`any` - 存储的值，如果不存在返回 `undefined`

### set(key, value[, namespace])
[Renderer] [Backend]
存储数据。

```javascript
// 渲染进程
await storage.set('myKey', { foo: 'bar' });
await storage.set('myKey', { foo: 'bar' }, 'myPlugin');

// 插件后端（同步）
context.api.storage.set('myKey', { foo: 'bar' });
```

**参数**:
- `key` (string) - 键名
- `value` (any) - 要存储的值（会自动序列化为 JSON）
- `namespace` (string, 可选，仅渲染进程) - 命名空间

**返回值**:
- 渲染进程：`Promise<boolean>` - 是否保存成功
- 插件后端：`void`

### remove(key[, namespace])
[Renderer] [Backend]
删除存储的数据。

```javascript
// 渲染进程
await storage.remove('myKey');

// 插件后端（同步）
context.api.storage.remove('myKey');
```

### clear()
[Backend]
清空插件后端存储（仅插件后端可用）。

```javascript
context.api.storage.clear();
```

### keys()
[Backend]
获取插件后端存储的所有键（仅插件后端可用）。

```javascript
const keys = context.api.storage.keys();
```

### has(key)
[Backend]
检查某个键是否存在。

```javascript
const exists = context.api.storage.has('myKey');
```

### getAll()
[Backend]
获取插件后端存储的所有键值对。

```javascript
const allData = context.api.storage.getAll();
```

### bulkSet(entries)
[Backend]
批量写入（无 CAS，适合简单初始化场景）。

```javascript
context.api.storage.bulkSet({ key1: 'val1', key2: 'val2' });
```

---

## 扩展方法（V2）

V2 方法在现有 `storage` 命名空间上直接扩展，支持分页遍历、批量操作、乐观并发控制（CAS）、原子事务和变更订阅。

### list(options?)
[Renderer] [Backend]
按前缀分页遍历键。适用于会话列表、消息分片、懒加载历史。

```typescript
// 插件后端（同步）
const result = context.api.storage.list({
  prefix: 'sessions/',
  limit: 20,
  order: 'desc'
});
// result: { items: [{ key, size, updatedAt, version }], nextCursor?: string }

// 翻页
const page2 = context.api.storage.list({
  prefix: 'sessions/',
  limit: 20,
  startsAfter: result.nextCursor
});

// 渲染进程（异步）
const result = await storage.list({ prefix: 'chat/', namespace: 'myPlugin' });
```

**参数** (`options`):
- `prefix` (string, 可选) - 键前缀过滤
- `startsAfter` (string, 可选) - 分页游标，从该键之后开始
- `limit` (number, 可选, 默认 50, 最大 500) - 每页条数
- `order` ('asc' | 'desc', 可选, 默认 'asc') - 排序方向
- `namespace` (string, 可选, 仅渲染进程) - 命名空间

**返回值**: `{ items: StorageListItem[], nextCursor?: string }`

### getMany(keys)
[Renderer] [Backend]
批量读取多个键。减少逐个读取的 I/O 开销。

```typescript
// 插件后端
const results = context.api.storage.getMany(['key1', 'key2', 'key3']);
// results: [{ key, found, value?, version?, updatedAt? }]

// 渲染进程
const results = await storage.getMany(['k1', 'k2'], { namespace: 'myPlugin' });
```

**返回值**: `StorageGetManyItem[]`

### setMany(items, options?)
[Renderer] [Backend]
批量写入，支持原子模式和 CAS。

```typescript
// 插件后端 - 原子模式（默认），任一 CAS 冲突则全部回滚
const result = context.api.storage.setMany([
  { key: 'user:1', value: { name: 'Alice' } },
  { key: 'user:2', value: { name: 'Bob' }, expectedVersion: 3 }
]);
// result: { success: boolean, results: [{ key, ok, version?, error? }] }

// 非原子模式 - 逐个执行，部分成功不回滚
const result = context.api.storage.setMany(items, { atomic: false });
```

**参数**:
- `items` - `{ key, value, expectedVersion? }[]`
  - `expectedVersion: null` → 仅在 key 不存在时插入
  - `expectedVersion: number` → CAS 校验，匹配才写入（不会重建已删除的 key）
  - `expectedVersion: undefined` → 无条件写入
- `options.atomic` (boolean, 默认 true) - 是否原子执行

### getMeta(key)
[Renderer] [Backend]
获取值 + 元数据（version、updatedAt）。

```typescript
const meta = context.api.storage.getMeta('myKey');
// meta: { found: true, value: {...}, version: 5, updatedAt: 1711929600000 }
// 或: { found: false }
```

### setWithVersion(key, value, expectedVersion?)
[Renderer] [Backend]
乐观并发控制（CAS）写入。

```typescript
// 先读 → 修改 → 按版本写回
const meta = context.api.storage.getMeta('counter');
const result = context.api.storage.setWithVersion(
  'counter',
  meta.value + 1,
  meta.version  // 仅当版本匹配时写入
);
if (!result.ok) {
  console.log('冲突！当前版本:', result.conflict.currentVersion);
}

// 仅在 key 不存在时创建（expectedVersion = null）
const r = context.api.storage.setWithVersion('new-key', { init: true }, null);
```

**CAS 语义**:
- `expectedVersion = null` → 仅 key 不存在时插入，已存在则冲突
- `expectedVersion = number` → 匹配才更新，不匹配则冲突（不会重建已删除 key）
- `expectedVersion = undefined` → 无条件写入（兼容 V1 行为）

### removeWithVersion(key, expectedVersion?)
[Renderer] [Backend]
CAS 删除。

```typescript
// 带版本校验的删除
const result = context.api.storage.removeWithVersion('myKey', 5);
// result: { ok: true } 或 { ok: false, error: 'E_CONFLICT' | 'E_NOT_FOUND' }

// 无条件删除
context.api.storage.removeWithVersion('myKey');
```

### transaction(ops)
[Renderer] [Backend]
原子事务，混合 set/remove 操作。全部成功或全部回滚。

```typescript
const result = context.api.storage.transaction([
  { op: 'set', key: 'index', value: newIndex, expectedVersion: 2 },
  { op: 'set', key: 'segment:3', value: newSegment },
  { op: 'remove', key: 'segment:old' }
]);
// result: { success: boolean, committed: number }
```

### append(key, chunk, options?)
[Renderer] [Backend]
向 JSON 数组追加元素，支持 `maxItems` 滚动窗口。适用于聊天消息增量写入。

```typescript
// 追加一条消息
const result = context.api.storage.append('chat:messages', { role: 'user', content: 'hello' });
// result: { ok: true, newLength: 42, version: 43 }

// 带滚动窗口 - 超过 maxItems 自动裁剪旧数据
context.api.storage.append('recent-logs', logEntry, { maxItems: 1000 });
```

### watch(options, callback) → unwatch
[Renderer only]
变更订阅。多窗口同步场景，其他窗口/后端写入数据时触发回调。

```typescript
const unwatch = storage.watch(
  { namespace: 'myPlugin', prefix: 'chat/' },
  (event) => {
    // event: { type: 'set'|'remove'|'clear', key, namespace, version?, updatedAt }
    console.log(`${event.type}: ${event.key} v${event.version}`);
  }
);

// 不再需要时取消订阅
unwatch();
```

**注意**:
- 同一窗口可注册多个 watcher，互不干扰
- webContents 销毁时自动清理关联的 watcher
- 仅渲染进程可用（后端不支持 watch）

---

## 备注

- 所有数据底层使用 SQLite 存储，支持事务和原子操作
- 插件后端方法为 **同步调用**，渲染进程方法为 **异步调用**（返回 Promise）
- V1 和 V2 方法完全向后兼容，可混合使用
- 每次写入操作自动维护 `version` 自增计数器
- `version` 从 1 开始，每次更新 +1

## 完整示例：聊天插件存储

```typescript
// 后端：使用分片 + 索引模式
const { storage } = context.api;

// 创建会话索引
storage.set('session:index', {
  sessions: [{ id: 's1', title: '新对话', createdAt: Date.now() }]
});

// 追加消息到分片
storage.append('session:s1:messages', { role: 'user', content: 'hello' }, { maxItems: 500 });

// 分页读消息
const { items } = storage.list({ prefix: 'session:s1:messages' });

// CAS 更新索引（防止并发覆盖）
const meta = storage.getMeta('session:index');
const result = storage.setWithVersion('session:index', updatedIndex, meta.version);
if (!result.ok) {
  // 处理冲突：重新读取后重试
}
```