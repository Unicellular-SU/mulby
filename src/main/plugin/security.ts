import { safeStorage } from 'electron'

export class PluginSecurity {
  /**
   * 检查加密是否可用
   */
  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /**
   * 加密字符串
   */
  encryptString(plainText: string): Buffer {
    if (!this.isEncryptionAvailable()) {
      throw new Error('Encryption is not available on this system')
    }
    return safeStorage.encryptString(plainText)
  }

  /**
   * 解密字符串
   */
  decryptString(encrypted: Buffer): string {
    if (!this.isEncryptionAvailable()) {
      throw new Error('Encryption is not available on this system')
    }
    return safeStorage.decryptString(encrypted)
  }
}

export function createPluginSecurity() {
  return new PluginSecurity()
}
