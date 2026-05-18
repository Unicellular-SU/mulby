# 插件管理 API (plugin)
本文档描述插件管理 API (plugin) 的使用方式与接口。

> 入口：`window.mulby.plugin`

---

## manifest.platform — 插件平台限制

插件可以在 `manifest.json` 的**顶层**声明 `platform` 字段，限制该插件仅在特定操作系统上加载和安装。

```json
{
  "name": "my-plugin",
  "platform": "darwin",
  "features": []
}
```

| 值 | 含义 |
|----|------|
| `"darwin"` | 仅 macOS |
| `"win32"` | 仅 Windows |
| `"linux"` | 仅 Linux |
| `["win32", "linux"]` | 数组：同时支持多个平台 |
| *(不填)* | 全平台兼容（默认） |

**生效时机：**

- **安装时**：`plugin.install()` 读取 manifest，若 `platform` 与当前系统不符，直接返回错误，不写入插件目录。
- **加载时**：Mulby 启动扫描插件目录时，不符合当前平台的插件被静默跳过，不出现在插件列表中。

> 注意：`manifest.features[].platform` 是**指令级别**的平台过滤（已有能力），与此顶层字段功能不同。顶层 `platform` 控制插件整体的可见性。

---

### plugin.getAll()
[Renderer]
获取全部插件信息。


```javascript
const plugins = await window.mulby.plugin.getAll();
```

### plugin.listCommands(pluginId?)
[Renderer]
获取命令列表（功能指令 + 匹配指令）。

```javascript
const allCommands = await window.mulby.plugin.listCommands();
const translatorCommands = await window.mulby.plugin.listCommands('translator');
```

### plugin.search(query)
[Renderer]
搜索插件功能入口。

```javascript
const results = await window.mulby.plugin.search('translate');
```

### plugin.mainPushSelect(pluginName, action)
[Renderer]
通知指定插件用户选中了某个 MainPush 推送项。宿主会在全局 MainPush 开关关闭或该插件已禁用推送时返回 `false`；如果插件的 MainPush worker 尚未运行，宿主会先尝试按需激活。

```javascript
const ok = await window.mulby.plugin.mainPushSelect('translator', {
  code: 'translate',
  type: 'text',
  payload: 'hello',
  option: pushItem,
});
```

返回值：`boolean`

### plugin.getMainPushPlugins()
[Renderer]
获取当前已启用且声明了 MainPush 功能的插件列表，用于设置界面展示全局/单插件推送开关。

```javascript
const plugins = await window.mulby.plugin.getMainPushPlugins();
// Array<{ pluginId: string; displayName: string }>
```

### plugin.run(name, featureCode[, input])
[Renderer]
执行插件功能入口。

```javascript
const result = await window.mulby.plugin.run('translator', 'translate', 'hello');
```

返回值：`{ success: boolean; hasUI?: boolean; error?: string }`

### plugin.runCommand(input)
[Renderer]
按插件命令输入结构直接执行指令。

```javascript
const result = await window.mulby.plugin.runCommand({
  pluginId: 'translator',
  featureCode: 'translate',
  input: 'hello'
});
```

返回值：`{ success: boolean; hasUI?: boolean; error?: string }`

### plugin.getRecentUsed(limit?)
[Renderer]
获取最近使用的插件功能列表。

```javascript
const recent = await window.mulby.plugin.getRecentUsed(20);
```

### plugin.getSearchPreferences()
[Renderer]
获取搜索偏好设置（置顶与隐藏列表）。

```javascript
const prefs = await window.mulby.plugin.getSearchPreferences();
// prefs.pinnedFeatures: Array<{ pluginId, featureCode, pinnedAt }>
// prefs.hiddenFeatures: Array<{ pluginId, featureCode, hiddenAt }>
```

返回值：`SearchPreferenceState`

### plugin.pinFeature(pluginId, featureCode)
[Renderer]
将插件功能置顶，在搜索结果中优先展示。

```javascript
await window.mulby.plugin.pinFeature('translator', 'translate');
```

返回值：`{ success: boolean }`

### plugin.unpinFeature(pluginId, featureCode)
[Renderer]
取消插件功能置顶。

```javascript
await window.mulby.plugin.unpinFeature('translator', 'translate');
```

