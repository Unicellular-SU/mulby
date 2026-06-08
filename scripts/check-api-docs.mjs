#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const root = process.cwd()

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

function parseSource(relPath) {
  return ts.createSourceFile(relPath, read(relPath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function getPropName(nameNode) {
  if (!nameNode) return null
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text
  }
  if (ts.isComputedPropertyName(nameNode)) {
    const expr = nameNode.expression
    if (ts.isIdentifier(expr) || ts.isStringLiteral(expr)) return expr.text
  }
  return null
}

function collectObjectMethods(objLiteral, prefix = '', out = new Set()) {
  for (const p of objLiteral.properties) {
    if (ts.isSpreadAssignment(p)) continue

    if (ts.isMethodDeclaration(p)) {
      const n = getPropName(p.name)
      if (n) out.add(prefix + n)
      continue
    }

    if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue

    if (ts.isShorthandPropertyAssignment(p)) {
      out.add(prefix + p.name.text)
      continue
    }

    const n = getPropName(p.name)
    if (!n) continue
    const init = p.initializer

    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      out.add(prefix + n)
    } else if (ts.isObjectLiteralExpression(init)) {
      collectObjectMethods(init, prefix + n + '.', out)
    } else if (ts.isIdentifier(init)) {
      out.add(prefix + n)
    } else if (ts.isCallExpression(init)) {
      // IIFE 模式: key: (() => { ... })() — 视为函数
      out.add(prefix + n)
    }
  }

  return out
}

function findFunctionDeclaration(sf, fnName) {
  let found = null

  function walk(node) {
    if (found) return
    if (ts.isFunctionDeclaration(node) && node.name?.text === fnName) {
      found = node
      return
    }
    ts.forEachChild(node, walk)
  }

  walk(sf)
  return found
}

function findReturnObjectInFunction(fnDecl) {
  if (!fnDecl?.body) return null
  let found = null

  function walk(node) {
    if (found) return
    if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
      found = node.expression
      return
    }
    ts.forEachChild(node, walk)
  }

  walk(fnDecl.body)
  return found
}

function findVariableObject(sf, varName) {
  let found = null

  function walk(node) {
    if (found) return
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === varName &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      found = node.initializer
      return
    }
    ts.forEachChild(node, walk)
  }

  walk(sf)
  return found
}

function findClassDeclaration(sf, className) {
  let found = null

  function walk(node) {
    if (found) return
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      found = node
      return
    }
    ts.forEachChild(node, walk)
  }

  walk(sf)
  return found
}

