import { net } from 'electron'

export class PluginNetwork {
  /**
   * 检查是否在线
   */
  isOnline(): boolean {
    return net.isOnline()
  }
}

export const pluginNetwork = new PluginNetwork()
