import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { PluginFeature } from '../../shared/types/plugin'
import type { VerifyCheck } from '../../shared/types/plugin-verify'

/**
 * 验证报告的纯函数工具集（不依赖 Electron / PluginManager），便于单元测试。
 */

/** 判断 manifest.platform 是否与当前平台兼容（与 PluginLoader.isCompatiblePlatform 同义）。 */
export function isPlatformCompatible(platform: unknown): boolean {
  if (platform === undefined || platform === null) return true
  const current = process.platform
  if (Array.isArray(platform)) return platform.includes(current)
  return platform === current
}

/** 把一个功能的 cmds 触发规则转成可读字符串列表（用于报告展示）。 */
export function describeTriggers(feature: PluginFeature): string[] {
  const out: string[] = []
  for (const cmd of feature.cmds ?? []) {
    switch (cmd.type) {
      case 'keyword':
        out.push(`keyword:${cmd.value}`)
        break
      case 'regex':
        out.push(`regex:${cmd.match}`)
        break
      default:
        out.push(cmd.type)
    }
  }
  return out
}

/** 取功能的第一个 keyword 触发词（若有），用于合成触发匹配测试用例。 */
export function firstKeyword(feature: PluginFeature): string | undefined {
  for (const cmd of feature.cmds ?? []) {
    if (cmd.type === 'keyword') return cmd.value
  }
  return undefined
}

/** 由检查项与致命错误计算总判定。strict 模式下 `warn` 也算失败。 */
export function computeVerdict(
  checks: VerifyCheck[],
  errors: string[],
  strict: boolean
): { ok: boolean; verdict: 'pass' | 'fail' } {
  const hasFail = errors.length > 0 || checks.some((c) => c.status === 'fail')
  const hasWarn = checks.some((c) => c.status === 'warn')
  const ok = !hasFail && (!strict || !hasWarn)
  return { ok, verdict: ok ? 'pass' : 'fail' }
}

/** 当插件加载失败（loader 返回 null）时，给出一条可读的失败原因。 */
export function describeManifestProblem(dir: string): string {
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    return `未找到 manifest.json（${manifestPath}）`
  }
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
  } catch (err) {
    return `manifest.json 解析失败：${err instanceof Error ? err.message : String(err)}`
  }
  const required = ['name', 'version', 'displayName', 'features']
  const missing = required.filter((key) => !(key in manifest))
  if (missing.length > 0) {
    return `manifest 缺少必需字段：${missing.join(', ')}`
  }
  const features = manifest.features
  if (!Array.isArray(features) || features.length === 0) {
    return 'manifest.features 必须是非空数组'
  }
  const main = manifest.main
  if (typeof main === 'string' && main.length > 0 && !existsSync(join(dir, main))) {
    return `入口文件不存在：${main}（是否忘记构建？请先生成该文件）`
  }
  const platform = manifest.platform
  if (platform !== undefined && !isPlatformCompatible(platform)) {
    return `插件平台限制为 ${JSON.stringify(platform)}，与当前平台 ${process.platform} 不匹配`
  }
  return 'manifest 校验未通过（详见 Mulby 日志）'
}
