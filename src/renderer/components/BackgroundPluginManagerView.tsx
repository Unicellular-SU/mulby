import { useEffect, useState } from 'react'
import type { BackgroundPluginInfo } from '../../shared/types/plugin'

interface BackgroundPluginManagerViewProps {
  onBack: () => void
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}天 ${hours % 24}时`
  if (hours > 0) return `${hours}时 ${minutes % 60}分`
  if (minutes > 0) return `${minutes}分 ${seconds % 60}秒`
  return `${seconds}秒`
}

function formatMemory(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(0)} MB`
}

function HealthIndicator({ healthy }: { healthy: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`h-2 w-2 rounded-full ${
          healthy
            ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
            : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
        }`}
      />
      <span className="text-xs text-slate-600 dark:text-slate-400">
        {healthy ? '健康' : '异常'}
      </span>
    </div>
  )
}

export default function BackgroundPluginManagerView({ onBack }: BackgroundPluginManagerViewProps) {
  const [plugins, setPlugins] = useState<BackgroundPluginInfo[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)

  const cardClass = 'rounded-[24px] border border-slate-200/80 bg-white/80 p-6  dark:border-slate-800/80 dark:bg-slate-900/70'
  const cardClassTight = 'rounded-[24px] border border-slate-200/80 bg-white/80 p-5  dark:border-slate-800/80 dark:bg-slate-900/70'
  const actionButtonClass = 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed'
  const dangerButtonClass = 'rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 transition hover:border-red-300 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/50 dark:text-red-400 dark:hover:bg-red-900/30'

  const refreshPlugins = async () => {
    try {
      const list = await window.mulby.plugin.listBackground()
      setPlugins(list)
    } catch (err) {
      console.error('Failed to list background plugins:', err)
    }
  }

  useEffect(() => {
    void refreshPlugins()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      void refreshPlugins()
    }, 1000) // 每 1 秒刷新一次

    return () => clearInterval(interval)
  }, [autoRefresh])

  const handleStop = async (pluginId: string, runMode: 'background' | 'active') => {
    const modeText = runMode === 'background' ? '后台插件' : '插件'
    const { response } = await window.mulby.dialog.showMessageBox({
      type: 'question',
      title: '停止插件',
      message: `确定要停止此${modeText}吗？`,
      buttons: ['取消', '停止'],
      defaultId: 0,
      cancelId: 0
    })
    if (response !== 1) return

    try {
      if (runMode === 'background') {
        await window.mulby.plugin.stopBackground(pluginId)
      } else {
        await window.mulby.plugin.stopPlugin(pluginId)
      }
      window.mulby.notification.show(`${modeText}已停止`, 'success')
      await refreshPlugins()
    } catch {
      window.mulby.notification.show('停止失败', 'error')
    }
  }

  const handleStopAll = async () => {
    if (plugins.length === 0) return

    const { response } = await window.mulby.dialog.showMessageBox({
      type: 'question',
      title: '停止所有插件',
      message: `确定要停止所有 ${plugins.length} 个插件吗？`,
      buttons: ['取消', '全部停止'],
      defaultId: 0,
      cancelId: 0
    })
    if (response !== 1) return

    try {
      await Promise.all(plugins.map(p => {
        if (p.runMode === 'background') {
          return window.mulby.plugin.stopBackground(p.pluginId)
        } else {
          return window.mulby.plugin.stopPlugin(p.pluginId)
        }
      }))
      window.mulby.notification.show('所有插件已停止', 'success')
      await refreshPlugins()
    } catch {
      window.mulby.notification.show('停止失败', 'error')
    }
  }

  return (
    <div className="relative h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-28 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-purple-200/40 blur-[120px] dark:bg-purple-500/20" />
        <div className="absolute right-16 top-24 h-64 w-64 rounded-full bg-blue-200/40 blur-[120px] dark:bg-blue-400/10" />
        <div className="absolute bottom-0 left-16 h-64 w-64 rounded-full bg-indigo-200/30 blur-[120px] dark:bg-indigo-500/10" />
      </div>

      <div className="relative flex h-full min-h-0 flex-col">
        {/* 头部 */}
        <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white/70 px-6 py-4  dark:border-slate-800/80 dark:bg-slate-900/60">
          <button
            onClick={onBack}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white no-drag"
            title="返回"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Running Plugins</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">运行中的插件</div>
          </div>
          <button
            className={`${actionButtonClass} flex items-center gap-1.5 no-drag`}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <div className={`h-1.5 w-1.5 rounded-full transition-colors ${autoRefresh ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            自动刷新
          </button>
          <button className={`${actionButtonClass} no-drag`} onClick={refreshPlugins}>
            刷新
          </button>
          {plugins.length > 0 && (
            <button className={`${dangerButtonClass} no-drag`} onClick={handleStopAll}>
              停止全部
            </button>
          )}
        </div>

        {/* 内容区域 */}
        <div className="flex-1 min-h-0 overflow-auto no-drag">
          <div className="mx-auto max-w-6xl px-6 pb-16 pt-8">
            {/* 概览卡片 */}
            <div className={`${cardClass} space-y-4`}>
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">运行概览</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  当前有 {plugins.length} 个插件正在运行
                </div>
              </div>

              {plugins.length > 0 && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/50">
                    <div className="text-xs text-slate-500 dark:text-slate-400">总内存使用</div>
                    <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">
                      {formatMemory(plugins.reduce((sum, p) => sum + p.memoryUsage + (p.rendererMemoryUsage ?? 0), 0))}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/50">
                    <div className="text-xs text-slate-500 dark:text-slate-400">健康插件</div>
                    <div className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                      {plugins.filter(p => p.healthy).length} / {plugins.length}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-900/50">
                    <div className="text-xs text-slate-500 dark:text-slate-400">后台插件</div>
                    <div className="mt-1 text-2xl font-semibold text-blue-600 dark:text-blue-400">
                      {plugins.filter(p => p.runMode === 'background').length}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 插件列表 */}
            {plugins.length === 0 ? (
              <div className={`${cardClass} mt-6 text-center`}>
                <div className="py-8">
                  <svg className="mx-auto h-16 w-16 text-slate-300 dark:text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <div className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                    当前没有插件在运行
                  </div>
                  <div className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                    运行插件后，它们会出现在这里
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {plugins.map((plugin) => (
                  <div key={plugin.pluginId} className={`${cardClassTight}`}>
                    <div className="flex items-start gap-4">
                      {/* 左侧：插件信息 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">
                            {plugin.displayName}
                          </div>
                          <HealthIndicator healthy={plugin.healthy} />
                          {plugin.runMode === 'background' ? (
                            <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                              后台
                            </span>
                          ) : (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                              活跃
                            </span>
                          )}
                          {plugin.persistent && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              持久化
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                          {plugin.pluginName}
                        </div>

                        {/* 资源使用情况 */}
                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">运行时长</div>
                            <div className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                              {formatUptime(plugin.uptime)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">内存</div>
                            <div className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                              {formatMemory(plugin.memoryUsage + (plugin.rendererMemoryUsage ?? 0))}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">CPU</div>
                            <div className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                              {plugin.cpuUsage.toFixed(1)}%
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">请求数</div>
                            <div className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                              {plugin.requestCount}
                            </div>
                          </div>
                        </div>

                        {/* 第二行：错误数 + 内存细分（宿主进程 vs UI 渲染进程） */}
                        <div className="grid grid-cols-4 gap-3 mt-2">
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">错误数</div>
                            <div className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                              {plugin.errorCount}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">宿主内存</div>
                            <div className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                              {formatMemory(plugin.memoryUsage)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">渲染内存</div>
                            <div className="mt-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                              {formatMemory(plugin.rendererMemoryUsage ?? 0)}
                            </div>
                          </div>
                        </div>

                        {/* 心跳信息 */}
                        {!plugin.healthy && plugin.runMode === 'background' && (
                          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">
                            ⚠️ 丢失心跳: {plugin.missedHeartbeats} 次
                          </div>
                        )}
                      </div>

                      {/* 右侧：操作按钮 */}
                      <div className="flex flex-col gap-2">
                        <button
                          className={dangerButtonClass}
                          onClick={() => handleStop(plugin.pluginId, plugin.runMode)}
                        >
                          停止
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
