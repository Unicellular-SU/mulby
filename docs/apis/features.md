# 动态指令 API (features)
本文档描述 动态指令 API (features) 的使用方法与接口。

> 入口：`context.api.features`

参考 uTools 的「动态指令」概念，Mulby 提供可运行时增删功能入口的能力。适用于用户可配置入口、在线内容映射、批量快捷命令等场景。

### 适用场景

- 用户自定义快捷指令（例如：自定义网站快捷打开）
- 运行时根据数据源生成入口（例如：收藏列表、常用模板）
- 插件配置变更后动态刷新入口
- 区分 UI 与后台指令执行方式

### 核心概念

- 动态指令属于插件本身，存储在用户数据目录中。
- 同一 `code` 会覆盖旧配置，适合做“更新式注册”。
- `mode` 决定执行方式：`ui`/`detached` 会打开 UI，`silent` 仅执行后端逻辑。
- `route` 会作为窗口的 hash 传入，便于 UI 内部路由跳转。

### 类型定义

```ts
type CmdKeyword = { type: 'keyword'; value: string }
type CmdRegex = {
  type: 'regex'
  match: string
  explain?: string
  label?: string       // 指令名称（显示在搜索结果中）
  minLength?: number   // 最少字符数
  maxLength?: number   // 最多字符数
}
type FileType = 'file' | 'directory' | 'any'
type CmdFiles = {
  type: 'files'
  label?: string          // 指令名称（可选，未提供会自动补全）
  exts?: string[]         // 文件扩展名（可选）
  fileType?: FileType     // 文件类型过滤（默认 'any'）
  match?: string          // 匹配文件(夹)名称的正则表达式（与 exts 二选一）
  minLength?: number      // 最少文件数
  maxLength?: number      // 最多文件数
}
type CmdImg = { type: 'img'; label?: string; exts?: string[] }
type CmdOver = {
  type: 'over'
  label?: string       // 指令名称
  exclude?: string     // 排除的正则表达式
  minLength?: number   // 最少字符数
  maxLength?: number   // 最多字符数（默认 10000）
}

type DynamicCmdInput = string | CmdKeyword | CmdRegex | CmdFiles | CmdImg | CmdOver

interface DynamicFeatureInput {
  code: string
  explain?: string
  icon?: string
  platform?: string | string[]
  mode?: 'ui' | 'silent' | 'detached'
  route?: string
  mainHide?: boolean
  mainPush?: boolean
  cmds: DynamicCmdInput[]
}

interface DynamicFeature {
  code: string
  explain: string
  icon?: string
  platform?: string | string[]
  mode?: 'ui' | 'silent' | 'detached'
  route?: string
  mainHide?: boolean
  mainPush?: boolean
  cmds: Array<CmdKeyword | CmdRegex | CmdFiles | CmdImg | CmdOver>
}
```

### getFeatures
[Backend]

```ts
features.getFeatures(codes?: string[]): Promise<DynamicFeature[]>
```

- 返回当前插件已注册的动态指令
- 可传入 `codes` 过滤指定功能
- `platform` 字段会按当前平台过滤
- 返回的 `cmds` 一定为对象结构（字符串会被归一化为 `{ type: 'keyword', value }`）

### setFeature
[Backend]

```ts
features.setFeature(feature: DynamicFeatureInput): Promise<void>
```

新增或更新动态指令。字段说明：

- `code`: 功能编码（必填）
- `explain`: 说明（可选，默认使用 `code`）
- `icon`: 功能图标（可选）
- `platform`: 指定平台（可选，`string | string[]`）
- `mode`: 指令模式（可选，`'ui' | 'silent' | 'detached'`，默认 `ui`）
- `route`: UI 路由（可选，传给窗口的 hash）
- `mainHide`: 进入插件后隐藏主窗口
- `mainPush`: 启用搜索框推送（见下方 MainPush 章节）
- `cmds`: 指令列表（必填）

`cmds` 支持两种写法：

