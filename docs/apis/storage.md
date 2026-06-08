# 存储 API (storage)
本文档描述 存储 API (storage) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.storage`
> - 插件后端：`context.api.storage`

### get(key[, namespace])
[Renderer] [Backend]
获取存储的数据。

```javascript
// 渲染进程
const value = await storage.get('myKey');
const pluginValue = await storage.get('myKey', 'myPlugin');

// 插件后端（异步）
const backendValue = await context.api.storage.get('myKey');
```

**参数**:
- `key` (string) - 键名
- `namespace` (string, 可选，仅渲染进程) - 命名空间，默认 `global`

**返回值**:
- 渲染进程：`Promise<any>` - 存储的值，如果不存在返回 `undefined`
- 插件后端：`Promise<any>` - 存储的值，如果不存在返回 `undefined`

### set(key, value[, namespace])
[Renderer] [Backend]
存储数据。

```javascript
// 渲染进程
await storage.set('myKey', { foo: 'bar' });
await storage.set('myKey', { foo: 'bar' }, 'myPlugin');

// 插件后端（异步）
await context.api.storage.set('myKey', { foo: 'bar' });
```

**参数**:
- `key` (string) - 键名
- `value` (any) - 要存储的值（会自动序列化为 JSON）
- `namespace` (string, 可选，仅渲染进程) - 命名空间

**返回值**:
- 渲染进程：`Promise<boolean>` - 是否保存成功
- 插件后端：`Promise<void>`

### remove(key[, namespace])
[Renderer] [Backend]
删除存储的数据。

```javascript
// 渲染进程
await storage.remove('myKey');
await storage.remove('myKey', 'myPlugin');

