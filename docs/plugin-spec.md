# InTools 插件开发规范

> 本文档为 AI 生成插件优化，结构清晰、示例完整。

---

## 快速入门

### 最小插件结构

```
my-plugin/
├── manifest.json   # 必需：插件配置
└── main.js         # 必需：入口文件
```

### 30 秒创建一个插件

**manifest.json**
```json
{
  "name": "hello-world",
  "version": "1.0.0",
  "displayName": "Hello World",
  "description": "一个简单的示例插件",
  "runtime": "nodejs",
  "main": "main.js",
  "triggers": [
    { "type": "keyword", "value": "hello" }
  ]
}
```

**main.js**
```javascript
const { notification } = require('@intools/sdk');

module.exports = {
  async run(context) {
    notification.show('Hello, InTools!');
  }
};
```

---

## manifest.json 完整规范

```json
{
  "name": "plugin-name",
  "version": "1.0.0",
  "displayName": "插件显示名称",
  "description": "插件功能描述",
  "author": "作者名",
  "runtime": "nodejs",
  "main": "main.js",
  "ui": "ui/index.html",
  "icon": "icon.png",
  "permissions": ["clipboard", "notification"],
  "triggers": [],
  "shortcut": "CmdOrCtrl+Shift+X",
  "minAppVersion": "1.0.0"
}
```

### 字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| name | string | 是 | 唯一标识，仅小写字母、数字、连字符 |
| version | string | 是 | 语义化版本 (x.y.z) |
| displayName | string | 是 | 用户看到的名称 |
| description | string | 是 | 功能描述 |
| runtime | string | 是 | `nodejs` 或 `python` |
| main | string | 是 | 入口文件路径 |
| ui | string | 否 | UI 文件路径（有界面时必填） |
| permissions | array | 否 | 所需权限 |
| triggers | array | 是 | 触发条件 |
| shortcut | string | 否 | 全局快捷键 |

---

## 触发器 (triggers)

### keyword - 关键词触发
```json
{ "type": "keyword", "value": "json", "description": "输入 json 触发" }
```

### regex - 正则匹配剪贴板
```json
{ "type": "regex", "value": "^\\{.*\\}$", "description": "检测到 JSON" }
```

### file - 文件类型
```json
{ "type": "file", "value": [".png", ".jpg"], "description": "图片文件" }
```

---

## 权限 (permissions)

| 权限 | 说明 | 使用场景 |
|------|------|----------|
| clipboard | 读写剪贴板 | 文本处理、格式转换 |
| notification | 系统通知 | 操作反馈 |
| storage | 本地存储 | 保存配置、历史记录 |
| filesystem | 文件读写 | 文件处理插件 |
| network | 网络请求 | API 调用、翻译 |
| shell | 系统命令 | 高级操作（需审核） |

---

## 插件生命周期

插件在 InTools 中有完整的生命周期管理，开发者可以通过钩子函数在特定时机执行代码。

### 生命周期状态

```
安装 → 加载(onLoad) → 启用(onEnable) ⇄ 禁用(onDisable) → 卸载(onUnload)
```

| 状态 | 说明 |
|------|------|
| loaded | 插件已加载，manifest 已读取 |
| enabled | 插件已启用，可被搜索和执行 |
| disabled | 插件已禁用，不参与搜索但保留在系统中 |

### 生命周期钩子

| 钩子 | 触发时机 | 用途 |
|------|----------|------|
| onLoad | 插件加载时 | 初始化资源、注册服务 |
| onUnload | 插件卸载时 | 清理资源、保存状态 |
| onEnable | 插件启用时 | 恢复服务、重新注册 |
| onDisable | 插件禁用时 | 暂停服务、释放资源 |

### 钩子函数示例

```javascript
module.exports = {
  // 插件加载时调用
  onLoad() {
    console.log('插件已加载');
    // 初始化资源，如建立连接、加载配置
  },

  // 插件卸载时调用
  onUnload() {
    console.log('插件即将卸载');
    // 清理资源，如关闭连接、保存数据
  },

  // 插件启用时调用
  onEnable() {
    console.log('插件已启用');
  },

  // 插件禁用时调用
  onDisable() {
    console.log('插件已禁用');
  },

  // 主执行函数
  async run(context) {
    // 插件主逻辑
  }
};
```

### 完整生命周期示例

