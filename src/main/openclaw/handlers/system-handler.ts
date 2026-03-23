/**
 * 标准 Node 命令处理器
 *
 * 实现 OpenClaw Node 规范中的标准命令：
 * - system.run: 远程执行 shell 命令
 * - system.notify: 推送系统通知
 * - device.info: 返回设备信息
 * - device.status: 返回设备状态
 */

import { app, Notification } from 'electron'
import os from 'node:os'
import type { CommandHandler } from '../command-registry'

/** 所需的外部依赖注入 */
export interface SystemHandlerDeps {
  /** 执行 shell 命令（复用 Mulby 的 commandRunnerService） */
  runCommand: (input: {
    command: string
    args?: string[]
    cwd?: string
    shell?: boolean
    timeoutMs?: number
  }, context: {
    source: 'app' | 'plugin'
    pluginId?: string
    runCommandAllowed?: boolean
    allowShellOverride?: boolean
  }) => Promise<unknown>
}

/**
 * 创建标准 system/device 命令处理器
 */
export function createSystemHandlers(deps: SystemHandlerDeps): Record<string, { handler: CommandHandler; cap: string; description: string; requiresExecApproval?: boolean }> {
  return {
    'system.run': {
      cap: 'system',
      description: '在 Mulby 所在机器上执行 shell 命令',
      requiresExecApproval: true,
      handler: async (params) => {
        const command = String(params.command || '').trim()
        if (!command) throw new Error('command is required')
        const args = Array.isArray(params.args) ? params.args.map(String) : undefined
        const cwd = params.cwd ? String(params.cwd) : undefined
        const shell = params.shell !== false
        const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : 30_000

        const result = await deps.runCommand(
          {
            command: shell && args?.length
              ? `${command} ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`
              : command,
            args: shell && args?.length ? undefined : args,
            cwd,
            shell,
            timeoutMs
          },
          { source: 'app', runCommandAllowed: true, allowShellOverride: true }
        ) as { exitCode?: number | null; timedOut?: boolean; success?: boolean; stdout?: string; stderr?: string }

        // 返回 Gateway 期望的标准格式
        return {
          exitCode: result.exitCode ?? null,
          timedOut: result.timedOut ?? false,
          success: result.success ?? false,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          error: null
        }
      }
    },

    'system.notify': {
      cap: 'system',
      description: '在 Mulby 所在机器上推送系统通知',
      handler: async (params) => {
        const title = String(params.title || 'OpenClaw')
        const body = String(params.body || '')

        if (Notification.isSupported()) {
          const notification = new Notification({ title, body })
          notification.show()
        }

        return { ok: true }
      }
    },

    'device.info': {
      cap: 'device',
      description: '获取 Mulby 所在设备的基础信息',
      handler: async () => {
        return {
          hostname: os.hostname(),
          platform: process.platform,
          arch: os.arch(),
          osVersion: os.release(),
          appName: 'Mulby',
          appVersion: app.getVersion(),
          nodeVersion: process.versions.node,
          electronVersion: process.versions.electron
        }
      }
    },

    'device.status': {
      cap: 'device',
      description: '获取 Mulby 所在设备的运行状态',
      handler: async () => {
        return {
          uptime: os.uptime(),
          freeMemory: os.freemem(),
          totalMemory: os.totalmem(),
          cpuUsage: process.cpuUsage(),
          memoryUsage: process.memoryUsage().heapUsed,
          pid: process.pid
        }
      }
    }
  }
}
