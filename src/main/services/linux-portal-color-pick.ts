/**
 * linux-portal-color-pick.ts — Linux xdg-desktop-portal 原生取色服务
 *
 * 通过 D-Bus 调用 org.freedesktop.portal.Screenshot.PickColor 方法，
 * 由桌面环境（GNOME/KDE/Hyprland/Sway 等）提供原生取色 UI。
 *
 * 优势：
 *   - 同时兼容 X11 和 Wayland
 *   - 由桌面环境自带后端实现取色 UI（放大镜等），零自定义 UI 代码
 *   - 无需截取全屏快照，无需覆盖窗口
 *
 * 依赖：dbus-next（纯 JS D-Bus 实现，无 native 依赖）
 *
 * codex review 修复:
 *   - [P1] sessionBus() 挂 error listener 防止 D-Bus 连接错误崩溃主进程
 *   - [P1] 使用 AddMatch + _connection 原始消息流订阅信号，
 *          不 introspect 尚未存在的 Request 对象
 *   - [P2] 先订阅 Response 信号再调用 PickColor，防快速 Portal 响应竞态
 *   - [P2] 区分用户取消 vs Portal 失败，后者走 overlay fallback
 */

// dbus-next 类型定义（动态加载，避免在非 Linux 平台报错）
interface DBusMessageBus {
  getProxyObject(name: string, path: string): Promise<DBusProxyObject>
  disconnect(): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

interface DBusProxyObject {
  getInterface(name: string): DBusInterface
}

interface DBusInterface {
  // Portal Screenshot 方法
  PickColor?(parentWindow: string, options: Record<string, unknown>): Promise<string>
  // org.freedesktop.DBus 方法
  AddMatch?(rule: string): Promise<void>
  RemoveMatch?(rule: string): Promise<void>
  // 通用事件方法
  on(event: string, handler: (...args: unknown[]) => void): void
  removeListener(event: string, handler: (...args: unknown[]) => void): void
}

interface DBusVariant {
  value: unknown
}

interface DBusModule {
  sessionBus(): DBusMessageBus
  Variant: new (type: string, value: unknown) => DBusVariant
}

/**
 * D-Bus 原始消息结构（dbus-next 内部格式）
 * 用于在底层连接上过滤 Response 信号
 */
interface DBusRawMessage {
  type: number           // 4 = SIGNAL
  path?: string
  interface?: string
  member?: string
  body?: unknown[]
}

/** dbus-next 底层连接（EventEmitter，emit 'message' 事件） */
interface DBusConnection {
  on(event: string, handler: (...args: unknown[]) => void): void
  removeListener(event: string, handler: (...args: unknown[]) => void): void
}

/** D-Bus 消息类型常量 */
const DBUS_MESSAGE_TYPE_SIGNAL = 4

/**
 * Portal 取色结果类型
 *   - color: 成功取色
 *   - cancelled: 用户主动取消（不应 fallback）
 *   - error: Portal 调用失败（应 fallback 到覆盖窗口）
 */
export interface PortalPickResult {
  type: 'color' | 'cancelled' | 'error'
  r?: number
  g?: number
  b?: number
}

// 缓存 Portal 可用性检测结果
let portalAvailable: boolean | null = null
let dbusModule: DBusModule | null = null

/**
 * 动态加载 dbus-next 模块
 * 仅在 Linux 上实际加载，其他平台返回 null
 */
function loadDBus(): DBusModule | null {
  if (process.platform !== 'linux') return null
  if (dbusModule !== null) return dbusModule

  try {
    dbusModule = require('dbus-next') as DBusModule
    return dbusModule
  } catch (err) {
    console.warn('[PortalColorPick] dbus-next 加载失败:', err)
    dbusModule = null
    return null
  }
}

/**
 * 创建 Session Bus 并挂载 error listener
 *
 * [P1] dbus-next 的 MessageBus 在底层 socket 连接失败时会异步 emit 'error'，
 * 如果不挂 listener，Node.js 会视为 unhandled error 直接终止进程。
 * 这里将 error 转为 rejected Promise，由外层 try/catch 安全处理。
 */
function createSafeSessionBus(dbus: DBusModule): Promise<DBusMessageBus> {
  return new Promise((resolve, reject) => {
    try {
      const bus = dbus.sessionBus()

      // 挂载 error listener 防止未捕获错误崩溃主进程
      bus.on('error', (err: unknown) => {
        console.warn('[PortalColorPick] D-Bus 连接错误:', err)
        reject(err)
      })

      // sessionBus() 是同步创建的，连接在背后异步建立
      // 给一小段时间让可能的立即连接错误先触发
      setImmediate(() => resolve(bus))
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * 获取 dbus-next MessageBus 的底层 Connection 对象
 *
 * dbus-next 内部使用 _connection 属性持有底层 Connection（EventEmitter），
 * 它 emit 'message' 事件包含所有收到的 D-Bus 消息。
 * 我们利用这个特性来监听原始信号，避免 introspect 不存在的对象。
 */
function getConnection(bus: DBusMessageBus): DBusConnection | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = (bus as any)?._connection
  if (conn && typeof conn.on === 'function') {
    return conn as DBusConnection
  }
  return null
}

/**
 * 检测 xdg-desktop-portal PickColor 是否可用
 *
 * 通过尝试获取 org.freedesktop.portal.Screenshot 接口来判断。
 * 结果会被缓存，后续调用直接返回。
 */
export async function isPortalColorPickAvailable(): Promise<boolean> {
  if (portalAvailable !== null) return portalAvailable

  if (process.platform !== 'linux') {
    portalAvailable = false
    return false
  }

  const dbus = loadDBus()
  if (!dbus) {
    portalAvailable = false
    return false
  }

  let bus: DBusMessageBus | null = null
  try {
    bus = await createSafeSessionBus(dbus)
    const portal = await bus.getProxyObject(
      'org.freedesktop.portal.Desktop',
      '/org/freedesktop/portal/desktop'
    )
    // 尝试获取 Screenshot 接口，如果不存在会抛异常
    portal.getInterface('org.freedesktop.portal.Screenshot')
    portalAvailable = true
    console.log('[PortalColorPick] xdg-desktop-portal Screenshot 接口可用')
  } catch (err) {
    portalAvailable = false
    console.warn('[PortalColorPick] xdg-desktop-portal 不可用:', err)
  } finally {
    if (bus) {
      try { bus.disconnect() } catch { /* 忽略断开错误 */ }
    }
  }

  return portalAvailable
}

/**
 * 从 D-Bus 连接名派生 Request 对象路径
 *
 * Portal 约定格式: /org/freedesktop/portal/desktop/request/{sender}/{handle_token}
 * sender 是 D-Bus 唯一连接名（如 ":1.42"）去掉冒号、将点替换为下划线 → "1_42"
 */
function deriveRequestPath(bus: DBusMessageBus, handleToken: string): string {
  // dbus-next 的 bus 对象暴露 name 属性作为唯一连接名
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const busAny = bus as any
  const uniqueName: string = busAny.name || ':1.0'

  // ":1.42" → "1_42"
  const sender = uniqueName.slice(1).replace(/\./g, '_')
  return `/org/freedesktop/portal/desktop/request/${sender}/${handleToken}`
}

/**
 * 通过 xdg-desktop-portal 原生取色
 *
 * 信号订阅策略（修复 codex review P1）：
 *   不使用 getProxyObject(requestPath) — 它会 Introspect 一个尚未存在的
 *   Request 对象而必然失败。
 *
 *   改为三步走：
 *   1. 通过 org.freedesktop.DBus.AddMatch 注册原始信号匹配规则
 *      （不需要目标对象存在，只是告诉 daemon "路由匹配的信号给我"）
 *   2. 在 bus._connection 底层消息流上监听匹配的 Response 信号
 *   3. 调用 PickColor（此时信号监听已就绪，不怕快速响应）
 *
 * @returns PortalPickResult 区分成功/取消/错误三种状态
 */
export async function portalPickColor(): Promise<PortalPickResult> {
  const dbus = loadDBus()
  if (!dbus) return { type: 'error' }

  let bus: DBusMessageBus | null = null
  let matchRule: string | null = null
  let dbusIface: DBusInterface | null = null

  try {
    bus = await createSafeSessionBus(dbus)

    // 获取底层连接，用于监听原始 D-Bus 消息
    const conn = getConnection(bus)
    if (!conn) {
      console.error('[PortalColorPick] 无法获取 D-Bus 底层连接')
      bus.disconnect()
      return { type: 'error' }
    }

    const portal = await bus.getProxyObject(
      'org.freedesktop.portal.Desktop',
      '/org/freedesktop/portal/desktop'
    )
    const screenshot = portal.getInterface('org.freedesktop.portal.Screenshot')

    // 生成唯一 handle_token 防止信号竞态
    const handleToken = `mulby_color_${Date.now()}_${Math.floor(Math.random() * 10000)}`
    const predictedRequestPath = deriveRequestPath(bus, handleToken)

    // 步骤 1: 通过 org.freedesktop.DBus.AddMatch 注册信号匹配规则
    // 这不需要目标对象存在 — 只是告诉 D-Bus daemon
    // "当这个路径上出现匹配的信号时，请路由给我"
    matchRule = [
      `type='signal'`,
      `sender='org.freedesktop.portal.Desktop'`,
      `interface='org.freedesktop.portal.Request'`,
      `member='Response'`,
      `path='${predictedRequestPath}'`
    ].join(',')

    const dbusObj = await bus.getProxyObject(
      'org.freedesktop.DBus',
      '/org/freedesktop/DBus'
    )
    dbusIface = dbusObj.getInterface('org.freedesktop.DBus')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (dbusIface as any).AddMatch(matchRule)
    console.log(`[PortalColorPick] 已注册信号匹配规则: ${predictedRequestPath}`)

    // 步骤 2: 在底层连接上监听原始消息
    const resultPromise = new Promise<PortalPickResult>((resolve) => {
      let resolved = false

      // 超时保护：30 秒无响应则视为错误（可 fallback）
      const timeout = setTimeout(() => {
        if (resolved) return
        resolved = true
        console.warn('[PortalColorPick] 取色超时（30s）')
        cleanup()
        resolve({ type: 'error' })
      }, 30000)

      const cleanup = () => {
        clearTimeout(timeout)
        try { conn.removeListener('message', onMessage) } catch { /* 忽略 */ }
        // 清理 match rule 防止泄漏
        if (matchRule && dbusIface) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(dbusIface as any).RemoveMatch(matchRule).catch(() => { /* 忽略 */ })
          } catch { /* 忽略 */ }
        }
        try { if (bus) bus.disconnect() } catch { /* 忽略 */ }
        bus = null
      }

      const onMessage = (msg: unknown) => {
        const m = msg as DBusRawMessage

        // 过滤：只处理我们目标路径上的 Response 信号
        if (m.type !== DBUS_MESSAGE_TYPE_SIGNAL) return
        if (m.path !== predictedRequestPath) return
        if (m.interface !== 'org.freedesktop.portal.Request') return
        if (m.member !== 'Response') return

        if (resolved) return
        resolved = true
        cleanup()

        const body = m.body || []
        const responseCode = body[0] as number
        const results = body[1] as Record<string, DBusVariant> | undefined

        if (responseCode === 1) {
          // Portal 定义 1 = 用户主动取消
          console.log('[PortalColorPick] 用户取消取色')
          resolve({ type: 'cancelled' })
          return
        }

        if (responseCode !== 0) {
          // 其他非零值 = Portal 后端错误/拒绝
          console.log(`[PortalColorPick] Portal 返回错误，code=${responseCode}`)
          resolve({ type: 'error' })
          return
        }

        try {
          // results.color 是 (ddd) 类型，值域 [0, 1]
          const colorVariant = results?.color
          if (!colorVariant) {
            console.error('[PortalColorPick] 响应中缺少 color 字段')
            resolve({ type: 'error' })
            return
          }

          const colorValue = colorVariant.value as number[]
          if (!Array.isArray(colorValue) || colorValue.length < 3) {
            console.error('[PortalColorPick] color 数据格式异常:', colorValue)
            resolve({ type: 'error' })
            return
          }

          // [0,1] sRGB → [0,255] 整数（四舍五入）
          const r = Math.round(Math.min(1, Math.max(0, colorValue[0])) * 255)
          const g = Math.round(Math.min(1, Math.max(0, colorValue[1])) * 255)
          const b = Math.round(Math.min(1, Math.max(0, colorValue[2])) * 255)

          console.log(`[PortalColorPick] 取色成功: rgb(${r}, ${g}, ${b})`)
          resolve({ type: 'color', r, g, b })
        } catch (err) {
          console.error('[PortalColorPick] 解析颜色数据失败:', err)
          resolve({ type: 'error' })
        }
      }

      conn.on('message', onMessage)
    })

    // 步骤 3: 信号订阅已就绪，现在安全地调用 PickColor
    const options: Record<string, unknown> = {
      handle_token: new dbus.Variant('s', handleToken)
    }
    await screenshot.PickColor!('', options)
    console.log('[PortalColorPick] PickColor 已调用，等待用户取色...')

    return await resultPromise
  } catch (err) {
    console.error('[PortalColorPick] Portal 取色失败:', err)
    // Portal 调用失败，标记为不可用以便后续直接走 fallback
    portalAvailable = false
    if (bus) {
      try { bus.disconnect() } catch { /* 忽略 */ }
    }
    return { type: 'error' }
  }
}

/**
 * 重置 Portal 可用性缓存
 * 用于测试或用户安装了新的 Portal 后端后重新检测
 */
export function resetPortalAvailability(): void {
  portalAvailable = null
}
