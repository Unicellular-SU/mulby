## 3. 存储 API (storage)

基于 SQLite 的高效持久化存储，支持按插件隔离数据。

### 3.1 get(key)
获取存储的数据。

```javascript
const value = await storage.get('myKey');
```

**参数**:
- `key` (string) - 键名

**返回值**: `Promise<any>` - 存储的值，如果不存在返回 `undefined`

### 3.2 set(key, value)
存储数据。

```javascript
await storage.set('myKey', { foo: 'bar' });
```

**参数**:
- `key` (string) - 键名
- `value` (any) - 要存储的值（会自动序列化为 JSON）

**返回值**: `Promise<boolean>` - 是否保存成功

### 3.3 remove(key)
删除存储的数据。

```javascript
await storage.remove('myKey');
```

**参数**:
- `key` (string) - 键名

**返回值**: `Promise<boolean>` - 是否删除成功

> **注意**: 在插件中使用 `useIntools(pluginId)` 后，所有存储操作会自动隔离在该 `pluginId` 的命名空间下。如果不传递 `pluginId`，数据将存储在全局命名空间 (global)。
