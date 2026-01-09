import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'

export class PluginStorage {
  private storageDir: string

  constructor() {
    this.storageDir = join(app.getPath('userData'), 'plugin-data')
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true })
    }
  }

  // 获取插件存储文件路径
  private getFilePath(pluginName: string): string {
    return join(this.storageDir, `${pluginName}.json`)
  }

  // 读取插件的所有数据
  private readPluginData(pluginName: string): Record<string, unknown> {
    const filePath = this.getFilePath(pluginName)
    if (!existsSync(filePath)) {
      return {}
    }
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
      return {}
    }
  }

  // 保存插件的所有数据
  private writePluginData(pluginName: string, data: Record<string, unknown>): void {
    const filePath = this.getFilePath(pluginName)
    writeFileSync(filePath, JSON.stringify(data, null, 2))
  }

  // 获取数据
  get(pluginName: string, key: string): unknown {
    const data = this.readPluginData(pluginName)
    return data[key]
  }

  // 设置数据
  set(pluginName: string, key: string, value: unknown): void {
    const data = this.readPluginData(pluginName)
    data[key] = value
    this.writePluginData(pluginName, data)
  }

  // 删除数据
  remove(pluginName: string, key: string): void {
    const data = this.readPluginData(pluginName)
    delete data[key]
    this.writePluginData(pluginName, data)
  }

  // 清空插件所有数据
  clear(pluginName: string): void {
    const filePath = this.getFilePath(pluginName)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  }

  // 获取所有键
  keys(pluginName: string): string[] {
    const data = this.readPluginData(pluginName)
    return Object.keys(data)
  }
}