// 插件后端（异步）
await context.api.storage.remove('myKey');
```

**参数**:
- `key` (string) - 键名
- `namespace` (string, 可选，仅渲染进程) - 命名空间

**返回值**:
- 渲染进程：`Promise<boolean>` - 是否删除成功
- 插件后端：`Promise<void>`

### clear()
[Backend]
清空插件后端存储（仅插件后端可用）。

```javascript
await context.api.storage.clear();
```

### keys()
[Backend]
获取插件后端存储的所有键（仅插件后端可用）。

```javascript
const keys = await context.api.storage.keys();
```

### has(key)
[Backend]
检查键是否存在（仅插件后端可用）。

```javascript
const exists = await context.api.storage.has('myKey'); // true / false
```

### getAll([namespace])
[Renderer] [Backend]
获取命名空间下的全部键值。

```javascript
// 渲染进程（可选 namespace）
const all = await storage.getAll();
// 插件后端（固定当前插件 namespace）
const backendAll = await context.api.storage.getAll();
```

**返回值**: `Promise<Record<string, unknown>>`

### getAllWithMeta(namespace)
[Renderer]
获取命名空间下全部键值及其元数据（version/updatedAt 等）。

```javascript
const withMeta = await storage.getAllWithMeta('myPlugin');
```

### listNamespaces()
[Renderer]
列出当前可见的全部命名空间。

```javascript
const namespaces = await storage.listNamespaces();
```

### bulkSet(entries)
[Backend]
批量写入键值（仅插件后端可用）。

```javascript
await context.api.storage.bulkSet({ a: 1, b: 2, c: 3 });
```

**参数**:
- `entries` (`Record<string, unknown>`) - 键值映射

---

## V2 方法（分页 / 版本化 / 事务 / 监听）

> 入口：
> - 渲染进程：`window.mulby.storage`（options 可带 `namespace`）
> - 插件后端：`context.api.storage`（强制当前插件 namespace，options 不含 `namespace`）

### list([options])
[Renderer] [Backend]
按前缀分页列出键（不返回 value，仅返回 key + 元数据）。

```javascript
const { items, nextCursor } = await storage.list({ prefix: 'user:', limit: 50, order: 'asc' });
// items: [{ key, size, updatedAt, version }]
```

**参数** (options，可选):
- `prefix` (string) - 键前缀过滤
- `startsAfter` (string) - 游标，从该键之后开始
- `limit` (number) - 单页数量
- `order` (`'asc' | 'desc'`) - 排序
- `namespace` (string，仅渲染进程) - 命名空间

**返回值**: `Promise<{ items: { key: string; size: number; updatedAt: number; version: number }[]; nextCursor?: string }>`

### getMany(keys[, options])
[Renderer] [Backend]
批量读取多个键。

```javascript
const results = await storage.getMany(['a', 'b', 'c']);
// [{ key, found, value?, version?, updatedAt? }]
```

**返回值**: `Promise<{ key: string; found: boolean; value?: unknown; version?: number; updatedAt?: number }[]>`

### setMany(items[, options])
[Renderer] [Backend]
批量写入多个键，可选原子提交。

```javascript
const res = await storage.setMany([
  { key: 'a', value: 1 },
  { key: 'b', value: 2, expectedVersion: 3 }
], { atomic: true });
// { success, results: [{ key, ok, version?, error? }] }
```

**参数**:
- `items` (`{ key: string; value: unknown; expectedVersion?: number | null }[]`)
- `options` (可选) - `{ atomic?: boolean; namespace?: string }`（`namespace` 仅渲染进程）

**返回值**: `Promise<{ success: boolean; results: { key: string; ok: boolean; version?: number; error?: string }[] }>`

### getMeta(key[, options])
[Renderer] [Backend]
读取单个键的值与元数据（含 version）。

```javascript
const meta = await storage.getMeta('myKey');
// { found, value?, version?, updatedAt? }
```

**返回值**: `Promise<{ found: boolean; value?: unknown; version?: number; updatedAt?: number }>`

### setWithVersion(key, value[, options])
[Renderer] [Backend]
带乐观锁的写入：仅当当前 version 与 `expectedVersion` 一致时才写入，否则返回冲突。

```javascript
// 渲染进程：options 形式
const r = await storage.setWithVersion('myKey', newValue, { expectedVersion: 2 });
// 插件后端：第三参为 expectedVersion
const rb = await context.api.storage.setWithVersion('myKey', newValue, 2);
// { ok, version?, conflict?: { currentVersion } }
```

**返回值**: `Promise<{ ok: boolean; version?: number; conflict?: { currentVersion: number } }>`

### removeWithVersion(key[, options])
[Renderer] [Backend]
带乐观锁的删除。

```javascript
const r = await storage.removeWithVersion('myKey', { expectedVersion: 5 });
// 插件后端：await context.api.storage.removeWithVersion('myKey', 5)
```

**返回值**: `Promise<{ ok: boolean; error?: string }>`

### transaction(ops[, options])
[Renderer] [Backend]
在单次事务中执行多个 set/remove 操作，支持按 `expectedVersion` 校验。

```javascript
const r = await storage.transaction([
  { op: 'set', key: 'a', value: 1 },
  { op: 'remove', key: 'b', expectedVersion: 4 }
]);
// { success, committed }
```

**参数**:
- `ops` (`{ op: 'set' | 'remove'; key: string; value?: unknown; expectedVersion?: number | null }[]`)

**返回值**: `Promise<{ success: boolean; committed: number }>`

### append(key, chunk[, options])
[Renderer] [Backend]
向数组型键追加元素（不存在则新建数组），可用 `maxItems` 限制长度。

```javascript
const r = await storage.append('logs', { ts: Date.now(), msg: 'hi' }, { maxItems: 100 });
// { ok, newLength, version }
```

**返回值**: `Promise<{ ok: boolean; newLength: number; version: number }>`

### watch(options, callback)
[Renderer]
监听键变更（set/remove/clear），返回取消监听函数。

```javascript
const unwatch = storage.watch({ prefix: 'user:' }, (event) => {
  // event: { type: 'set' | 'remove' | 'clear', key, namespace, version?, updatedAt }
  console.log('changed:', event.type, event.key);
});

