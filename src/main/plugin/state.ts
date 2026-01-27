import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { PluginStateConfig } from '../../shared/types/plugin'

export class PluginStateManager {
  private configPath: string
  private state: PluginStateConfig = {}

  constructor() {
    const configDir = app.getPath('userData')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }
    this.configPath = join(configDir, 'plugin-state.json')
    this.load()
  }

  // 加载状态配置
  private load(): void {
    if (existsSync(this.configPath)) {
      try {
        const content = readFileSync(this.configPath, 'utf-8')
        this.state = JSON.parse(content)
      } catch {
        this.state = {}
      }
    }
  }

  // 保存状态配置
  private save(): void {
    writeFileSync(this.configPath, JSON.stringify(this.state, null, 2))
  }

  // 获取插件状态
  getPluginState(name: string): { enabled: boolean; installedAt?: number; updatedAt?: number; backgroundRunning?: boolean; backgroundStartedAt?: number; backgroundRestartCount?: number } {
    return this.state[name] || { enabled: true }
  }

  // 设置插件启用状态
  setEnabled(name: string, enabled: boolean): void {
    if (!this.state[name]) {
      this.state[name] = { enabled, installedAt: Date.now() }
    } else {
      this.state[name].enabled = enabled
    }
    this.save()
  }

  // 记录插件安装
  recordInstall(name: string): void {
    this.state[name] = {
      enabled: true,
      installedAt: Date.now()
    }
    this.save()
  }

  // 记录插件更新
  recordUpdate(name: string): void {
    if (this.state[name]) {
      this.state[name].updatedAt = Date.now()
    } else {
      this.state[name] = { enabled: true, installedAt: Date.now(), updatedAt: Date.now() }
    }
    this.save()
  }

  // 删除插件状态
  removePluginState(name: string): void {
    delete this.state[name]
    this.save()
  }

  // 获取所有状态
  getAllStates(): PluginStateConfig {
    return { ...this.state }
  }

  // 设置后台运行状态
  setBackgroundRunning(name: string, running: boolean): void {
    if (!this.state[name]) {
      this.state[name] = { enabled: true }
    }
    this.state[name].backgroundRunning = running
    if (running) {
      this.state[name].backgroundStartedAt = Date.now()
    }
    this.save()
  }
}
