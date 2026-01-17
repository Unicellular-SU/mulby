# 插件管理 API (plugin)
本文档描述 插件管理 API (plugin) 的使用方法与接口。

> 入口：`window.intools.plugin`

### plugin.getAll()
[Renderer]
获取所有插件信息。

```javascript
const plugins = await window.intools.plugin.getAll();
```

**返回值**:

```typescript
interface PluginInfo {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  features: Array<{ code: string; explain?: string }>;
  enabled: boolean;
}
```

### plugin.search(query)
[Renderer]
搜索插件功能入口。

```javascript
const results = await window.intools.plugin.search('translate');
```

**返回值**:

```typescript
interface PluginSearchResult {
  pluginId: string;
  pluginName: string;
  displayName: string;
  featureCode: string;
  featureExplain?: string;
  matchType: 'keyword' | 'regex' | 'prefix' | 'exact' | string;
  icon?: string;
}
```

### plugin.run(name, featureCode[, input])
[Renderer]
执行插件功能入口。

```javascript
const result = await window.intools.plugin.run('translator', 'translate', 'hello');
```

**返回值**:

```typescript
{ success: boolean; hasUI?: boolean; error?: string }
```

### plugin.install(filePath)
[Renderer]
安装插件。

```javascript
const result = await window.intools.plugin.install('/path/to/plugin.zip');
```

**返回值**:

```typescript
{ success: boolean; pluginName?: string; error?: string }
```

### plugin.enable(name) / plugin.disable(name) / plugin.uninstall(name)
[Renderer]
启用、禁用或卸载插件。

```javascript
await window.intools.plugin.enable('translator');
await window.intools.plugin.disable('translator');
await window.intools.plugin.uninstall('translator');
```

**返回值**:

```typescript
{ success: boolean; error?: string }
```

### plugin.getReadme(name)
[Renderer]
获取插件 README 文档内容。

```javascript
const markdown = await window.intools.plugin.getReadme('translator');
```

**返回值**: `string | null`

### plugin.redirect(label, payload?)
[Renderer]
从当前插件跳转到其他插件。

```javascript
// 按 featureCode 跳转
await window.intools.plugin.redirect('translate', { text: 'hello' });

// 指定插件 + featureCode
await window.intools.plugin.redirect(['translator', 'translate'], { text: 'hello' });
```

**返回值**:
- `false` / `true`
- 或 `{ candidates: Array<{ name: string; displayName: string }> }`（存在多个匹配时）

### plugin.outPlugin(isKill?)
[Renderer]
退出当前插件（附着模式关闭插件，独立模式隐藏或销毁）。

```javascript
await window.intools.plugin.outPlugin();
await window.intools.plugin.outPlugin(true); // 强制销毁独立窗口
```

**返回值**: `boolean`

### onPluginInit(callback)
[Renderer]
插件窗口初始化事件。

### onPluginAttach(callback)
[Renderer]
主窗口附着插件事件。

### onPluginDetached(callback)
[Renderer]
主窗口插件分离事件。

### 完整示例

```javascript
window.intools.onPluginInit((data) => {
  console.log(data.pluginName, data.featureCode, data.input, data.mode);
});

window.intools.onPluginAttach((data) => {
  console.log(data.displayName, data.featureCode);
});

window.intools.onPluginDetached(() => {
  console.log('detached');
});
```

**事件说明**:
- `onPluginInit`: 插件窗口初始化
- `onPluginAttach`: 主窗口附着插件
- `onPluginDetached`: 主窗口插件分离