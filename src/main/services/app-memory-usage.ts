/**
 * App memory aggregation helpers (measurement fix)
 *
 * `app.getAppMetrics()` 的 `workingSetSize` 在 macOS 上包含共享内存：Electron/Chromium
 * 的共享库被映射进每一个进程，于是把所有进程的 workingSetSize 直接相加会把这部分
 * 共享内存重复累加 N 次，得到一个远高于真实物理占用的数字。
 *
 * 这里用主进程的 shared 内存作为"每进程共享基线"，从总和里扣除被重复计入的 (N-1) 份，
 * 得到更接近真实「私有/物理」占用的估算。纯函数，便于单测。
 */

/**
 * 估算应用真实内存占用（字节）。
 * @param workingSetBytesList 各进程 workingSetSize（字节）
 * @param sharedBytesPerProcess 单进程共享内存基线（字节，取主进程 shared）
 */
export function estimateAppPrivateMemoryBytes(
  workingSetBytesList: number[],
  sharedBytesPerProcess: number
): number {
  if (workingSetBytesList.length === 0) return 0

  let sum = 0
  let largest = 0
  for (const raw of workingSetBytesList) {
    const value = Math.max(0, raw)
    sum += value
    if (value > largest) largest = value
  }

  const extraProcesses = Math.max(0, workingSetBytesList.length - 1)
  const corrected = sum - Math.max(0, sharedBytesPerProcess) * extraProcesses

  // 下界保护：不应低于最大单进程占用，也不应为负。
  return Math.max(corrected, largest, 0)
}

/**
 * 把"插件 → 渲染进程 pid 集合"与"pid → workingSet 字节"聚合为
 * "插件 → 渲染进程内存字节"。pid 去重，避免同一进程承载多个 webContents 时重复计。
 */
export function aggregateRendererBytesByPlugin(
  rendererPidsByPlugin: Map<string, Set<number>>,
  pidToBytes: Map<number, number>
): Map<string, number> {
  const result = new Map<string, number>()
  for (const [pluginId, pids] of rendererPidsByPlugin) {
    let total = 0
    for (const pid of pids) {
      total += Math.max(0, pidToBytes.get(pid) ?? 0)
    }
    result.set(pluginId, total)
  }
  return result
}
