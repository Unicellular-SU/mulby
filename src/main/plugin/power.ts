import { powerMonitor } from 'electron'

export type PowerState = 'on-ac' | 'on-battery' | 'unknown'

export class PluginPowerMonitor {
  /**
   * 获取系统空闲时间（秒）
   */
  getSystemIdleTime(): number {
    return powerMonitor.getSystemIdleTime()
  }

  /**
   * 获取当前系统空闲状态
   */
  getSystemIdleState(idleThreshold: number): 'active' | 'idle' | 'locked' | 'unknown' {
    return powerMonitor.getSystemIdleState(idleThreshold)
  }

  /**
   * 获取当前是否使用电池供电
   */
  isOnBatteryPower(): boolean {
    return powerMonitor.isOnBatteryPower()
  }

  /**
   * 获取当前热状态 (macOS)
   */
  getCurrentThermalState(): 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical' {
    if (process.platform === 'darwin') {
      return powerMonitor.getCurrentThermalState()
    }
    return 'unknown'
  }
}

export const pluginPowerMonitor = new PluginPowerMonitor()