```javascript
const { storage, notification } = require('@intools/sdk');

let cache = null;
let timer = null;

module.exports = {
  async onLoad() {
    // 加载缓存数据
    cache = await storage.get('cache') || {};
    console.log('缓存已加载');
  },

  onEnable() {
    // 启动定时任务
    timer = setInterval(() => {
      console.log('定时任务运行中...');
    }, 60000);
  },

  onDisable() {
    // 停止定时任务
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  },

  async onUnload() {
    // 保存缓存数据
    await storage.set('cache', cache);
    console.log('缓存已保存');
  },

  async run(context) {
    // 使用缓存执行操作
    const result = processWithCache(context.input, cache);
    notification.show('处理完成');
  }
};

function processWithCache(input, cache) {
  // 处理逻辑
  return input;
}
```

### 注意事项

1. **钩子函数可选**：所有生命周期钩子都是可选的，只需实现需要的钩子
2. **支持异步**：钩子函数可以是 async 函数，系统会等待其完成
3. **错误处理**：钩子中的错误不会阻止插件加载，但会记录到日志
4. **状态持久化**：插件的启用/禁用状态会自动保存，重启后恢复

---

## 插件模板

### 模板 A：无 UI 插件 (Node.js)

适用于：剪贴板处理、格式转换、快速计算

```
plugin-name/
├── manifest.json
└── main.js
```

**main.js**
```javascript
const { clipboard, notification } = require('@intools/sdk');

module.exports = {
  async run(context) {
    // context.text - 触发时的文本（关键词后的内容或剪贴板）
    const input = context.text || await clipboard.readText();

    // 处理逻辑
    const result = processData(input);

    // 输出结果
    await clipboard.writeText(result);
    notification.show('处理完成');
  }
};

function processData(input) {
  // 在这里实现处理逻辑
  return input;
}
```

---

### 模板 B：有 UI 插件 (Node.js)

适用于：需要用户交互、展示结果、复杂操作

```
plugin-name/
├── manifest.json
├── main.js
└── ui/
    └── index.html
```

**manifest.json** (需添加 ui 字段)
```json
{
  "name": "my-ui-plugin",
  "version": "1.0.0",
  "displayName": "带界面的插件",
  "description": "需要用户交互的插件",
  "runtime": "nodejs",
  "main": "main.js",
  "ui": "ui/index.html",
  "permissions": ["clipboard"],
  "triggers": [
    { "type": "keyword", "value": "myui" }
  ]
}
```

**main.js**
```javascript
const { clipboard, ui } = require('@intools/sdk');

module.exports = {
  async run(context) {
    const text = await clipboard.readText();
    ui.send('init', { text });
  }
};

ui.on('process', async (data) => {
  await clipboard.writeText(data.result);
});
```

**ui/index.html**
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: system-ui; padding: 16px; }
    textarea { width: 100%; height: 150px; }
    button { margin-top: 8px; padding: 8px 16px; }
  </style>
</head>
<body>
  <textarea id="input"></textarea>
  <button onclick="process()">处理</button>
  <script>
    const { ui } = require('@intools/sdk');
    ui.on('init', (data) => {
      document.getElementById('input').value = data.text;
    });
    function process() {
      const text = document.getElementById('input').value;
      ui.send('process', { result: text });
    }
  </script>
</body>
</html>
```

---

## API 快速参考

### clipboard - 剪贴板

```javascript
const { clipboard } = require('@intools/sdk');

// 读取文本
const text = await clipboard.readText();

// 写入文本
await clipboard.writeText('内容');

// 读取图片 (返回 Buffer)
const image = await clipboard.readImage();

// 读取文件列表
const files = await clipboard.readFiles();
// 返回: [{ path, name, size, type }]

// 获取格式
const format = await clipboard.getFormat();
// 返回: 'text' | 'image' | 'files' | 'empty'
```

### notification - 通知

```javascript
const { notification } = require('@intools/sdk');

notification.show('操作成功');
notification.show('发生错误', 'error');
// type: 'info' | 'success' | 'warning' | 'error'
```

### storage - 存储

```javascript
const { storage } = require('@intools/sdk');

await storage.set('key', { data: 'value' });
const data = await storage.get('key');
await storage.remove('key');
```

### http - 网络请求

```javascript
const { http } = require('@intools/sdk');

const res = await http.request({
  url: 'https://api.example.com/data',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'value' })
});
```

---

## 常见场景示例

### 示例 1：JSON 格式化插件

**manifest.json**
```json
{
  "name": "json-formatter",
  "version": "1.0.0",
  "displayName": "JSON 格式化",
  "description": "格式化或压缩 JSON 数据",
  "runtime": "nodejs",
  "main": "main.js",
  "permissions": ["clipboard", "notification"],
  "triggers": [
    { "type": "keyword", "value": "json" },
    { "type": "regex", "value": "^\\s*[{\\[]" }
  ]
}
```

**main.js**
```javascript
const { clipboard, notification } = require('@intools/sdk');