返回值：`{ success: boolean }`

### plugin.hideFeature(pluginId, featureCode)
[Renderer]
隐藏插件功能，使其不再出现在搜索结果中。

```javascript
await window.mulby.plugin.hideFeature('translator', 'translate');
```

返回值：`{ success: boolean }`

### plugin.unhideFeature(pluginId, featureCode)
[Renderer]
恢复已隐藏的插件功能。

```javascript
await window.mulby.plugin.unhideFeature('translator', 'translate');
```

返回值：`{ success: boolean }`

### plugin.removeRecentUsage(pluginId, featureCode)
[Renderer]
从最近使用记录中移除指定的插件功能。

```javascript
await window.mulby.plugin.removeRecentUsage('translator', 'translate');
```

返回值：`{ success: boolean }`

### plugin.getLaunchOnStartup(pluginId)
[Renderer]
获取指定插件的跟随 Mulby 启动配置。未配置，或插件既未声明后台运行也没有 UI 时返回 `undefined`。

```javascript
const state = await window.mulby.plugin.getLaunchOnStartup('translator');
// state: { enabled: true, mode: 'background', featureCode: 'translate', route: '/translate', uiMode: 'attached', updatedAt: 1710000000000 } | undefined
```

返回值：`PluginLaunchOnStartupState | undefined`

### plugin.setLaunchOnStartup(pluginId, enabled, target?)
[Renderer]
设置指定插件是否跟随 Mulby 启动。启用后 Mulby 会按插件能力执行启动动作：纯后台插件只启动后台；纯 UI 插件只隐藏加载并缓存对应 UI；同时具备后台和 UI 的插件会同时启动后台并缓存 UI。UI 缓存支持附着模式和独立窗口模式，用于后续热启动，但不会自动打开主窗口、附着面板或独立窗口。

启用时插件必须至少满足 `manifest.pluginSetting.background: true` 或声明了 `ui`；关闭时会移除该配置。该 IPC 仅允许主应用窗口调用，插件窗口不能静默修改启动持久化配置。

```javascript
const result = await window.mulby.plugin.setLaunchOnStartup('translator', true, {
  featureCode: 'translate',
  route: '/translate',
  uiMode: 'attached'
});

await window.mulby.plugin.setLaunchOnStartup('translator', false);
```

`target.featureCode` / `target.route` / `target.uiMode` 由主应用菜单传入，用于选择启动时缓存的 UI 功能和窗口形态。`mode` 会统一规范为 `background`，表示该配置属于跟随 Mulby 启动策略，不表示一定会启动后台进程。

返回值：`{ success: boolean; state?: PluginLaunchOnStartupState; error?: string }`

### plugin.getAlwaysOpenDetached(pluginId)
[Renderer]
获取指定插件的始终以独立窗口打开配置。未配置时返回 `undefined`。

```javascript
const state = await window.mulby.plugin.getAlwaysOpenDetached('translator');
// state: { enabled: true, updatedAt: 1710000000000 } | undefined
```

返回值：`PluginAlwaysOpenDetachedState | undefined`

### plugin.setAlwaysOpenDetached(pluginId, enabled)
[Renderer]
设置指定插件是否始终以独立窗口打开。宿主会校验插件是否存在，以及插件是否声明了 UI。

```javascript
const result = await window.mulby.plugin.setAlwaysOpenDetached('translator', true);
await window.mulby.plugin.setAlwaysOpenDetached('translator', false);
```

返回值：`{ success: boolean; state?: PluginAlwaysOpenDetachedState; error?: string }`

### plugin.install(filePath)
[Renderer]
安装插件。

```javascript
const result = await window.mulby.plugin.install('/path/to/plugin.inplugin');
```

### plugin.resolveDroppedFilePaths(files)
[Renderer]
解析拖拽得到的 `File` 对象对应的本地文件路径。用于安装从系统文件管理器拖入的 `.inplugin` 插件包。

```javascript
const [filePath] = window.mulby.plugin.resolveDroppedFilePaths(Array.from(event.dataTransfer.files));
if (filePath?.endsWith('.inplugin')) {
  await window.mulby.plugin.install(filePath);
}
```

返回值：`string[]`。无法解析路径的文件会返回空字符串。

