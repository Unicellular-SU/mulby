# 存储 API (storage)
本文档描述 存储 API (storage) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.intools.storage`
> - 插件后端：`context.api.storage`

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
await storage.remove('myKey', 'myPlugin');

// 插件后端（同步）
context.api.storage.remove('myKey');
```

**参数**:
- `key` (string) - 键名
- `namespace` (string, 可选，仅渲染进程) - 命名空间

**返回值**:
- 渲染进程：`Promise<boolean>` - 是否删除成功
- 插件后端：`void`

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

### 备注
- 渲染进程存储使用 SQLite，支持 `namespace` 隔离。
- 插件后端存储使用独立 JSON 文件（按插件隔离），不支持 `namespace`。

### 完整示例

```javascript
// 渲染进程
await window.intools.storage.set('demo', { ok: true });
const value = await window.intools.storage.get('demo');
console.log(value);
```