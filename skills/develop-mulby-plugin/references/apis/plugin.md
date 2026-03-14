# 插件管理 API (plugin)
本文档描述插件管理 API (plugin) 的使用方式与接口。

> 入口：`window.mulby.plugin`

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

### plugin.install(filePath)
[Renderer]
安装插件。

```javascript
const result = await window.mulby.plugin.install('/path/to/plugin.zip');
```

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

### onPluginAttach(callback)
[Renderer]
主窗口附着插件事件。

### onPluginDetached(callback)
[Renderer]
主窗口插件分离事件。

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
