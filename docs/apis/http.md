## 5. 网络 API (http)

### 5.1 request(options)
发起 HTTP 请求。

```javascript
const response = await http.request({
  url: 'https://api.example.com/data',
  method: 'POST',
  headers: { 'Authorization': 'Bearer token' },
  body: { key: 'value' },
  timeout: 5000
});

console.log(response.status);  // 200
console.log(response.data);    // 响应内容
```

**参数** (HttpRequestOptions):
- `url` (string) - 请求地址
- `method` (string, 可选) - 请求方法: GET | POST | PUT | DELETE | PATCH | HEAD，默认 GET
- `headers` (object, 可选) - 请求头
- `body` (string | object, 可选) - 请求体，object 会自动 JSON 序列化
- `timeout` (number, 可选) - 超时时间(毫秒)，默认 30000

**返回值** (HttpResponse):

```typescript
interface HttpResponse {
  status: number;      // HTTP 状态码
  statusText: string;  // 状态描述
  headers: Record<string, string>;  // 响应头
  data: string;        // 响应内容
}
```

### 5.2 get(url, headers?)
GET 请求快捷方法。

```javascript
const response = await http.get('https://api.example.com/users');
const data = JSON.parse(response.data);
```

### 5.3 post(url, body?, headers?)
POST 请求快捷方法。

```javascript
const response = await http.post('https://api.example.com/users', {
  name: 'John',
  email: 'john@example.com'
});
```

### 5.4 put(url, body?, headers?)
PUT 请求快捷方法。

```javascript
const response = await http.put('https://api.example.com/users/1', {
  name: 'John Updated'
});
```

### 5.5 delete(url, headers?)
DELETE 请求快捷方法。

```javascript
const response = await http.delete('https://api.example.com/users/1');
```

### 5.6 完整示例

```javascript
module.exports = {
  async run(context) {
    const { http, notification } = context.api;

    try {
      // 调用翻译 API
      const response = await http.post('https://api.translate.com/v1/translate', {
        text: context.input,
        from: 'zh',
        to: 'en'
      }, {
        'Authorization': 'Bearer YOUR_API_KEY'
      });

      if (response.status === 200) {
        const result = JSON.parse(response.data);
        notification.show('翻译完成: ' + result.translation);
      } else {
        notification.show('翻译失败', 'error');
      }
    } catch (error) {
      notification.show('网络错误', 'error');
    }
  }
};
```
