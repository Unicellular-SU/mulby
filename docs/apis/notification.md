# 通知 API (notification)
本文档描述 通知 API (notification) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.notification`
> - 插件后端：`context.api.notification`

插件必须在 `manifest.json` 中声明通知权限：

```json
{
  "permissions": {
    "notification": true
  }
}
```

未声明时宿主会拦截调用并抛出 `Plugin "<pluginId>" lacks manifest.permissions.notification`。

### show(message, type?)
[Renderer] [Backend]
显示系统通知（仅当 `type === 'error'` 时不静音）。

```javascript
await notification.show('操作成功');
await notification.show('发生错误', 'error');
```

**参数**:
- `message` (string) - 通知内容
- `type` (string, 可选) - 仅当为 `error` 时通知不静音，其余值仅用于语义标记

### 完整示例

```javascript
window.mulby.await notification.show('操作完成');
```
