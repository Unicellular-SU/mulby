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
    // macOS 特有格式 - NSFilenamesPboardType 返回 XML plist
    if (process.platform === 'darwin') {
      const nsFiles = clipboard.read('NSFilenamesPboardType')
      if (nsFiles) {
        // 解析 XML plist 格式，提取 <string> 标签中的路径
        const pathMatches = nsFiles.match(/<string>([^<]+)<\/string>/g)
        if (pathMatches && pathMatches.length > 0) {
          const paths = pathMatches
            .map(match => match.replace(/<\/?string>/g, ''))
            .filter(path => path.startsWith('/'))
          if (paths.length > 0) {
            return paths.map(filePath => getFileInfo(filePath))
          }
        }
      }
    }

    // 尝试 text/uri-list
    const uriList = clipboard.read('text/uri-list')
    if (uriList) {
      const filePaths = uriList
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('file://'))
        .map(uri => decodeURIComponent(uri.replace('file://', '')))
      if (filePaths.length > 0) {
        return filePaths.map(filePath => getFileInfo(filePath))
      }
    }

    return []
  })

  // 获取剪贴板格式
  ipcMain.handle('clipboard:getFormat', () => {
    const formats = clipboard.availableFormats()

    // macOS 特有格式检测
    if (process.platform === 'darwin') {
      // 读取各种 macOS 格式
      const publicFileUrl = clipboard.read('public.file-url')
      const promisedFileUrl = clipboard.read('com.apple.pasteboard.promised-file-url')
      const nsFilenames = clipboard.read('NSFilenamesPboardType')

      // 检查 public.file-url
      if (publicFileUrl && publicFileUrl.startsWith('file://')) {
        return 'files'
      }

      // 检查 promised-file-url
      if (promisedFileUrl && promisedFileUrl.startsWith('file://')) {
        return 'files'
      }

      // 检查 NSFilenamesPboardType
      if (nsFilenames) {
        try {
          const paths = JSON.parse(nsFilenames) as string[]
          if (paths.length > 0) return 'files'
        } catch {
          // 不是 JSON 格式，可能是其他格式
          if (nsFilenames.includes('/')) return 'files'
        }
      }

      // 启发式检测：如果有 text/uri-list 格式且 text/plain 看起来像文件名
      const textPlain = clipboard.readText()
      if (formats.includes('text/uri-list') && textPlain &&
        !textPlain.includes('\n') &&
        textPlain.match(/\.\w{2,5}$/)) {
        return 'files'
      }
    }

    // 检查 text/plain 是否包含文件路径
    const textPlainForPath = clipboard.readText()
    if (textPlainForPath && (textPlainForPath.startsWith('/') || textPlainForPath.startsWith('file://'))) {
      const path = textPlainForPath.startsWith('file://')
        ? decodeURIComponent(textPlainForPath.replace('file://', ''))
        : textPlainForPath
      try {
        statSync(path.split('\n')[0].trim())
        return 'files'
      } catch {
        // 不是有效路径，继续其他检测
      }
    }

    // 通用检查 text/uri-list
    if (formats.includes('text/uri-list')) {
      const uriList = clipboard.read('text/uri-list')
      if (uriList && uriList.split('\n').some(line => line.trim().startsWith('file://'))) {
        return 'files'
      }
    }

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
