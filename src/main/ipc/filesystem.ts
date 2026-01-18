import { ipcMain } from 'electron'
import { PluginFilesystem } from '../plugin/filesystem'

const pluginFilesystem = new PluginFilesystem()

export function registerFilesystemHandlers() {
    // 读取文件
    ipcMain.handle('filesystem:readFile', async (_, path: string, encoding?: 'utf-8' | 'base64') => {
        return pluginFilesystem.readFile(path, encoding)
    })

    // 写入文件
    ipcMain.handle('filesystem:writeFile', async (_, path: string, data: string | Buffer | ArrayBuffer, encoding?: 'utf-8' | 'base64') => {
        pluginFilesystem.writeFile(path, data, encoding)
    })

    // 检查文件是否存在
    ipcMain.handle('filesystem:exists', async (_, path: string) => {
        return pluginFilesystem.exists(path)
    })

    // 删除文件
    ipcMain.handle('filesystem:unlink', async (_, path: string) => {
        pluginFilesystem.unlink(path)
    })

    // 读取目录
    ipcMain.handle('filesystem:readdir', async (_, path: string) => {
        return pluginFilesystem.readdir(path)
    })

    // 创建目录
    ipcMain.handle('filesystem:mkdir', async (_, path: string) => {
        pluginFilesystem.mkdir(path)
    })

    // 获取文件信息
    ipcMain.handle('filesystem:stat', async (_, path: string) => {
        return pluginFilesystem.stat(path)
    })

    // 复制文件
    ipcMain.handle('filesystem:copy', async (_, src: string, dest: string) => {
        pluginFilesystem.copy(src, dest)
    })

    // 移动/重命名文件
    ipcMain.handle('filesystem:move', async (_, src: string, dest: string) => {
        pluginFilesystem.move(src, dest)
    })
}

