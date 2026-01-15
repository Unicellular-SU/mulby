# 动态指令 API (features)

参考 uTools 的「动态指令」概念，InTools 提供可运行时增删功能入口的能力。

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