function collectClassPublicMethods(classDecl, prefix = '', out = new Set()) {
  if (!classDecl) return out

  for (const member of classDecl.members) {
    // 同时识别 method 声明与「属性箭头函数」(public foo = (...) => ...)
    const isMethod = ts.isMethodDeclaration(member)
    const isArrowProp =
      ts.isPropertyDeclaration(member) &&
      member.initializer &&
      (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
    if (!isMethod && !isArrowProp) continue

    const isPrivateOrProtected = (member.modifiers || []).some(
      (mod) => mod.kind === ts.SyntaxKind.PrivateKeyword || mod.kind === ts.SyntaxKind.ProtectedKeyword
    )
    if (isPrivateOrProtected) continue

    const n = getPropName(member.name)
    if (!n || n === 'constructor') continue
    out.add(prefix + n)
  }

  return out
}

function buildRendererMethods() {
  const out = new Set()

  const coreSf = parseSource('src/preload/apis/core-api.ts')
  collectObjectMethods(findReturnObjectInFunction(findFunctionDeclaration(coreSf, 'createCoreApi')), '', out)

  const platformSf = parseSource('src/preload/apis/platform-api.ts')
  collectObjectMethods(findReturnObjectInFunction(findFunctionDeclaration(platformSf, 'createPlatformApi')), '', out)

  const appSf = parseSource('src/preload/apis/app-plugin-api.ts')
  collectObjectMethods(findReturnObjectInFunction(findFunctionDeclaration(appSf, 'createAppPluginApi')), '', out)

  const aiSf = parseSource('src/preload/apis/ai.ts')
  const aiObj = findVariableObject(aiSf, 'api')
  if (aiObj) {
    const aiMethods = collectObjectMethods(aiObj)
    for (const m of aiMethods) out.add('ai.' + m)
  }

  const ffSf = parseSource('src/preload/apis/ffmpeg.ts')
  const ffObj = findReturnObjectInFunction(findFunctionDeclaration(ffSf, 'createFfmpegApi'))
  if (ffObj) {
    const ffMethods = collectObjectMethods(ffObj)
    for (const m of ffMethods) out.add('ffmpeg.' + m)
  }

  const logSf = parseSource('src/preload/apis/log-api.ts')
  const logObj = findReturnObjectInFunction(findFunctionDeclaration(logSf, 'createLogApi'))
  if (logObj) {
    const logMethods = collectObjectMethods(logObj)
    for (const m of logMethods) out.add('log.' + m)
  }

  const inbrowserSf = parseSource('src/preload/apis/inbrowser.ts')
  const inbrowserObj = findVariableObject(inbrowserSf, 'inbrowser')
  if (inbrowserObj) {
    const ibMethods = collectObjectMethods(inbrowserObj)
    for (const m of ibMethods) out.add('inbrowser.' + m)
  }
  const builderClass = findClassDeclaration(inbrowserSf, 'InBrowserBuilder')
  if (builderClass) {
    const builderMethods = collectClassPublicMethods(builderClass)
    for (const m of builderMethods) out.add('inbrowser.' + m)
  }

  out.add('sharp')
  const sharpText = read('src/preload/apis/sharp.ts')
  for (const listMatch of sharpText.matchAll(/const\s+(?:terminalMethods|chainMethods)\s*=\s*\[([\s\S]*?)\]/g)) {
    const names = [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    for (const n of names) out.add('sharp.' + n)
  }
  out.add('sharp.clone')
  out.add('getSharpVersion')

  const mainSf = parseSource('src/preload/apis/mulby-main-api.ts')
  const mainObj = findReturnObjectInFunction(findFunctionDeclaration(mainSf, 'createMulbyMainApi'))
  if (mainObj) {
    const methods = collectObjectMethods(mainObj)
    for (const m of methods) out.add('mulbyMain.' + m)
  }

  return out
}

function buildBackendMethods() {
  const out = new Set()

  const apiSf = parseSource('src/main/plugin/api.ts')
  const apiObj = findReturnObjectInFunction(findFunctionDeclaration(apiSf, 'createPluginAPI'))

  const shortcutSf = parseSource('src/main/plugin/shortcut.ts')
  const shortcutMethods = collectClassPublicMethods(findClassDeclaration(shortcutSf, 'PluginGlobalShortcut'))

  const securitySf = parseSource('src/main/plugin/security.ts')
  const securityMethods = collectClassPublicMethods(findClassDeclaration(securitySf, 'PluginSecurity'))

  const traySf = parseSource('src/main/plugin/tray.ts')
  const trayMethods = collectClassPublicMethods(findClassDeclaration(traySf, 'PluginTray'))

  const inputSf = parseSource('src/main/plugin/input.ts')
  const inputObj = findVariableObject(inputSf, 'pluginInput')
  const inputMethods = inputObj ? collectObjectMethods(inputObj) : new Set()

  function walk(objLiteral, prefix = '') {
    for (const p of objLiteral.properties) {
      if (ts.isSpreadAssignment(p)) continue

      if (ts.isMethodDeclaration(p)) {
        const n = getPropName(p.name)
        if (n) out.add(prefix + n)
        continue
      }

      if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue

      if (ts.isShorthandPropertyAssignment(p)) {
        out.add(prefix + p.name.text)
        continue
      }

      const n = getPropName(p.name)
      if (!n) continue
      const init = p.initializer

      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        out.add(prefix + n)
      } else if (ts.isObjectLiteralExpression(init)) {
        walk(init, prefix + n + '.')
      } else if (ts.isIdentifier(init)) {
        if (init.text === 'pluginInput') {
          for (const m of inputMethods) out.add(prefix + n + '.' + m)
        }
      } else if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
        const callee = init.expression.text
        if (callee === 'createPluginGlobalShortcut') {
          for (const m of shortcutMethods) out.add(prefix + n + '.' + m)
        } else if (callee === 'createPluginSecurity') {
          for (const m of securityMethods) out.add(prefix + n + '.' + m)
        } else if (callee === 'createPluginTray') {
          for (const m of trayMethods) out.add(prefix + n + '.' + m)
        }
      }
    }
  }

  if (apiObj) walk(apiObj)
  return out
}

const DOC_CHECKS = {
  'docs/apis/ai.md': {
    prefixes: ['ai'],
    allowTop: [],
    scope: ['ai']
  },
  'docs/apis/scheduler.md': {
    prefixes: ['scheduler'],
    allowTop: [],
    scope: ['scheduler']
  },
  'docs/apis/system.md': {
    prefixes: ['system'],
    allowTop: [],
    scope: ['system']
  },
  'docs/apis/settings.md': {
    prefixes: ['settings'],
    allowTop: [],
    scope: ['settings']
  },
  'docs/apis/plugin.md': {
    prefixes: ['plugin'],
    allowTop: ['onPluginInit', 'onPluginAttach', 'onPluginDetached', 'onPluginLaunchStart', 'onPluginLaunchEnd'],
    scope: ['plugin', 'onPluginInit', 'onPluginAttach', 'onPluginDetached', 'onPluginLaunchStart', 'onPluginLaunchEnd']
  },
  'docs/apis/directory-access.md': {
    prefixes: ['directoryAccess'],
    allowTop: [],
    scope: ['directoryAccess']
  },
  'docs/apis/super-panel.md': {
    prefixes: ['superPanel'],
    allowTop: [],
    scope: ['superPanel']
  },
  'docs/apis/sharp.md': {
    prefixes: ['sharp'],
    allowTop: ['getSharpVersion'],
    scope: ['sharp', 'getSharpVersion']
  },
  'docs/apis/window.md': {
    prefixes: ['window', 'subInput', 'mulbyMain.subInput', 'mulbyMain.clipboard'],
    allowTop: ['onWindowStateChange'],
    scope: ['window', 'subInput', 'mulbyMain.subInput', 'mulbyMain.clipboard', 'onWindowStateChange']
  }
}

