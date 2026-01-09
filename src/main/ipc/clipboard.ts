import { ipcMain, clipboard, nativeImage } from 'electron'
import { statSync } from 'fs'
import { basename, extname } from 'path'

export function registerClipboardHandlers() {
  // 读取文本
  ipcMain.handle('clipboard:readText', () => {
    return clipboard.readText()
  })

  // 写入文本
  ipcMain.handle('clipboard:writeText', (_, text: string) => {
    clipboard.writeText(text)
  })

  // 读取图片
  ipcMain.handle('clipboard:readImage', () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    return image.toPNG()
  })

  // 写入图片
  ipcMain.handle('clipboard:writeImage', (_, buffer: Buffer) => {
    const image = nativeImage.createFromBuffer(buffer)
    clipboard.writeImage(image)
  })

  // 读取文件列表
  ipcMain.handle('clipboard:readFiles', () => {
    if (process.platform === 'darwin') {
      const files = clipboard.read('NSFilenamesPboardType')
      if (!files) return []
      try {
        const paths = JSON.parse(files) as string[]
        return paths.map(filePath => getFileInfo(filePath))
      } catch {
        return []
      }
    }
    // Windows/Linux
    const files = clipboard.read('text/uri-list')
    if (!files) return []
    return files
      .split('\n')
      .filter(line => line.startsWith('file://'))
      .map(uri => decodeURIComponent(uri.replace('file://', '')))
      .map(filePath => getFileInfo(filePath))
  })

  // 获取剪贴板格式
  ipcMain.handle('clipboard:getFormat', () => {
    if (!clipboard.readImage().isEmpty()) return 'image'
    if (clipboard.readText()) return 'text'
    if (clipboard.readHTML()) return 'html'
    return 'empty'
  })
}

function getFileInfo(filePath: string) {
  try {
    const stat = statSync(filePath)
    return {
      path: filePath,
      name: basename(filePath),
      size: stat.size,
      type: getMimeType(extname(filePath)),
      isDirectory: stat.isDirectory()
    }
  } catch {
    return { path: filePath, name: basename(filePath), size: 0, type: '', isDirectory: false }
  }
}

function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.json': 'application/json'
  }
  return mimeTypes[ext.toLowerCase()] || 'application/octet-stream'
}
