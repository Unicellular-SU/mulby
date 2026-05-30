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