const KNOWN_ROOTS = new Set([
  'window',
  'subInput',
  'onWindowStateChange',
  'ai',
  'app',
  'systemPlugin',
  'systemPage',
  'clipboard',
  'clipboardHistory',
  'input',
  'notification',
  'storage',
  'settings',
  'developer',
  'plugin',
  'pluginStore',
  'directoryAccess',
  'scheduler',
  'screen',
  'shell',
  'desktop',
  'dialog',
  'system',
  'permission',
  'shortcut',
  'security',
  'media',
  'power',
  'tray',
  'trayMenu',
  'http',
  'network',
  'menu',
  'geolocation',
  'tts',
  'inbrowser',
  'host',
  'features',
  'messaging',
  'ffmpeg',
  'log',
  'mulbyMain',
  'sharp',
  'getSharpVersion',
  'onThemeChange'
])

function parseDocEntries(relPath) {
  const lines = read(relPath).split(/\r?\n/)
  const entries = []
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    const heading = line.match(/^###\s+(.+)$/)
    if (!heading) continue

    const title = heading[1].trim()
    const names = [...title.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)].map((m) => m[1])
    if (names.length === 0) continue

    let hasRenderer = false
    let hasBackend = false

    for (let j = i + 1; j < lines.length; j += 1) {
      const look = lines[j].trim()
      if (!look) continue
      if (look.startsWith('### ')) break
      if (look.startsWith('```')) break

      const renderer = look.includes('[Renderer]')
      const backend = look.includes('[Backend]')
      if (renderer || backend) {
        hasRenderer = renderer
        hasBackend = backend
      }
      break
    }

    for (const name of names) {
      entries.push({
        name,
        line: i + 1,
        tags: {
          renderer: hasRenderer,
          backend: hasBackend
        }
      })
    }
  }

  return entries
}

function normalizeDocMethodName(name) {
  let n = name.trim().replace(/^`|`$/g, '')
  n = n.replace(/^window\.mulby\./, '')
  n = n.replace(/^context\.api\./, '')
  n = n.replace(/^api\./, '')
  return n
}

function buildCandidates(docCfg, methodName) {
  const n = normalizeDocMethodName(methodName)
  if (!n) return []

  const root = n.split('.')[0]
  const isConfiguredRoot =
    docCfg.prefixes.some((p) => p === root || p.startsWith(root + '.')) ||
    docCfg.allowTop.includes(n)

  if (KNOWN_ROOTS.has(root) && isConfiguredRoot) return [n]

  const out = []
  if (docCfg.allowTop.includes(n)) out.push(n)
  for (const prefix of docCfg.prefixes) out.push(`${prefix}.${n}`)
  return [...new Set(out)]
}

function inScope(method, scope) {
  return scope.some((prefix) => method === prefix || method.startsWith(prefix + '.'))
}

