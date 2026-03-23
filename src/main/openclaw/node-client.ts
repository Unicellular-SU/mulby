/**
 * OpenClaw Node WebSocket 客户端
 *
 * 核心模块，处理：
 * - WebSocket 连接生命周期（connect/reconnect/disconnect）
 * - Gateway Protocol v3 握手（connect → hello-ok / pairing）
 * - invoke 帧分派到 CommandRegistry
 * - 心跳保持（tick interval）
 * - 连接状态管理与事件广播
 * - 指数退避自动重连
 */

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import WebSocket from 'ws'
import type {
  NodeConnectParams,
  GatewayFrame,
  GatewayRequest,
  GatewayResponse,
  NodeConnectionStatus,
  NodeStatusInfo
} from '../../shared/types/openclaw-protocol'
import type { OpenClawSettings } from '../../shared/types/settings'
import { CommandRegistry } from './command-registry'
import { evaluateExecPolicy, askUserApproval } from './exec-approval'
import { getDeviceIdentity, signChallenge } from './device-identity'
import { openclawLogger as log } from './logger'

// ==================== 常量 ====================

/** Gateway Protocol 版本 */
const PROTOCOL_VERSION = 3



/** 自动重连相关 */
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const RECONNECT_BACKOFF_FACTOR = 2


// ==================== 事件类型 ====================

export interface NodeClientEvents {
  statusChanged: (status: NodeStatusInfo) => void
  error: (error: Error) => void
  invoked: (command: string, success: boolean) => void
}

// ==================== 客户端实现 ====================

export class OpenClawNodeClient extends EventEmitter {
  private ws: WebSocket | null = null
  private settings: OpenClawSettings | null = null
  private registry: CommandRegistry
  private tickTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private status: NodeConnectionStatus = 'disconnected'
  private connectedAt: number | null = null
  private lastError: string | null = null
  private intentionalDisconnect = false
  /** gateway connect.challenge nonce（握手前需等待） */
  private challengeNonce: string | null = null
  private pendingRequests = new Map<string, {
    resolve: (value: GatewayResponse) => void
    timer: NodeJS.Timeout
  }>()

  /** 外部依赖：保存 device token 到 settings */
  private saveDeviceToken: ((token: string) => void) | null = null

  constructor(registry: CommandRegistry) {
    super()
    this.registry = registry
  }

  // ==================== 公开 API ====================

  /** 设置保存 device token 的回调 */
  setSaveDeviceTokenCallback(callback: (token: string) => void): void {
    this.saveDeviceToken = callback
  }

  /** 连接到 OpenClaw Gateway */
  async connect(settings: OpenClawSettings): Promise<void> {
    // 清除待定重连 timer，避免手动 connect 与自动重连竞态导致双 socket
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.status === 'connected' || this.status === 'connecting') {
      return
    }

    this.settings = settings
    this.intentionalDisconnect = false
    this.reconnectAttempt = 0