module.exports = {
  async run(context) {
    const text = await clipboard.readText();
    try {
      const obj = JSON.parse(text);
      const formatted = JSON.stringify(obj, null, 2);
      await clipboard.writeText(formatted);
      notification.show('JSON 格式化成功');
    } catch (e) {
      notification.show('无效的 JSON', 'error');
    }
  }
};
```

---

### 示例 2：时间戳转换插件

**manifest.json**
```json
{
  "name": "timestamp-converter",
  "version": "1.0.0",
  "displayName": "时间戳转换",
  "description": "时间戳与日期互转",
  "runtime": "nodejs",
  "main": "main.js",
  "permissions": ["clipboard", "notification"],
  "triggers": [
    { "type": "keyword", "value": "ts" },
    { "type": "regex", "value": "^\\d{10,13}$" }
  ]
}
```

**main.js**
```javascript
const { clipboard, notification } = require('@intools/sdk');

module.exports = {
  async run(context) {
    const text = await clipboard.readText();
    let result;
    if (/^\d{10,13}$/.test(text)) {
      const ts = text.length === 10 ? text * 1000 : Number(text);
      result = new Date(ts).toLocaleString();
    } else {
      result = String(new Date(text).getTime());
    }
    await clipboard.writeText(result);
    notification.show('转换完成: ' + result);
  }
};
```

---

### 示例 3：翻译插件（带 UI）

**manifest.json**
```json
{
  "name": "translator",
  "version": "1.0.0",
  "displayName": "快速翻译",
  "description": "中英文互译",
  "runtime": "nodejs",
  "main": "main.js",
  "ui": "ui/index.html",
  "permissions": ["clipboard", "network"],
  "triggers": [
    { "type": "keyword", "value": "fy" }
  ]
}
```

**main.js**
```javascript
const { clipboard, http, ui } = require('@intools/sdk');

module.exports = {
  async run(context) {
    const text = await clipboard.readText();
    ui.send('init', { text });
  }
};

ui.on('translate', async ({ text, from, to }) => {
  const res = await http.request({
    url: 'https://api.translate.com/v1/translate',
    method: 'POST',
    body: JSON.stringify({ text, from, to })
  });
  ui.send('result', { translation: res.data.result });
});
```

---

## AI 生成插件指南

当用户描述需求时，AI 应按以下步骤生成插件：

### 步骤 1：分析需求

确定以下信息：
- 插件功能是什么？
- 需要哪些权限？
- 是否需要 UI？
- 触发方式是什么？

### 步骤 2：选择模板

| 需求类型 | 模板 |
|---------|------|
| 剪贴板处理 | 模板 A（无 UI） |
| 格式转换 | 模板 A（无 UI） |
| 需要用户输入 | 模板 B（有 UI） |
| 展示结果列表 | 模板 B（有 UI） |

### 步骤 3：生成代码

按以下顺序生成：
1. `manifest.json` - 配置文件
2. `main.js` - 主逻辑
3. `ui/index.html` - UI 文件（如需要）

### 生成规则

1. **name** 使用小写字母和连字符
2. **triggers** 至少包含一个 keyword 类型
3. **permissions** 只申请必要的权限
4. 代码使用 async/await 风格
5. 错误处理使用 try/catch
6. 操作完成后发送 notification

### 示例提示词

用户说：「帮我做一个 Base64 编解码插件」

AI 应生成：

```
base64-codec/
├── manifest.json
└── main.js
```

**manifest.json**
```json
{
  "name": "base64-codec",
  "version": "1.0.0",
  "displayName": "Base64 编解码",
  "description": "Base64 编码和解码",
  "runtime": "nodejs",
  "main": "main.js",
  "permissions": ["clipboard", "notification"],
  "triggers": [
    { "type": "keyword", "value": "b64" },
    { "type": "keyword", "value": "base64" }
  ]
}
```

**main.js**
```javascript
const { clipboard, notification } = require('@intools/sdk');

module.exports = {
  async run(context) {
    const text = await clipboard.readText();
    let result;
    try {
      // 尝试解码
      result = Buffer.from(text, 'base64').toString('utf-8');
      if (Buffer.from(result).toString('base64') !== text) {
        // 不是有效 base64，执行编码
        result = Buffer.from(text).toString('base64');
      }
    } catch {
      result = Buffer.from(text).toString('base64');
    }
    await clipboard.writeText(result);
    notification.show('已复制到剪贴板');
  }
};
```

---
