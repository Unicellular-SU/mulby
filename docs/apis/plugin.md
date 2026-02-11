# 插件管理 API (plugin)
本文档描述 插件管理 API (plugin) 的使用方法与接口。

> 入口：`window.mulby.plugin`

### plugin.getAll()
[Renderer]
获取所有插件信息。

```javascript
const plugins = await window.mulby.plugin.getAll();
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
const results = await window.mulby.plugin.search('translate');
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
const result = await window.mulby.plugin.run('translator', 'translate', 'hello');
```

**返回值**:

```typescript
{ success: boolean; hasUI?: boolean; error?: string }
```

### plugin.install(filePath)
[Renderer]
安装插件。

```javascript
const result = await window.mulby.plugin.install('/path/to/plugin.zip');
```

**返回值**:

```typescript
{ success: boolean; pluginName?: string; error?: string }
```

### plugin.enable(name) / plugin.disable(name) / plugin.uninstall(name)
[Renderer]
启用、禁用或卸载插件。

```javascript
await window.mulby.plugin.enable('translator');
await window.mulby.plugin.disable('translator');
await window.mulby.plugin.uninstall('translator');
```

**返回值**:

```typescript
{ success: boolean; error?: string }
```

### plugin.getReadme(name)
[Renderer]
获取插件 README 文档内容。

```javascript
const markdown = await window.mulby.plugin.getReadme('translator');
```

**返回值**: `string | null`

### plugin.redirect(label, payload?)
[Renderer]
从当前插件跳转到其他插件。

```javascript
// 按 featureCode 跳转
await window.mulby.plugin.redirect('translate', { text: 'hello' });

// 指定插件 + featureCode
await window.mulby.plugin.redirect(['translator', 'translate'], { text: 'hello' });
```

**返回值**:
- `false` / `true`
- 或 `{ candidates: Array<{ name: string; displayName: string }> }`（存在多个匹配时）

### plugin.outPlugin(isKill?)
[Renderer]
退出当前插件（附着模式关闭插件，独立模式隐藏或销毁）。

```javascript
await window.mulby.plugin.outPlugin();
await window.mulby.plugin.outPlugin(true); // 强制销毁独立窗口
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

### plugin.listBackground()
[Renderer]
获取所有后台运行的插件及活跃的插件宿主进程信息。

```javascript
const processes = await window.mulby.plugin.listBackground();
```

**返回值**: `Array<BackgroundPluginInfo>` (包含插件的基础信息、运行模式、资源占用、健康状态等)

### plugin.startBackground(pluginId)
[Renderer]
手动启动后台插件。

```javascript
await window.mulby.plugin.startBackground('my-plugin');
```

**返回值**: `{ success: boolean; error?: string }`

### plugin.stopBackground(pluginId)
[Renderer]
停止后台插件。

```javascript
await window.mulby.plugin.stopBackground('my-plugin');
```

**返回值**: `{ success: boolean }`

### plugin.getBackgroundInfo(pluginId)
[Renderer]
获取后台插件详细信息。

```javascript
const info = await window.mulby.plugin.getBackgroundInfo('my-plugin');
```

**返回值**: `any`

### plugin.stopPlugin(pluginId)
[Renderer]
停止运行中的插件（关闭窗口并销毁 Host 进程）。

```javascript
await window.mulby.plugin.stopPlugin('my-plugin');
```

**返回值**: `Promise<void>`

### 完整示例

```javascript
window.mulby.onPluginInit((data) => {
  console.log(data.pluginName, data.featureCode, data.input, data.mode);
});

window.mulby.onPluginAttach((data) => {
  console.log(data.displayName, data.featureCode);
});

window.mulby.onPluginDetached(() => {
  console.log('detached');
});
```

**事件说明**:
- `onPluginInit`: 插件窗口初始化
- `onPluginAttach`: 主窗口附着插件
- `onPluginDetached`: 主窗口插件分离