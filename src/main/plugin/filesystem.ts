import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
  statSync,
  copyFileSync,
  renameSync
} from 'fs'
import { join, dirname, basename, extname } from 'path'

export interface FileStat {
  name: string
  path: string
  size: number
  isFile: boolean
  isDirectory: boolean
  createdAt: number
  modifiedAt: number
}

export class PluginFilesystem {
  // 读取文件
  readFile(filePath: string, encoding?: 'utf-8' | 'base64'): string | Buffer {
    if (encoding === 'utf-8') {
      return readFileSync(filePath, 'utf-8')
    } else if (encoding === 'base64') {
      return readFileSync(filePath).toString('base64')
    }
    return readFileSync(filePath)
  }

  // 写入文件
  writeFile(filePath: string, data: string | Buffer | ArrayBuffer, encoding?: 'utf-8' | 'base64'): void {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    if (encoding === 'base64' && typeof data === 'string') {
      writeFileSync(filePath, Buffer.from(data, 'base64'))
    } else {
      if (data instanceof ArrayBuffer) {
        writeFileSync(filePath, Buffer.from(data))
      } else {
        writeFileSync(filePath, data as string | NodeJS.ArrayBufferView)
      }
    }
  }

  // 检查文件是否存在
  exists(filePath: string): boolean {
    return existsSync(filePath)
  }

  // 删除文件
  unlink(filePath: string): void {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  }

  // 读取目录
  readdir(dirPath: string): string[] {
    if (!existsSync(dirPath)) {
      return []
    }
    return readdirSync(dirPath)
  }

  // 创建目录
  mkdir(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
    }
  }

  // 获取文件信息
  stat(filePath: string): FileStat | null {
    if (!existsSync(filePath)) {
      return null
    }
    const stats = statSync(filePath)
    return {
      name: basename(filePath),
      path: filePath,
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      createdAt: stats.birthtimeMs,
      modifiedAt: stats.mtimeMs
    }
  }

  // 复制文件
  copy(src: string, dest: string): void {
    const destDir = dirname(dest)
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true })
    }
    copyFileSync(src, dest)
  }

  // 移动/重命名文件
  move(src: string, dest: string): void {
    const destDir = dirname(dest)
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true })
    }
    renameSync(src, dest)
  }

  // 获取文件扩展名
  extname(filePath: string): string {
    return extname(filePath)
  }

  // 拼接路径
  join(...paths: string[]): string {
    return join(...paths)
  }

  // 获取目录名
  dirname(filePath: string): string {
    return dirname(filePath)
  }

  // 获取文件名
  basename(filePath: string, ext?: string): string {
    return basename(filePath, ext)
  }
}
