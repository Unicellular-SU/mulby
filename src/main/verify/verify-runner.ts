import { existsSync } from 'fs'
import { join } from 'path'
import type { PluginManager } from '../plugin'
import type { InputPayload } from '../../shared/types/plugin'
import {
  VERIFY_REPORT_SCHEMA_VERSION,
  type VerifyCheck,
  type VerifyCheckStatus,
  type VerifyFeatureReport,
  type VerifyLogEntry,
  type VerifyReport,
  type VerifyReportPluginInfo
} from '../../shared/types/plugin-verify'
import {
  computeVerdict,
  describeManifestProblem,
  describeTriggers,
  firstKeyword
} from './report-utils'
import { ensureAutomationIpcHandlers } from './automation-ipc'
import { PluginUiRenderer } from './ui-render'

export interface VerifyRunnerOptions {
  strict?: boolean
  /** 执行后等待异步错误浮现的宽限期（毫秒）。 */
  graceMs?: number
  /** 验证模式使用的隔离 userData 目录（写入报告 meta，供外部清理/排查）。 */
  userDataDir?: string
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 对单个插件目录执行冒烟验证，产出结构化报告。
 *
 * 检查项（Tier 1 MVP）：
 * 1. manifest 与入口校验
 * 2. 插件加载
 * 3. UI 资源存在性（声明 ui 时）
 * 4. onLoad 生命周期（有后台入口时；错误不会被吞掉）
 * 5. 逐功能触发匹配（keyword 触发）
 * 6. 逐功能执行（静默/后台功能；UI 渲染验证留待 Tier 2）
 */
export async function runPluginVerification(
  pluginManager: PluginManager,
  pluginDir: string,
  options: VerifyRunnerOptions = {}
): Promise<VerifyReport> {
  const startedAt = Date.now()
  const strict = options.strict === true
  const graceMs = options.graceMs ?? 800
  const checks: VerifyCheck[] = []
  const features: VerifyFeatureReport[] = []
  const logs: VerifyLogEntry[] = []
  const errors: string[] = []
  const uiRenderer = new PluginUiRenderer()

  let pluginInfo: VerifyReportPluginInfo = {
    id: '',
    name: '',
    path: pluginDir,
    hasUI: false,
    hasBackground: false
  }

  const unsubscribe = pluginManager.subscribeHostDiagnostics((evt) => {
    if (evt.kind === 'console') {
      logs.push({ source: 'host', level: evt.level, text: evt.text })
    } else if (evt.kind === 'error') {
      logs.push({ source: 'host', level: 'error', text: evt.text })
    } else if (evt.kind === 'exit' && evt.code !== 0) {
      logs.push({ source: 'host', level: 'error', text: `host 进程以退出码 ${evt.code} 退出` })
    }
  })

  const finalize = (): VerifyReport => {
    const { ok, verdict } = computeVerdict(checks, errors, strict)
    return {
      schemaVersion: VERIFY_REPORT_SCHEMA_VERSION,
      ok,
      verdict,
      plugin: pluginInfo,
      checks,
      features,
      logs,
      errors,
      durationMs: Date.now() - startedAt,
      meta: {
        platform: process.platform,
        electron: process.versions.electron,
        node: process.versions.node,
        timestamp: new Date(startedAt).toISOString(),
        strict,
        userDataDir: options.userDataDir
      }
    }
  }

  try {
    // 1) manifest + 加载
    const plugin = await pluginManager.loadPluginForVerification(pluginDir)
    if (!plugin) {
      checks.push({
        id: 'manifest',
        title: 'manifest 与入口校验',
        status: 'fail',
        detail: describeManifestProblem(pluginDir)
      })
      return finalize()
    }

    const hasBackground = Boolean(plugin.manifest.main)
    const hasUI = Boolean(plugin.manifest.ui)
    pluginInfo = {
      id: plugin.id,
      name: plugin.manifest.name,
      displayName: plugin.manifest.displayName,
      version: plugin.manifest.version,
      path: plugin.path,
      hasUI,
      hasBackground
    }
    checks.push({ id: 'manifest', title: 'manifest 与入口校验', status: 'pass' })
    checks.push({
      id: 'load',
      title: '插件加载',
      status: 'pass',
      detail: `已加载 ${plugin.id} v${plugin.manifest.version}`
    })

    // 静态：UI 资源存在性
    if (hasUI) {
      const uiRel = plugin.manifest.ui as string
      const uiExists = existsSync(join(plugin.path, uiRel))
      checks.push({
        id: 'ui-asset',
        title: 'UI 资源存在',
        status: uiExists ? 'pass' : 'fail',
        detail: uiExists ? uiRel : `manifest.ui 指向的文件不存在：${uiRel}`
      })
    }

    if (pluginManager.getFeatures(plugin.id).length === 0) {
      checks.push({ id: 'features', title: '功能入口解析', status: 'fail', detail: '未解析到任何 feature' })
    }

    // 2) onLoad（仅当有后台入口）
    if (hasBackground) {
      try {
        await pluginManager.verifyTriggerOnLoad(plugin)
        checks.push({ id: 'onload', title: 'onLoad 生命周期', status: 'pass' })
      } catch (err) {
        checks.push({ id: 'onload', title: 'onLoad 生命周期', status: 'fail', detail: toMessage(err) })
      }
    } else {
      checks.push({ id: 'onload', title: 'onLoad 生命周期', status: 'skip', detail: '无后台 main 入口' })
    }

    // onLoad 可能通过 api.features.setFeature() 动态注册功能，重新获取最终功能列表
    const finalFeatures = pluginManager.getFeatures(plugin.id)

    // 3) 逐功能：触发匹配 + 执行
    for (const feature of finalFeatures) {
      const triggers = describeTriggers(feature)
      const keyword = firstKeyword(feature)
      let triggerMatched: boolean | null = null

      if (keyword) {
        const results = await pluginManager.search(keyword)
        triggerMatched = results.some(
          (r) => r.plugin.id === plugin.id && r.feature.code === feature.code
        )
        checks.push({
          id: `trigger:${feature.code}`,
          title: `触发匹配 · ${feature.code}`,
          status: triggerMatched ? 'pass' : 'fail',
          detail: triggerMatched
            ? `关键词 "${keyword}" 命中`
            : `关键词 "${keyword}" 未命中该功能（请检查 manifest cmds 配置）`
        })
      } else {
        checks.push({
          id: `trigger:${feature.code}`,
          title: `触发匹配 · ${feature.code}`,
          status: 'skip',
          detail: '无 keyword 触发（regex / files / window 需人工用例）'
        })
      }

      // 执行：UI 功能离屏渲染验证（Tier 2）；静默/后台功能直连 host 执行
      const isUiFeature = hasUI && feature.mode !== 'silent'
      let runStatus: VerifyCheckStatus = 'skip'
      let runError: string | undefined
      let uiRender: VerifyFeatureReport['uiRender']

      if (isUiFeature) {
        ensureAutomationIpcHandlers(pluginManager)
        const render = await uiRenderer.render(plugin, {
          featureCode: feature.code,
          input: { text: keyword ?? '', attachments: [] },
          route: feature.route
        })
        uiRender = {
          rendered: render.rendered,
          consoleErrors: render.consoleErrors.length,
          missingBridge: render.missingBridge.length,
          screenshotBytes: render.screenshotBytes
        }
        for (const text of render.consoleErrors) logs.push({ source: 'ui', level: 'error', text })

        let detail: string
        if (render.renderProcessGone) {
          runStatus = 'fail'
          detail = `渲染进程崩溃: ${render.renderProcessGone.reason}`
        } else if (render.loadFailed) {
          runStatus = 'fail'
          detail = `UI 加载失败: ${render.loadFailed.description}`
        } else if (!render.rendered) {
          runStatus = 'fail'
          detail = 'UI 未能就绪（超时）'
        } else if (render.consoleErrors.length > 0) {
          runStatus = 'warn'
          detail = `UI 已渲染，但有 ${render.consoleErrors.length} 条 console 错误`
        } else {
          runStatus = 'pass'
          detail = render.missingBridge.length > 0
            ? `UI 已渲染（${render.missingBridge.length} 个宿主桥渠道未注册，已忽略）`
            : 'UI 已渲染，无 console 错误'
        }
        if (runStatus === 'fail') runError = detail
        checks.push({ id: `render:${feature.code}`, title: `UI 渲染 · ${feature.code}`, status: runStatus, detail })
      } else if (hasBackground) {
        const errorsBefore = logs.filter((l) => l.level === 'error').length
        try {
          const input: InputPayload = { text: keyword ?? '', attachments: [] }
          await pluginManager.verifyRunFeature(plugin, feature.code, input)
          await delay(graceMs)
          const errorsAfter = logs.filter((l) => l.level === 'error').length
          if (errorsAfter > errorsBefore) {
            runStatus = 'warn'
            runError = `执行期间产生了 ${errorsAfter - errorsBefore} 条错误输出（详见 logs）`
          } else {
            runStatus = 'pass'
          }
        } catch (err) {
          runStatus = 'fail'
          runError = toMessage(err)
        }
        checks.push({ id: `run:${feature.code}`, title: `执行 · ${feature.code}`, status: runStatus, detail: runError })
      } else {
        checks.push({ id: `run:${feature.code}`, title: `执行 · ${feature.code}`, status: 'skip', detail: '无后台 main 入口' })
      }

      features.push({
        code: feature.code,
        explain: feature.explain,
        mode: feature.mode,
        triggers,
        triggerMatched,
        run: runStatus,
        runError,
        uiRender
      })
    }

    return finalize()
  } catch (err) {
    errors.push(toMessage(err))
    return finalize()
  } finally {
    uiRenderer.destroy()
    unsubscribe()
  }
}
