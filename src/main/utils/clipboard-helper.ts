/**
 * 剪贴板工具函数
 *
 * 提供跨平台的剪贴板内容解析能力，供超级面板和剪贴板历史等模块共用。
 * - readClipboardFiles(): 从系统剪贴板读取文件路径列表（macOS / Windows / Linux）
 * - getClipboardFormat(): 检测剪贴板当前内容格式
 */

import { clipboard } from 'electron'
import log from 'electron-log'

/**
 * 检测剪贴板当前内容的数据格式
 *
 * 优先级：files > image > text > empty
 */
export function getClipboardFormat(): 'text' | 'image' | 'files' | 'empty' {
  const formats = clipboard.availableFormats()

  // macOS: 检查文件格式（优先级最高）
  if (process.platform === 'darwin') {
    const fileUrl = clipboard.read('public.file-url')
    if (fileUrl && fileUrl.startsWith('file://')) {
      return 'files'
    }
    if (formats.includes('NSFilenamesPboardType')) {
      return 'files'
    }
  } else {
    // Windows/Linux
    if (formats.includes('text/uri-list') || formats.some(f => f.includes('FileNameW'))) {
      return 'files'
    }
  }

  // 检查图片（第二优先级）
  if (!clipboard.readImage().isEmpty()) {
    return 'image'
  }

  // 检查文本（最后）
  const text = clipboard.readText()
  if (text && text.trim()) {
    return 'text'
  }

  return 'empty'
}

/**
 * 从系统剪贴板读取文件路径列表
 *
 * 跨平台适配：
 * - macOS: 通过 public.file-url / NSFilenamesPboardType 读取
 * - Windows: 通过 FileNameW buffer 读取
 * - Linux: 通过 text/uri-list 读取
 */
export function readClipboardFiles(): string[] {
  try {
    // macOS: 通过 file URL 读取
    if (process.platform === 'darwin') {
      const rawFiles = clipboard.read('public.file-url')
      if (rawFiles) {
        const filePath = decodeURIComponent(rawFiles.replace('file://', ''))

        // macOS 使用 /.file/id= 格式，需要转换为真实路径
        if (filePath.startsWith('/.file/id=')) {
          // 尝试从 text/uri-list 获取真实路径
          const formats = clipboard.availableFormats()
          if (formats.includes('text/uri-list')) {
            const uriList = clipboard.read('text/uri-list')
            if (uriList) {
              const uris = uriList.split('\n').filter(u => u.trim())
              const realPaths = uris.map(uri => {
                const decoded = decodeURIComponent(uri.replace('file://', ''))
                return decoded
              }).filter(p => p && !p.startsWith('/.file/id='))

              if (realPaths.length > 0) {
                return realPaths
              }
            }
          }

          // 如果无法解析，尝试使用 NSFilenamesPboardType
          try {
            const nsFiles = clipboard.read('NSFilenamesPboardType')
            if (nsFiles) {
              // NSFilenamesPboardType 返回 plist 格式
              const matches = nsFiles.match(/<string>(.*?)<\/string>/g)
              if (matches) {
                const paths = matches.map(m => m.replace(/<\/?string>/g, ''))
                return paths
              }
            }
          } catch {
            // 忽略错误
          }
        }

        return filePath ? [filePath] : []
      }
    }

    // Linux: 通过 text/uri-list 读取（文件管理器复制文件时使用此格式）
    if (process.platform === 'linux') {
      const formats = clipboard.availableFormats()
      if (formats.includes('text/uri-list')) {
        const uriList = clipboard.read('text/uri-list')
        if (uriList) {
          const paths = uriList
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('file://'))
            .map(uri => decodeURIComponent(uri.replace('file://', '')))
            .filter(p => p.length > 0)
          if (paths.length > 0) {
            return paths
          }
        }
      }
    }

    // Windows: 通过 FileNameW buffer 读取
    if (process.platform === 'win32') {
      const rawFilePaths = clipboard.readBuffer('FileNameW')
      if (rawFilePaths && rawFilePaths.length > 0) {
        const paths = rawFilePaths.toString('ucs2').replace(/\0+$/, '').split('\0')
        return paths.filter(p => p && p.trim())
      }
    }
  } catch (err) {
    log.error('[ClipboardHelper] 读取剪贴板文件失败:', err)
  }

  return []
}