- 字符串：会被视为 `keyword` 指令
- 对象：使用 Mulby 的 `cmd` 结构（`keyword`/`regex`/`files`/`img`/`over`）

### removeFeature
[Backend]

```ts
features.removeFeature(code: string): Promise<boolean>
```

删除动态指令，返回是否成功删除。

### 完整示例

#### 注册 silent 指令（无 UI）

```ts
await api.features.setFeature({
  code: 'today',
  explain: '复制今日日期',
  mode: 'silent',
  cmds: ['today', '日期']
})
```

#### 注册 UI 指令（附着面板）

```ts
await api.features.setFeature({
  code: 'settings',
  explain: '打开设置面板',
  mode: 'ui',
  route: 'settings',
  cmds: ['plugin settings']
})
```

#### 注册 detached 指令（独立窗口）

```ts
await api.features.setFeature({
  code: 'window',
  explain: '独立窗口打开',
  mode: 'detached',
  route: 'settings',
  cmds: ['plugin window']
})
```

#### 清理并刷新指令

```ts
for (const code of ['today', 'settings', 'window']) {
  await api.features.removeFeature(code)
}
```

---

## MainPush 搜索框推送

当 feature 设置 `mainPush: true` 时，插件可在搜索匹配时动态推送额外选项到搜索结果列表中，实现类似 uTools 的 `onMainPush` 能力。

### onMainPush
[Backend]

```ts
features.onMainPush(callback: (action: MainPushAction) => MainPushItem[] | Promise<MainPushItem[]>)
```

注册主搜索推送回调。当用户输入文本匹配到该 feature 时，Mulby 会调用此回调获取推送项。

**MainPushAction**:
```ts
interface MainPushAction {
  code: string    // 匹配的 feature code
  type: string    // 当前固定为 'text'
  payload: string // 用户输入的搜索文本
}
```

**MainPushItem**:
```ts
interface MainPushItem {
  icon?: string   // 图标（可选，支持 URL 或 base64）
  title: string   // 标题
  text: string    // 描述文本
  [key: string]: unknown // 自定义扩展字段
}
```

### onMainPushSelect
[Backend]

```ts
features.onMainPushSelect(callback: (action: MainPushAction & { option: MainPushItem }) => boolean | Promise<boolean>)
```

注册推送项选中回调。当用户点击推送项时触发。

- 返回 `true`：打开插件 UI
- 返回 `false`：不打开 UI（操作已在回调中完成）

### 完整 MainPush 示例

```ts
// manifest.json
{
  "features": [{
    "code": "translate",
    "explain": "翻译",
    "mainPush": true,
    "cmds": [{ "type": "over", "label": "翻译选中文本", "minLength": 1 }]
  }]
}

// src/main.ts
module.exports = {
  async run(context) {
    const { features } = context.api;

    features.onMainPush(async (action) => {
      const result = await translate(action.payload);
      return [{
        title: result.translation,
        text: `${action.payload} → ${result.translation}`
      }];
    });

    features.onMainPushSelect(async (action) => {
      await context.api.clipboard.writeText(action.option.title);
      await context.api.notification.show('已复制翻译结果');
      return false; // 不打开 UI
    });
  }
};
```

> 注意：`onMainPush` 在插件后端注册，插件 Host 必须正在运行才能响应搜索推送。推荐在后台插件中使用。

---

#### redirectHotKeySetting
[Backend]

```ts
features.redirectHotKeySetting(cmdLabel: string, autocopy?: boolean): Promise<void>
```

跳转到 Mulby 的「设置 -> 快捷键 -> 指令快捷键」区域，并优先高亮/过滤 `cmdLabel` 对应指令，便于用户直接绑定全局快捷键。

说明：

- `autocopy` 参数为兼容字段，当前仅用于保留签名，不影响行为。
- 指令快捷键当前仅支持功能指令（`keyword`）绑定。

#### redirectAiModelsSetting
[Backend]

```ts
features.redirectAiModelsSetting(): Promise<void>
```

当前会弹出提示通知，为保留接口。
