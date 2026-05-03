# Security API (security)
本文档描述 Security API (security) 的使用方法与接口。

> 入口：
> - UI/渲染进程：`window.mulby.security`
> - 插件后端：`context.api.security`

Security API 提供安全的加密存储功能，使用系统级加密（macOS Keychain、Windows DPAPI、Linux Secret Service）。

### isEncryptionAvailable()
[Renderer] [Backend]
检查加密功能是否可用。

```javascript
const available = await security.isEncryptionAvailable();
if (!available) {
  console.log('当前系统不支持加密存储');
}
```

**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）

### encryptString(plainText)
[Renderer] [Backend]
加密字符串。

```javascript
const encrypted = await security.encryptString('my-secret-password');
// 存储 encrypted Buffer
```

**参数**:
- `plainText` (string) - 要加密的明文

**返回值**: `Buffer` - 加密后的数据

### decryptString(encrypted)
[Renderer] [Backend]
解密字符串。

```javascript
const decrypted = await security.decryptString(encryptedBuffer);
console.log(decrypted); // 'my-secret-password'
```

**参数**:
- `encrypted` (Buffer | ArrayBuffer) - 加密的数据

**返回值**: `string`（插件后端返回 `Promise<string>`） - 解密后的明文

### 完整示例

```javascript
module.exports = {
  async run(context) {
    const { security, storage, notification } = context.api;

    // 检查加密是否可用
    if (!security.isEncryptionAvailable()) {
      await notification.show('加密不可用', 'error');
      return;
    }

    // 加密并存储 API Key
    const apiKey = 'sk-xxxxxxxxxxxx';
    const encrypted = security.encryptString(apiKey);
    await storage.set('encrypted_api_key', encrypted.toString('base64'));

    // 读取并解密
    const stored = await storage.get('encrypted_api_key');
    const buffer = Buffer.from(stored, 'base64');
    const decrypted = security.decryptString(buffer);

    await notification.show('API Key 已安全存储');
  }
};
```