### plugin.enable(name) / plugin.disable(name) / plugin.uninstall(name)
[Renderer]
启用、禁用或卸载插件。

```javascript
await window.mulby.plugin.enable('translator');
await window.mulby.plugin.disable('translator');
await window.mulby.plugin.uninstall('translator');
```

返回值：`{ success: boolean; error?: string }`

### plugin.getReadme(name)
[Renderer]
获取插件 README 文本内容。

```javascript
const markdown = await window.mulby.plugin.getReadme('translator');
```

返回值：`string | null`

### plugin.listCommandShortcuts(pluginId?)
[Renderer]
列出命令快捷键绑定。

### plugin.bindCommandShortcut(input)
[Renderer]
绑定命令快捷键。

### plugin.unbindCommandShortcut(bindingId)
[Renderer]
解绑命令快捷键。

### plugin.validateCommandShortcut(accelerator, bindingId?)
[Renderer]
校验快捷键是否可绑定。

### plugin.setCommandDisabled(input)
[Renderer]
设置命令启用/禁用状态。

### plugin.redirect(label, payload?)
[Renderer]
从当前插件跳转到其他插件。

```javascript
await window.mulby.plugin.redirect('translate', { text: 'hello' });
await window.mulby.plugin.redirect(['translator', 'translate'], { text: 'hello' });
```

### plugin.outPlugin(isKill?)
[Renderer]
退出当前插件（附着模式关闭插件，独立模式隐藏或销毁）。

```javascript
await window.mulby.plugin.outPlugin();
await window.mulby.plugin.outPlugin(true);
```

返回值：`boolean`

### onPluginInit(callback)
[Renderer]
插件窗口初始化事件。

回调数据包含插件名、功能码、输入内容、附件、窗口模式、能力信息。默认 route 模式的辅助窗口还会包含解析后的 `route`、`windowType`，以及 `window.create(url, { params })` 传入的结构化参数。`loadMode: 'file'` 的旧插件兼容窗口按 HTML 文件路径加载，不会把文件路径伪装成 `route`；需要页面级状态时请使用 URL query/hash 或 `params`。

```typescript
window.mulby.onPluginInit((data) => {
  console.log(data.route, data.params, data.windowType);
});
```

### onPluginAttach(callback)
[Renderer]
主窗口附着插件事件。

### onPluginDetached(callback)
[Renderer]
主窗口插件分离事件。

### onPluginLaunchStart(callback)
[Renderer]
插件启动开始事件。用于全局监听插件功能启动，回调数据包含 `requestId`、`pluginName`、`displayName`、`featureCode`、`startedAt`。

### onPluginLaunchEnd(callback)
[Renderer]
插件启动结束事件。用于全局监听插件功能结束状态，回调数据包含 `requestId`、`pluginName`、`featureCode`、`reason`。

### plugin.listBackground()
[Renderer]
获取后台运行插件与活跃 host 信息。

```javascript
const processes = await window.mulby.plugin.listBackground();
```

### plugin.startBackground(pluginId)
[Renderer]
手动启动后台插件。

```javascript
await window.mulby.plugin.startBackground('my-plugin');
```

返回值：`{ success: boolean; error?: string }`

### plugin.stopBackground(pluginId)
[Renderer]
停止后台插件。

```javascript
await window.mulby.plugin.stopBackground('my-plugin');
```

返回值：`{ success: boolean }`

### plugin.getBackgroundInfo(pluginId)
[Renderer]
获取后台插件详细信息。

```javascript
const info = await window.mulby.plugin.getBackgroundInfo('my-plugin');
```

### plugin.stopPlugin(pluginId)
[Renderer]
停止运行中的插件（关闭窗口并终止 Host 进程）。

```javascript
const result = await window.mulby.plugin.stopPlugin('my-plugin');
```

返回值：`{ success: boolean; error?: string }`

### plugin.prewarm(pluginId)
[Renderer]
预热插件的运行环境。当用户在插件列表中选中某个插件时，预先启动插件的 Host 进程，以提升后续实际运行时的启动速度。如果一段时间内未实际启动该插件，预热的进程会被自动销毁。

```javascript
await window.mulby.plugin.prewarm('my-plugin');
```

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