// 取消监听
unwatch();
```

**参数**:
- `options` (`{ namespace?: string; prefix?: string }`)
- `callback` (function) - 变更回调

**返回值**: `() => void` — 取消监听函数

### 备注
- 存储底层统一使用 SQLite，插件数据按 `plugin:<pluginId>` namespace 隔离。
- 插件后端不支持传入自定义 namespace；插件 UI 调用 storage 时，主进程也会强制使用当前插件自己的 namespace。

---

## 加密存储 (storage.encrypted)

基于系统 Keychain/Credential Manager 的加密 KV 存储，适用于 API keys、tokens 等敏感数据。

> 入口：`window.mulby.storage.encrypted`

### encrypted.set(key, value)
[Renderer]
加密存储数据。值会被 JSON 序列化后通过系统安全存储加密。

```javascript
await storage.encrypted.set('apiKey', 'sk-xxxx...');
await storage.encrypted.set('config', { token: 'abc', secret: '123' });
```

**参数**:
- `key` (string) - 键名
- `value` (unknown) - 任意可序列化值

**返回值**: `Promise<boolean>` - 是否成功

### encrypted.get(key)
[Renderer]
获取加密存储的数据，自动解密返回原始值。

```javascript
const apiKey = await storage.encrypted.get('apiKey');
```

**参数**:
- `key` (string) - 键名

**返回值**: `Promise<unknown | undefined>`

### encrypted.remove(key)
[Renderer]
删除加密存储的数据。

```javascript
await storage.encrypted.remove('apiKey');
```

### encrypted.has(key)
[Renderer]
检查加密键是否存在。

```javascript
const exists = await storage.encrypted.has('apiKey'); // true/false
```

### 安全说明
- 底层使用 Electron `safeStorage`（macOS Keychain / Windows DPAPI / Linux Secret Service）
- 加密后的数据存储在 SQLite 中，即使数据库文件泄露也无法解密
- 每个插件的加密存储相互隔离

---

## 附件/二进制存储 (storage.attachment)

简化的二进制文件管理 API，适合存储图片、音频、文档等非结构化数据。

> 入口：`window.mulby.storage.attachment`

### attachment.put(id, data, mimeType)
[Renderer]
存储附件，单文件最大 50MB。

```javascript
const imageData = await fetch('/path/to/image').then(r => r.arrayBuffer());
await storage.attachment.put('avatar', imageData, 'image/png');
```

**参数**:
- `id` (string) - 附件 ID（唯一标识）
- `data` (ArrayBuffer | Uint8Array) - 二进制数据
- `mimeType` (string) - MIME 类型

**返回值**: `Promise<boolean>`

### attachment.get(id)
[Renderer]
获取附件数据。

```javascript
const data = await storage.attachment.get('avatar');
if (data) {
  const blob = new Blob([data], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
}
```

**参数**:
- `id` (string) - 附件 ID

**返回值**: `Promise<Uint8Array | null>`

### attachment.getType(id)
[Renderer]
获取附件的 MIME 类型。

```javascript
const type = await storage.attachment.getType('avatar'); // 'image/png'
```

**返回值**: `Promise<string | null>`

### attachment.remove(id)
[Renderer]
删除附件。

```javascript
await storage.attachment.remove('avatar');
```

### attachment.list(prefix?)
[Renderer]
列出附件，可按前缀过滤。

```javascript
const attachments = await storage.attachment.list();
// [{ id: 'avatar', mimeType: 'image/png', size: 12345 }]

const images = await storage.attachment.list('img-');
```

**参数**:
- `prefix` (string, 可选) - ID 前缀过滤

**返回值**: `Promise<{ id: string; mimeType: string; size: number }[]>`

### 存储说明
- 文件存储在 `userData/plugin-attachments/{encodedNamespace}/` 目录
- 元数据（MIME 类型、大小）存入 SQLite
- 插件间完全隔离
- 单文件最大 50MB
- 附件 ID 会作为文件名使用，不能包含路径分隔符或 Windows 保留文件名字符（如 `: * ? " < > |`）

---

### 完整示例

```javascript
// 渲染进程 — 基础存储
await window.mulby.storage.set('demo', { ok: true });
const value = await window.mulby.storage.get('demo');

// 加密存储
await window.mulby.storage.encrypted.set('token', 'sk-secret');
const token = await window.mulby.storage.encrypted.get('token');

// 附件存储
const file = await fetch('/icon.png').then(r => r.arrayBuffer());
await window.mulby.storage.attachment.put('icon', file, 'image/png');
const iconData = await window.mulby.storage.attachment.get('icon');
```