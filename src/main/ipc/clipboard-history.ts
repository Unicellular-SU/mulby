import { ipcMain } from 'electron'
import { ClipboardHistoryManager } from '../services/clipboard-history'
import { permissionManager } from '../plugin/permission-manager'

function assertClipboardPermission(sender: Electron.WebContents): void {
  permissionManager.ensureCallerAccessPluginPermissions(sender, ['clipboard'])
}

export function registerClipboardHistoryHandlers(historyManager: ClipboardHistoryManager) {
  // 查询历史记录
  ipcMain.handle('clipboardHistory:query', (event, options: {
    type?: 'text' | 'image' | 'files'
    search?: string
    favorite?: boolean
    limit?: number
    offset?: number
  }) => {
    assertClipboardPermission(event.sender)
    return historyManager.query(options)
  })

  // 获取单条记录
  ipcMain.handle('clipboardHistory:get', (event, id: string) => {
    assertClipboardPermission(event.sender)
    const items = historyManager.query({ limit: 1 })
    return items.find(item => item.id === id) || null
  })

  // 复制历史记录到剪贴板
  ipcMain.handle('clipboardHistory:copy', async (event, id: string) => {
    assertClipboardPermission(event.sender)
    const items = historyManager.query({ limit: 1000 })
    const item = items.find(i => i.id === id)

    if (!item) return { success: false, error: 'Item not found' }

    try {
      if (item.type === 'text') {
        const { clipboard } = await import('electron')
        clipboard.writeText(item.content)
      } else if (item.type === 'image') {
        const { clipboard, nativeImage } = await import('electron')
        const base64 = item.content.replace(/^data:image\/\w+;base64,/, '')
        const buffer = Buffer.from(base64, 'base64')
        const image = nativeImage.createFromBuffer(buffer)
        clipboard.writeImage(image)
      } else if (item.type === 'files' && item.files) {
        // 文件复制需要特殊处理
        const { clipboard } = await import('electron')
        if (process.platform === 'darwin') {
          const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${item.files.map(p => `    <string>${p}</string>`).join('\n')}
</array>
</plist>`
          clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist))
        }
      }

      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 切换收藏
  ipcMain.handle('clipboardHistory:toggleFavorite', (event, id: string) => {
    assertClipboardPermission(event.sender)
    historyManager.toggleFavorite(id)
    return { success: true }
  })

  // 删除记录
  ipcMain.handle('clipboardHistory:delete', (event, id: string) => {
    assertClipboardPermission(event.sender)
    historyManager.delete(id)
    return { success: true }
  })

  // 清空历史
  ipcMain.handle('clipboardHistory:clear', (event) => {
    assertClipboardPermission(event.sender)
    historyManager.clear()
    return { success: true }
  })

  // 获取统计信息
  ipcMain.handle('clipboardHistory:stats', (event) => {
    assertClipboardPermission(event.sender)
    const all = historyManager.query({ limit: 10000 })
    const text = all.filter(i => i.type === 'text').length
    const image = all.filter(i => i.type === 'image').length
    const files = all.filter(i => i.type === 'files').length
    const favorite = all.filter(i => i.favorite).length

    return {
      total: all.length,
      text,
      image,
      files,
      favorite
    }
  })
}
