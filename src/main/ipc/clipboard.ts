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
  ipcMain.handle('clipboard:writeImage', (_, image: string | Buffer) => {
    try {
      let nativeImg: Electron.NativeImage

      if (Buffer.isBuffer(image)) {
        nativeImg = nativeImage.createFromBuffer(image)
      } else if (typeof image === 'string') {
        if (image.startsWith('data:image')) {
          nativeImg = nativeImage.createFromDataURL(image)
        } else {
          nativeImg = nativeImage.createFromPath(image)
        }
      } else {
        throw new Error('Invalid image format')
      }

      if (nativeImg && !nativeImg.isEmpty()) {
        clipboard.writeImage(nativeImg)
        return true
      }
      return false
    } catch (e) {
      console.error('Failed to write image to clipboard:', e)
      return false
    }
  })

  // 写入文件
  ipcMain.handle('clipboard:writeFiles', (_, filePaths: string | string[]) => {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
    if (paths.length === 0) return false

    if (process.platform === 'darwin') {
      // macOS 使用 NSFilenamesPboardType
      // 需要构造 XML plist 格式
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${paths.map(p => `    <string>${p}</string>`).join('\n')}
</array>
</plist>`
      clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist))
      return true
    } else if (process.platform === 'win32') {
      // Windows 使用 file-list 格式 (CF_HDROP 对应的 buffer 比较复杂，Electron 暂未原生支持简单的 writeFiles)
      // 这里的 hack 方式是尝试通过 Buffer 写入，但 Electron 只有 writeBuffer custom format
      // 实际上 Electron 的 clipboard.writeBuffer 在 Windows 上支持 'FileNameW' 可能有限
      // 更兼容的方式是使用 nativeImage empty + writeFiles (Electron v20+ 有 clipboard.write({files: []}) 但我们需要检查版本)

      // 检查 Electron 版本是否支持 clipboard.write({ files }) 
      // (Electron 20+ 支持)
      // @ts-ignore
      if (clipboard.write && typeof clipboard.write === 'function') {
        // @ts-ignore
        clipboard.write({ files: paths })
        return true
      }
    } else {
      // Linux (X11/Wayland) - text/uri-list
      const uriList = paths.map(p => `file://${p}`).join('\n')
      clipboard.writeBuffer('text/uri-list', Buffer.from(uriList))
      return true
    }
    return false
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
