#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import ts from 'typescript'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..')

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8')
}

function parseSource(relPath, text = read(relPath)) {
  return ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
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
  if (!objLiteral) return out

  for (const prop of objLiteral.properties) {
    if (ts.isSpreadAssignment(prop)) continue

    if (ts.isMethodDeclaration(prop)) {
      const name = getPropName(prop.name)
      if (name) out.add(prefix + name)
      continue
    }

    if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue

    if (ts.isShorthandPropertyAssignment(prop)) {
      out.add(prefix + prop.name.text)
      continue
    }

    const name = getPropName(prop.name)
    if (!name) continue

    const initializer = prop.initializer
    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
      out.add(prefix + name)
    } else if (ts.isObjectLiteralExpression(initializer)) {
      collectObjectMethods(initializer, prefix + name + '.', out)
    } else if (ts.isIdentifier(initializer)) {
      out.add(prefix + name)
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
    const isPrivateOrProtected = (member.modifiers || []).some(
      (mod) => mod.kind === ts.SyntaxKind.PrivateKeyword || mod.kind === ts.SyntaxKind.ProtectedKeyword
    )
    if (isPrivateOrProtected) continue

    const name = getPropName(member.name)
    if (!name || name === 'constructor') continue

    if (ts.isMethodDeclaration(member)) {
      out.add(prefix + name)
      continue
    }

    if (
      ts.isPropertyDeclaration(member) &&
      member.initializer &&
      (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
    ) {
      out.add(prefix + name)
    }
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
    for (const method of collectObjectMethods(aiObj)) {
      out.add('ai.' + method)
    }
  }

  const ffSf = parseSource('src/preload/apis/ffmpeg.ts')
  const ffObj = findReturnObjectInFunction(findFunctionDeclaration(ffSf, 'createFfmpegApi'))
  if (ffObj) {
    for (const method of collectObjectMethods(ffObj)) {
      out.add('ffmpeg.' + method)
    }
  }

  const logSf = parseSource('src/preload/apis/log-api.ts')
  const logObj = findReturnObjectInFunction(findFunctionDeclaration(logSf, 'createLogApi'))
  if (logObj) {
    for (const method of collectObjectMethods(logObj)) {
      out.add('log.' + method)
    }
  }

  const inbrowserSf = parseSource('src/preload/apis/inbrowser.ts')
  const inbrowserObj = findVariableObject(inbrowserSf, 'inbrowser')
  if (inbrowserObj) {
    for (const method of collectObjectMethods(inbrowserObj)) {
      out.add('inbrowser.' + method)
    }
  }
  const builderClass = findClassDeclaration(inbrowserSf, 'InBrowserBuilder')
  if (builderClass) {
    for (const method of collectClassPublicMethods(builderClass)) {
      out.add('inbrowser.' + method)
    }
  }

  out.add('getSharpVersion')

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
    if (!objLiteral) return

    for (const prop of objLiteral.properties) {
      if (ts.isSpreadAssignment(prop)) continue

      if (ts.isMethodDeclaration(prop)) {
        const name = getPropName(prop.name)
        if (name) out.add(prefix + name)
        continue
      }

      if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue

      if (ts.isShorthandPropertyAssignment(prop)) {
        out.add(prefix + prop.name.text)
        continue
      }

      const name = getPropName(prop.name)
      if (!name) continue

      const initializer = prop.initializer
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        out.add(prefix + name)
      } else if (ts.isObjectLiteralExpression(initializer)) {
        walk(initializer, prefix + name + '.')
      } else if (ts.isIdentifier(initializer)) {
        if (initializer.text === 'pluginInput') {
          for (const method of inputMethods) {
            out.add(prefix + name + '.' + method)
          }
        }
      } else if (ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression)) {
        const callee = initializer.expression.text
        if (callee === 'createPluginGlobalShortcut') {
          for (const method of shortcutMethods) out.add(prefix + name + '.' + method)
        } else if (callee === 'createPluginSecurity') {
          for (const method of securityMethods) out.add(prefix + name + '.' + method)
        } else if (callee === 'createPluginTray') {
          for (const method of trayMethods) out.add(prefix + name + '.' + method)
        }
      }
    }
  }

  if (apiObj) walk(apiObj)
  return out
}