    await this.doConnect()
  }

  /** 断开连接 */
  disconnect(): void {
    this.intentionalDisconnect = true
    this.clearTimers()
    this.closeWebSocket()
    this.updateStatus('disconnected')
  }

  /**
   * 热更新设置（不重连）
   *
   * 当用户变更安全策略（execMode / exposePlugins 等）时，
   * 即时刷新到当前活跃会话，无需重连。
   * 若 enabled=false，主动断连。
   */
  updateSettings(settings: OpenClawSettings): void {
    this.settings = settings

    // 如果用户关闭了 OpenClaw，主动断连 + 取消排队中的重连
    if (!settings.enabled) {
      this.clearTimers()
      if (this.status === 'connected' || this.status === 'connecting' || this.status === 'pairing') {
        this.disconnect()
      }
    }
  }

  /** 获取当前状态 */
  getStatus(): NodeStatusInfo {
    return {
      status: this.status,
      gatewayHost: this.settings?.gateway.host,
      gatewayPort: this.settings?.gateway.port,
      nodeId: getDeviceIdentity().id,
      displayName: this.settings?.node.displayName,
      connectedAt: this.connectedAt ?? undefined,
      error: this.lastError ?? undefined,
      reconnectAttempt: this.reconnectAttempt > 0 ? this.reconnectAttempt : undefined
    }
  }

  /** 测试 Gateway 连通性 */
  async testConnection(settings: OpenClawSettings): Promise<{ ok: boolean; error?: string }> {
    const url = this.buildWebSocketUrl(settings.gateway)
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(url, { handshakeTimeout: 5000 })
        const timeout = setTimeout(() => {
          ws.terminate()
          resolve({ ok: false, error: '连接超时' })
        }, 5000)

        ws.on('open', () => {
          clearTimeout(timeout)
          ws.close()
          resolve({ ok: true })
        })
        ws.on('error', (err: Error) => {
          clearTimeout(timeout)
          resolve({ ok: false, error: err.message })
        })
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
  }

  /** 销毁客户端（app 退出时调用） */
  destroy(): void {
    this.disconnect()
    this.removeAllListeners()
  }

  // ==================== 内部实现 ====================

  private async doConnect(): Promise<void> {
    if (!this.settings) return

    this.updateStatus('connecting')
    const url = this.buildWebSocketUrl(this.settings.gateway)

    try {
      const ws = new WebSocket(url)
      this.ws = ws

      ws.on('open', () => {
        log.info('WS', 'WebSocket 连接已打开，等待 connect.challenge...')
        // 不立即发 connect，等待 gateway 发送 connect.challenge 事件
      })

      ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data)
      })

      ws.on('close', (code: number, reason: Buffer) => {
        log.info('WS', `WebSocket 连接已关闭 code=${code} reason=${reason.toString()}`)
        this.handleDisconnect()
      })

      ws.on('error', (err: Error) => {
        // 仅记录日志，不通过 emit('error') 冒泡
        // EventEmitter 没有 error listener 时 emit error 会抛出未捕获异常导致 Electron 崩溃
        log.error('WS', `WebSocket 错误: ${err.message}`)
        this.lastError = err.message
      })
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.updateStatus('error')
      this.scheduleReconnect()
    }
  }

  /** 处理 gateway 发送的 connect.challenge 事件 */
  private handleConnectChallenge(frame: GatewayFrame): void {
    const payload = (frame as unknown as Record<string, unknown>).payload as { nonce?: string; ts?: number } | undefined
    if (!payload?.nonce) {
      log.warn('握手', 'connect.challenge 缺少 nonce')
      this.lastError = 'connect.challenge 缺少 nonce'
      this.updateStatus('error')
      return
    }
    this.challengeNonce = payload.nonce
    log.info('握手', '收到 connect.challenge，执行握手签名...')
    void this.performHandshake()
  }

  /** 执行 Gateway Protocol 握手（需先收到 challenge nonce） */
  private async performHandshake(): Promise<void> {
    if (!this.ws || !this.settings || !this.challengeNonce) return

    const identity = getDeviceIdentity()
    const security = this.settings.security
    const platform = process.platform === 'darwin' ? 'macos'
      : process.platform === 'win32' ? 'windows'
      : process.platform
    const deviceFamily = 'desktop'

    // Server 端用 auth.token ?? auth.deviceToken ?? auth.bootstrapToken ?? null
    // 来构建签名验证 payload，我们必须保持一致
    const signatureToken = this.settings.auth.token || this.settings.auth.deviceToken || null

    // 对 challenge nonce 进行 Ed25519 签名（v3 payload 格式）
    // 参数必须与 connect params 中的值完全对应
    const { signature, signedAt } = signChallenge({
      nonce: this.challengeNonce,
      deviceId: identity.id,
      clientId: 'node-host',
      clientMode: 'node',
      role: 'node',
      scopes: [],
      token: signatureToken ?? '',
      platform,
      deviceFamily
    })

    const connectParams: NodeConnectParams = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: 'node-host',
        displayName: this.settings.node.displayName || 'Mulby Desktop',
        version: app.getVersion(),
        platform,
        mode: 'node',
        deviceFamily
      },
      role: 'node',
      scopes: [],
      caps: this.registry.getConnectCaps(security),
      commands: this.registry.getConnectCommands(security),
      permissions: this.registry.getConnectPermissions(security),
      auth: {
        token: this.settings.auth.token || undefined,
        deviceToken: this.settings.auth.deviceToken || undefined
      },
      locale: app.getLocale(),
      userAgent: `Mulby/${app.getVersion()} (${process.platform}; ${process.arch})`,
      device: {
        id: identity.id,
        publicKey: identity.publicKey,
        signature,
        signedAt,
        nonce: this.challengeNonce
      }
    }

    this.sendFrame({
      type: 'req',
      id: randomUUID(),
      method: 'connect',
      params: connectParams as unknown as Record<string, unknown>
    })
  }

  /** 处理收到的消息 */
  private handleMessage(rawData: WebSocket.Data): void {
    let frame: GatewayFrame
    try {
      frame = JSON.parse(rawData.toString()) as GatewayFrame
    } catch {
      log.warn('WS', '收到无效 JSON 帧')
      return
    }

    switch (frame.type) {
      case 'res':
        this.handleResponse(frame as GatewayResponse)
        break
      case 'req':
        this.handleRequest(frame as GatewayRequest)
        break
      case 'event':
        // connect.challenge 是特殊事件，在握手前收到
        if ((frame as unknown as Record<string, unknown>).event === 'connect.challenge') {
          this.handleConnectChallenge(frame)
        } else {
          this.handleEvent(frame)
        }
        break
      default:
        log.warn('WS', `未知帧类型: ${(frame as Record<string, unknown>).type}`)
    }
  }

  /** 处理 Gateway 响应帧 */
  private handleResponse(frame: GatewayResponse): void {
    // 检查是否是 hello-ok（connect 的响应）
    const pending = this.pendingRequests.get(frame.id)
    if (pending) {
      clearTimeout(pending.timer)
      this.pendingRequests.delete(frame.id)
      pending.resolve(frame)
      return
    }

    // 可能是 connect 的未跟踪响应（hello-ok）
    if (frame.ok && frame.payload) {
      const payload = frame.payload
      if ('protocol' in payload) {
        // hello-ok
        log.info('握手', `握手成功，协议版本 v${payload.protocol}`)

        // 保存 device token
        const auth = payload.auth as { deviceToken?: string } | undefined
        if (auth?.deviceToken && this.saveDeviceToken) {
          this.saveDeviceToken(auth.deviceToken)
        }

        // 检查是否需要配对
        if (payload.requiresPairing) {
          log.info('握手', '等待 Gateway 管理员批准配对...')
          this.updateStatus('pairing')
          return
        }

        this.connectedAt = Date.now()
        this.reconnectAttempt = 0
        this.lastError = null
        this.updateStatus('connected')
        this.startTick()
        return
      }
    }

    if (!frame.ok && frame.error) {
      log.error('响应', `Gateway 返回错误: [${frame.error.code}] ${frame.error.message}`)

      // NOT_PAIRED: 需要管理员在 Gateway 端批准配对
      if (frame.error.code === 'NOT_PAIRED') {
        this.lastError = '需要在 OpenClaw Gateway 端批准设备配对'
        this.updateStatus('pairing')
        return
      }

      this.lastError = `[${frame.error.code}] ${frame.error.message}`

      // 认证失败不重试
      if (frame.error.code === 'AUTH_TOKEN_MISMATCH') {
        this.updateStatus('error')
        this.closeWebSocket()
        return
      }
    }
  }

  /** 处理 Gateway 请求帧（tick 等） */
  private async handleRequest(frame: GatewayRequest): Promise<void> {
    if (frame.method === 'invoke') {
      // 后备路径：如果 Gateway 也会送 req 类型的 invoke
      log.debug('Invoke', `收到 req 类型 invoke: ${JSON.stringify(frame.params)}`)
      await this.handleInvoke(frame)
      return
    }

    if (frame.method === 'tick') {
      this.sendFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: { ts: Date.now() }
      })
      return
    }

    // 未知方法
    log.warn('Request', `未知方法: ${frame.method}`)
    this.sendFrame({
      type: 'res',
      id: frame.id,
      ok: false,
      error: { code: 'UNKNOWN_METHOD', message: `未知方法: ${frame.method}` }
    })
  }

  /** 处理 invoke 命令 */
  private async handleInvoke(frame: GatewayRequest): Promise<void> {
    const params = frame.params || {}
    const command = String(params.command || '')
    const commandParams = (params.params || {}) as Record<string, unknown>

    if (!command) {
      this.sendFrame({
        type: 'res',
        id: frame.id,
        ok: false,
        error: { code: 'INVALID_COMMAND', message: '命令名称不能为空' }
      })
      return
    }

    // 检查命令是否在安全配置下可用
    if (this.settings && !this.registry.isCommandAllowed(command, this.settings.security)) {
      this.sendFrame({
        type: 'res',
        id: frame.id,
        ok: false,
        error: { code: 'COMMAND_NOT_ALLOWED', message: `命令 ${command} 不可用` }
      })
      this.emit('invoked', command, false)
      return
    }

    // 检查 exec approval（仅限 system.run 等需要审批的命令）
    if (this.settings && this.registry.requiresApproval(command)) {
      const policy = evaluateExecPolicy(
        { command: String(commandParams.command || command), args: commandParams.args as string[] },
        this.settings.security
      )

      if (policy === 'deny') {
        this.sendFrame({
          type: 'res',
          id: frame.id,
          ok: false,
          error: { code: 'EXEC_DENIED', message: '命令执行被安全策略拒绝' }
        })
        this.emit('invoked', command, false)
        return
      }

      if (policy === 'ask') {
        const decision = await askUserApproval({
          command: String(commandParams.command || command),
          args: commandParams.args as string[],
          rawCommand: commandParams.rawCommand as string
        })

        if (decision === 'deny') {
          this.sendFrame({
            type: 'res',
            id: frame.id,
            ok: false,
            error: { code: 'EXEC_DENIED_BY_USER', message: '用户拒绝了执行请求' }
          })
          this.emit('invoked', command, false)
          return
        }
      }
    }

    // 查找并执行命令
    const handler = this.registry.getHandler(command)
    if (!handler) {
      this.sendFrame({
        type: 'res',
        id: frame.id,
        ok: false,
        error: { code: 'COMMAND_NOT_FOUND', message: `命令 ${command} 未注册` }
      })
      this.emit('invoked', command, false)
      return
    }

    try {
      const result = await handler(commandParams)
      this.sendFrame({
        type: 'res',
        id: frame.id,
        ok: true,
        payload: { data: result } as Record<string, unknown>
      })
      this.emit('invoked', command, true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.sendFrame({
        type: 'res',
        id: frame.id,
        ok: false,
        error: { code: 'EXEC_ERROR', message }
      })
      this.emit('invoked', command, false)
    }
  }

  /** 处理 Gateway 事件帧 */
  private handleEvent(frame: GatewayFrame & { type: 'event' }): void {
    switch (frame.event) {
      case 'device.paired':
        log.info('配对', '设备配对成功')
        this.connectedAt = Date.now()
        this.reconnectAttempt = 0
        this.lastError = null
        this.updateStatus('connected')
        this.startTick()
        break

      case 'node.invoke.request':
        // ⭐ 核心：Gateway 通过 event 帧发送 invoke 请求
        this.handleInvokeEvent(frame)
        break

      case 'exec.approval.requested':
        log.info('审批', '收到执行审批请求')
        break

      default:
        log.debug('事件', `收到事件: ${frame.event}`)
    }
  }

  /**
   * 处理 node.invoke.request 事件
   *
   * Gateway 通过 event 帧发送 invoke 请求，结果通过 node.invoke.result RPC 返回
   * （与 Android 端 GatewaySession.handleInvokeEvent 完全一致）
   */
  private async handleInvokeEvent(frame: GatewayFrame & { type: 'event' }): Promise<void> {
    const payload = (frame as unknown as { payload?: Record<string, unknown> }).payload
    if (!payload) {
      log.warn('Invoke', 'node.invoke.request 缺少 payload')
      return
    }

    const invokeId = String(payload.id || '')
    const nodeId = String(payload.nodeId || '')
    const command = String(payload.command || '')
    const timeoutMs = typeof payload.timeoutMs === 'number' ? payload.timeoutMs : undefined

    // 解析 params：支持 paramsJSON 字符串和 params 对象两种格式
    let commandParams: Record<string, unknown> = {}
    if (typeof payload.paramsJSON === 'string') {
      try { commandParams = JSON.parse(payload.paramsJSON) } catch { /* ignore */ }
    } else if (payload.params && typeof payload.params === 'object') {
      commandParams = payload.params as Record<string, unknown>
    }

    if (!command || !invokeId) {
      log.warn('Invoke', `无效的 invoke 请求: id=${invokeId} command=${command}`)
      return
    }

    log.info('Invoke', `收到命令: ${command}`, JSON.stringify(commandParams))

    // 执行命令
    let resultOk = false
    let resultPayload: unknown = null
    let resultError: { code: string; message: string } | undefined

    try {
      // 检查安全策略
      if (this.settings && !this.registry.isCommandAllowed(command, this.settings.security)) {
        throw Object.assign(new Error(`命令 ${command} 不可用`), { code: 'COMMAND_NOT_ALLOWED' })
      }

      // 检查 exec approval
      if (this.settings && this.registry.requiresApproval(command)) {
        const policy = evaluateExecPolicy(
          { command: String(commandParams.command || command), args: commandParams.args as string[] },
          this.settings.security
        )
        if (policy === 'deny') {
          throw Object.assign(new Error('命令执行被安全策略拒绝'), { code: 'EXEC_DENIED' })
        }
        if (policy === 'ask') {
          const decision = await askUserApproval({
            command: String(commandParams.command || command),
            args: commandParams.args as string[],
            rawCommand: commandParams.rawCommand as string
          })
          if (decision === 'deny') {
            throw Object.assign(new Error('用户拒绝了执行请求'), { code: 'EXEC_DENIED_BY_USER' })
          }
        }
      }

      // 查找并执行 handler
      const handler = this.registry.getHandler(command)
      if (!handler) {
        throw Object.assign(new Error(`命令 ${command} 未注册`), { code: 'COMMAND_NOT_FOUND' })
      }

      resultPayload = await handler(commandParams)
      resultOk = true
      log.info('Invoke', `命令执行成功: ${command}`)
      this.emit('invoked', command, true)
    } catch (err) {
      const errObj = err as Error & { code?: string }
      resultError = {
        code: errObj.code || 'EXEC_ERROR',
        message: errObj.message || String(err)
      }
      log.error('Invoke', `命令执行失败: ${command}`, resultError.message)
      this.emit('invoked', command, false)
    }

    // 通过 node.invoke.result RPC 返回结果
    this.sendInvokeResult(invokeId, nodeId, resultOk, resultPayload, resultError, timeoutMs)
  }

  /** 通过 node.invoke.result RPC 返回 invoke 结果 */
  private sendInvokeResult(
    invokeId: string,
    nodeId: string,
    ok: boolean,
    payload: unknown,
    error?: { code: string; message: string },
    _timeoutMs?: number
  ): void {
    const params: Record<string, unknown> = {
      id: invokeId,
      nodeId,
      ok
    }

    if (payload !== null && payload !== undefined) {
      // 尝试将 payload 作为对象发送，否则作为 payloadJSON 字符串
      if (typeof payload === 'object') {
        params.payload = payload
      } else {
        params.payloadJSON = JSON.stringify(payload)
      }
    }

    if (error) {
      params.error = error
    }

    this.sendFrame({
      type: 'req',
      id: randomUUID(),
      method: 'node.invoke.result',
      params
    })
  }

  /** 发送帧到 Gateway */
  private sendFrame(frame: GatewayFrame): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify(frame))
    } catch (err) {
      log.error('WS', `发送帧失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 构建 WebSocket URL */
  private buildWebSocketUrl(gateway: OpenClawSettings['gateway']): string {
    const protocol = gateway.useTls ? 'wss' : 'ws'
    return `${protocol}://${gateway.host}:${gateway.port}`
  }



  /** 开始心跳（Gateway 通过 server-side tick 事件管理，客户端无需主动发送） */
  private startTick(): void {
    // Gateway 已通过 tick 事件推送心跳，客户端只需保持连接
    this.stopTick()
  }

  /** 停止心跳 */
  private stopTick(): void {
    if (!this.tickTimer) return
    clearInterval(this.tickTimer)
    this.tickTimer = null
  }

  /** 处理断开连接 */
  private handleDisconnect(): void {
    this.closeWebSocket()
    if (!this.intentionalDisconnect) {
      this.updateStatus('disconnected')
      this.scheduleReconnect()
    }
  }

  /** 调度自动重连 */
  private scheduleReconnect(): void {
    if (this.intentionalDisconnect || !this.settings?.node.autoConnect) return

    this.reconnectAttempt++
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(RECONNECT_BACKOFF_FACTOR, this.reconnectAttempt - 1),
      RECONNECT_MAX_MS
    )

    log.info('重连', `将在 ${delay}ms 后尝试第 ${this.reconnectAttempt} 次重连`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.doConnect()
    }, delay)
  }

  /** 关闭 WebSocket */
  private closeWebSocket(): void {
    this.stopTick()
    this.clearPendingRequests()
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.close()
        } else if (this.ws.readyState === WebSocket.CONNECTING) {
          // 连接尚未建立时，terminate() 不会抛异常
          this.ws.terminate()
        }
      } catch {
        // 忽略关闭错误
      }
      this.ws = null
    }
    this.connectedAt = null
  }

  /** 清除所有定时器 */
  private clearTimers(): void {
    this.stopTick()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /** 清除待处理的请求 */
  private clearPendingRequests(): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
    }
    this.pendingRequests.clear()
  }

  /** 更新连接状态并广播 */
  private updateStatus(status: NodeConnectionStatus): void {
    this.status = status
    this.emit('statusChanged', this.getStatus())
  }
}