function validate(renderer, backend) {
  const errors = []

  for (const [docPath, cfg] of Object.entries(DOC_CHECKS)) {
    const entries = parseDocEntries(docPath)
    const matched = new Set()

    for (const entry of entries) {
      const candidates = buildCandidates(cfg, entry.name)
      const rendererHits = candidates.filter((m) => renderer.has(m))
      const backendHits = candidates.filter((m) => backend.has(m))

      const hasAny = rendererHits.length > 0 || backendHits.length > 0

      if (entry.tags.renderer || entry.tags.backend) {
        if (entry.tags.renderer && rendererHits.length === 0) {
          errors.push(`${docPath}:${entry.line} \`${entry.name}\` is marked [Renderer] but no renderer API was found`)
        }
        if (entry.tags.backend && backendHits.length === 0) {
          errors.push(`${docPath}:${entry.line} \`${entry.name}\` is marked [Backend] but no backend API was found`)
        }
      } else if (!hasAny) {
        errors.push(`${docPath}:${entry.line} \`${entry.name}\` does not match any API method`)
      }

      for (const m of rendererHits) matched.add(m)
      for (const m of backendHits) matched.add(m)
    }

    const scopedActual = [
      ...[...renderer].filter((m) => inScope(m, cfg.scope)),
      ...[...backend].filter((m) => inScope(m, cfg.scope))
    ]

    const missingInDocs = scopedActual.filter((m) => !matched.has(m)).sort()
    for (const m of missingInDocs) {
      errors.push(`${docPath}: missing method in docs -> \`${m}\``)
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// 全文档 coverage 校验：覆盖 docs/apis 下除 DOC_CHECKS（严格 9 文档）以外的全部文档。
// 与严格校验互补 —— 严格校验做精确的 ### 标题/[Renderer][Backend] 标签匹配；
// coverage 做「代码里每个方法名是否在对应文档中出现」的格式无关检查（兼容
// ### / #### 标题、列表等多种写法），防止新增宿主 API 后漏写文档。
// ---------------------------------------------------------------------------

// 文档 -> 命名空间作用域前缀（含归属到具体文档的顶层方法）。
const DOC_COVERAGE = {
  // 后端 tools.register/unregister 文档化在 ai.md（方式 B：manifest.tools + register），无独立文档。
  'docs/apis/ai.md': ['tools'],
  'docs/apis/power.md': ['power'],
  'docs/apis/tray.md': ['tray'],
  'docs/apis/tray-menu.md': ['trayMenu'],
  'docs/apis/permission.md': ['permission'],
  'docs/apis/security.md': ['security'],
  'docs/apis/developer.md': ['developer'],
  'docs/apis/app-events.md': ['app', 'onPluginOut'],
  'docs/apis/system-plugin.md': ['systemPlugin'],
  'docs/apis/system-page.md': ['systemPage'],
  'docs/apis/log.md': ['log'],
  'docs/apis/theme.md': ['theme', 'onThemeChange'],
  'docs/apis/dialog.md': ['dialog'],
  'docs/apis/menu.md': ['menu'],
  'docs/apis/notification.md': ['notification'],
  'docs/apis/tts.md': ['tts'],
  'docs/apis/shortcut.md': ['shortcut'],
  'docs/apis/clipboard.md': ['clipboard'],
  'docs/apis/clipboard-history.md': ['clipboardHistory'],
  'docs/apis/input.md': ['input'],
  'docs/apis/input-monitor.md': ['inputMonitor'],
  'docs/apis/plugin-store.md': ['pluginStore'],
  'docs/apis/host.md': ['host'],
  'docs/apis/features.md': ['features'],
  'docs/apis/messaging.md': ['messaging'],
  'docs/apis/inbrowser.md': ['inbrowser'],
  'docs/apis/filesystem.md': ['filesystem'],
  'docs/apis/storage.md': ['storage'],
  'docs/apis/shell.md': ['shell'],
  'docs/apis/desktop.md': ['desktop'],
  'docs/apis/http.md': ['http'],
  'docs/apis/network.md': ['network'],
  'docs/apis/geolocation.md': ['geolocation'],
  'docs/apis/media.md': ['media'],
  'docs/apis/screen.md': ['screen'],
  'docs/apis/ffmpeg.md': ['ffmpeg']
}

// 内部 / 非插件面向的命名空间，不要求出现在 docs/apis 中：
// - 渲染进程：onboarding、openclaw、mulbyMain（仅 subInput/clipboard 在 window.md，其余为主窗口内部）
// 说明：后端 tools.* 文档化在 ai.md（见上方 DOC_COVERAGE 的 ai.md->['tools']）。
// 如需文档化其它内部命名空间，可新增对应 md 并在 DOC_COVERAGE 注册。

function coverageInScope(method, scope) {
  return scope.some((p) => method === p || method.startsWith(p + '.'))
}

function validateCoverage(renderer, backend) {
  const errors = []
  const allActual = new Set([...renderer, ...backend])

  for (const [docPath, scope] of Object.entries(DOC_COVERAGE)) {
    let text
    try {
      text = read(docPath)
    } catch {
      errors.push(`${docPath}: doc file missing`)
      continue
    }

    const scoped = [...allActual].filter((m) => coverageInScope(m, scope)).sort()
    for (const method of scoped) {
      const leaf = method.includes('.') ? method.split('.').pop() : method
      const re = new RegExp('\\b' + leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')
      if (!re.test(text)) {
        errors.push(`${docPath}: missing method in docs -> \`${method}\``)
      }
    }
  }

  return errors
}

function main() {
  const renderer = buildRendererMethods()
  const backend = buildBackendMethods()

  const errors = [...validate(renderer, backend), ...validateCoverage(renderer, backend)]

  if (errors.length > 0) {
    console.error('API docs check failed. Found mismatches:')
    for (const err of errors) console.error(`- ${err}`)
    process.exit(1)
  }

  console.log('API docs check passed (strict + full coverage).')
}

main()
