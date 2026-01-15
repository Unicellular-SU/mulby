# 动态指令 API (features)

参考 uTools 的「动态指令」概念，InTools 提供可运行时增删功能入口的能力。适用于用户可配置入口、在线内容映射、批量快捷命令等场景。

## 适用场景

- 用户自定义快捷指令（例如：自定义网站快捷打开）
- 运行时根据数据源生成入口（例如：收藏列表、常用模板）
- 插件配置变更后动态刷新入口
- 区分 UI 与后台指令执行方式

## 核心概念

- 动态指令属于插件本身，存储在用户数据目录中。
- 同一 `code` 会覆盖旧配置，适合做“更新式注册”。
- `mode` 决定执行方式：`ui`/`detached` 会打开 UI，`silent` 仅执行后端逻辑。
- `route` 会作为窗口的 hash 传入，便于 UI 内部路由跳转。

## getFeatures

```ts
features.getFeatures(codes?: string[]): DynamicFeature[]
```

- 返回当前插件已注册的动态指令
- 可传入 `codes` 过滤指定功能
- `platform` 字段会自动按当前平台过滤

## setFeature

```ts
features.setFeature(feature: DynamicFeatureInput): void
```

新增或更新动态指令。字段说明：

- `code`: 功能编码（必填）
- `explain`: 说明（可选，默认使用 `code`）
- `icon`: 功能图标（可选）
- `platform`: 指定平台（可选，`string | string[]`）
- `mode`: 指令模式（可选，`'ui' | 'silent' | 'detached'`，默认 `ui`）
- `route`: UI 路由（可选，传给窗口的 hash）
- `mainHide`: InTools 暂未支持（保留字段）
- `mainPush`: InTools 暂未支持（保留字段）
- `cmds`: 指令列表（必填）

`cmds` 支持两种写法：

- 字符串：会被视为 `keyword` 指令
- 对象：使用 InTools 的 `cmd` 结构（`keyword`/`regex`/`files`/`img`/`over`）

## removeFeature

```ts
features.removeFeature(code: string): boolean
```

删除动态指令，返回是否成功删除。

## 使用示例

### 1) 注册 silent 指令（无 UI）

```ts
api.features.setFeature({
  code: 'today',
  explain: '复制今日日期',
  mode: 'silent',
  cmds: ['today', '日期']
})
```

### 2) 注册 UI 指令（附着面板）

```ts
api.features.setFeature({
  code: 'settings',
  explain: '打开设置面板',
  mode: 'ui',
  route: 'settings',
  cmds: ['plugin settings']
})
```

### 3) 注册 detached 指令（独立窗口）

```ts
api.features.setFeature({
  code: 'window',
  explain: '独立窗口打开',
  mode: 'detached',
  route: 'settings',
  cmds: ['plugin window']
})
```

### 4) 清理并刷新指令

```ts
for (const code of ['today', 'settings', 'window']) {
  api.features.removeFeature(code)
}
```

## redirectHotKeySetting

```ts
features.redirectHotKeySetting(cmdLabel: string, autocopy?: boolean): void
```

InTools 暂无快捷键设置界面，目前会提示使用 `shortcut` API 注册快捷键。

## redirectAiModelsSetting

```ts
features.redirectAiModelsSetting(): void
```

InTools 暂无 AI 模型设置界面，为保留接口。
