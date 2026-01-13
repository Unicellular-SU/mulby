import { ipcMain, app } from 'electron'
import fs from 'fs'
import path from 'path'

// 使用用户数据目录下的 storage.json 作为存储文件
const STORAGE_FILE = path.join(app.getPath('userData'), 'storage.json')

// 确保存储文件存在
function ensureStorageFile() {
    if (!fs.existsSync(STORAGE_FILE)) {
        try {
            fs.writeFileSync(STORAGE_FILE, '{}', 'utf-8')
        } catch (error) {
            console.error('[Storage] Failed to create storage file:', error)
        }
    }
}

// 读取存储数据
function readStorage(): Record<string, unknown> {
    ensureStorageFile()
    try {
        const content = fs.readFileSync(STORAGE_FILE, 'utf-8')
        return JSON.parse(content)
    } catch (error) {
        console.error('[Storage] Failed to read storage:', error)
        return {}
    }
}

// 写入存储数据
function writeStorage(data: Record<string, unknown>) {
    try {
        fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
        console.error('[Storage] Failed to write storage:', error)
    }
}

export function registerStorageHandlers() {
    // get: 获取值
    ipcMain.handle('storage:get', (_, key: string) => {
        const data = readStorage()
        return data[key]
    })

    // set: 设置值
    ipcMain.handle('storage:set', (_, key: string, value: unknown) => {
        const data = readStorage()
        data[key] = value
        writeStorage(data)
    })

    // remove: 删除值
    ipcMain.handle('storage:remove', (_, key: string) => {
        const data = readStorage()
        if (key in data) {
            delete data[key]
            writeStorage(data)
        }
    })

    // getAll: 获取所有数据 (可选，用于调试或查看所有存储)
    ipcMain.handle('storage:getAll', () => {
        return readStorage()
    })

    // clear: 清空存储 (慎用)
    ipcMain.handle('storage:clear', () => {
        writeStorage({})
    })
}
