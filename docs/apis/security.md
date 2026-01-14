## 13. Security API (security)

Security API 提供安全的加密存储功能，使用系统级加密（macOS Keychain、Windows DPAPI、Linux Secret Service）。

### 13.1 isEncryptionAvailable()
检查加密功能是否可用。

```javascript
const available = await security.isEncryptionAvailable();
if (!available) {
  console.log('当前系统不支持加密存储');
}
```

**返回值**: `boolean`

### 13.2 encryptString(plainText)
加密字符串。

```javascript
const encrypted = await security.encryptString('my-secret-password');
// 存储 encrypted Buffer
```

**参数**:
- `plainText` (string) - 要加密的明文

**返回值**: `Buffer` - 加密后的数据

### 13.3 decryptString(encrypted)
解密字符串。

```javascript
const decrypted = await security.decryptString(encryptedBuffer);
console.log(decrypted); // 'my-secret-password'
```

**参数**:
- `encrypted` (Buffer) - 加密的数据

**返回值**: `string` - 解密后的明文

### 13.4 完整示例

```javascript
module.exports = {
  async run(context) {
    const { security, storage, notification } = context.api;

    // 检查加密是否可用
    if (!security.isEncryptionAvailable()) {
      notification.show('加密不可用', 'error');
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

    notification.show('API Key 已安全存储');
  }
};
```
