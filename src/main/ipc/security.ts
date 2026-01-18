import { ipcMain } from 'electron'
import { createPluginSecurity } from '../plugin/security'

const security = createPluginSecurity()

export function registerSecurityHandlers() {
  // 检查加密是否可用
  ipcMain.handle('security:isEncryptionAvailable', () => {
    return security.isEncryptionAvailable()
  })

  // 加密字符串
  ipcMain.handle('security:encryptString', (_, plainText: string) => {
    return security.encryptString(plainText)
  })

  // 解密字符串
  ipcMain.handle('security:decryptString', (_, encrypted: Buffer | ArrayBuffer) => {
    return security.decryptString(encrypted)
  })
}
