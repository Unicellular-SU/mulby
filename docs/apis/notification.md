## 2. 通知 API (notification)

### 2.1 show(message, type?)
显示系统通知。

```javascript
notification.show('操作成功');
notification.show('发生错误', 'error');
```

**参数**:
- `message` (string) - 通知内容
- `type` (string, 可选) - 通知类型: info | success | warning | error