function extractTemplateDeclarationSource() {
  const source = parseSource('packages/mulby-cli/src/commands/create/templates/react/types.ts')
  const fnDecl = findFunctionDeclaration(source, 'buildMulbyTypes')
  if (!fnDecl?.body) {
    throw new Error('Unable to locate buildMulbyTypes()')
  }

  let templateText = ''

  function walk(node) {
    if (templateText) return
    if (ts.isReturnStatement(node) && node.expression && ts.isNoSubstitutionTemplateLiteral(node.expression)) {
      templateText = node.expression.text
      return
    }
    ts.forEachChild(node, walk)
  }

  walk(fnDecl.body)

  if (!templateText) {
    throw new Error('Unable to extract mulby.d.ts template literal')
  }

  return templateText
}

function collectDeclaredMethods(interfaceName) {
  const sf = parseSource('mulby-template.d.ts', extractTemplateDeclarationSource())
  const declarations = new Map()

  sf.forEachChild((node) => {
    if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name?.text) {
      declarations.set(node.name.text, node)
    }
  })

  const out = new Set()

  function walkMembers(members, prefix = '') {
    for (const member of members) {
      if (ts.isPropertySignature(member)) {
        const name = getPropName(member.name)
        if (!name || !member.type) continue

        if (ts.isFunctionTypeNode(member.type)) {
          out.add(prefix + name)
        } else {
          walkTypeNode(member.type, prefix + name + '.')
        }
      } else if (ts.isMethodSignature(member)) {
        const name = getPropName(member.name)
        if (name) out.add(prefix + name)
      }
    }
  }

  function walkTypeNode(typeNode, prefix = '') {
    if (!typeNode) return

    if (ts.isTypeLiteralNode(typeNode)) {
      walkMembers(typeNode.members, prefix)
      return
    }

    if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
      const decl = declarations.get(typeNode.typeName.text)
      if (!decl) return

      if (ts.isInterfaceDeclaration(decl)) {
        walkMembers(decl.members, prefix)
      } else if (ts.isTypeAliasDeclaration(decl)) {
        walkTypeNode(decl.type, prefix)
      }
      return
    }

    if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
      for (const inner of typeNode.types) walkTypeNode(inner, prefix)
      return
    }

    if (ts.isParenthesizedTypeNode(typeNode)) {
      walkTypeNode(typeNode.type, prefix)
      return
    }

    if (ts.isFunctionTypeNode(typeNode)) {
      return
    }
  }

  const decl = declarations.get(interfaceName)
  if (!decl) {
    throw new Error(`Unable to locate declaration ${interfaceName}`)
  }

  if (ts.isInterfaceDeclaration(decl)) {
    walkMembers(decl.members)
  } else if (ts.isTypeAliasDeclaration(decl)) {
    walkTypeNode(decl.type)
  }

  return out
}

function diffMethods(actual, declared) {
  const actualSet = new Set(actual)
  const declaredSet = new Set(declared)

  return {
    missing: [...actualSet].filter((method) => !declaredSet.has(method)).sort(),
    extra: [...declaredSet].filter((method) => !actualSet.has(method)).sort()
  }
}

function printDiff(label, diff) {
  if (diff.missing.length === 0 && diff.extra.length === 0) {
    console.log(`[ok] ${label}`)
    return
  }

  console.error(`[drift] ${label}`)

  if (diff.missing.length > 0) {
    console.error('  missing:')
    for (const method of diff.missing) {
      console.error(`    - ${method}`)
    }
  }

  if (diff.extra.length > 0) {
    console.error('  extra:')
    for (const method of diff.extra) {
      console.error(`    - ${method}`)
    }
  }
}

const rendererMethods = [...buildRendererMethods()].filter((method) => method !== 'sharp' && !method.startsWith('sharp.'))
const backendMethods = [...buildBackendMethods()]
const declaredRendererMethods = [...collectDeclaredMethods('MulbyAPI')].filter(
  (method) => method !== 'sharp' && !method.startsWith('sharp.')
)
const declaredBackendMethods = [...collectDeclaredMethods('BackendPluginAPIDirect')]

const rendererDiff = diffMethods(rendererMethods, declaredRendererMethods)
const backendDiff = diffMethods(backendMethods, declaredBackendMethods)

printDiff('renderer template API', rendererDiff)
printDiff('backend template API', backendDiff)

if (
  rendererDiff.missing.length > 0 ||
  rendererDiff.extra.length > 0 ||
  backendDiff.missing.length > 0 ||
  backendDiff.extra.length > 0
) {
  process.exitCode = 1
}
