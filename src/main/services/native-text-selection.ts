/**
 * 跨平台原生取词服务（零剪贴板污染）
 *
 * 统一接口获取当前焦点应用的选中文本，替代传统的"模拟 Cmd/Ctrl+C + 剪贴板轮询"方案。
 *
 * 三平台策略（优先原生 API → 剪贴板回退）：
 * - macOS:   Accessibility API — AXUIElementCopyAttributeValue(kAXSelectedTextAttribute)
 * - Windows: UI Automation     — 预编译 DLL: ITextPattern::GetSelection → GetText
 * - Linux:   X11 PRIMARY       — xclip / xsel / wl-paste 读取 PRIMARY selection
 *
 * 回退方案：模拟 Cmd/Ctrl+C + 短延迟 + 剪贴板快照比较
 *
 * 独立附件采集：captureClipboardContent() 直接读取当前剪贴板中的文件/图片
 */

import * as koffi from 'koffi'
import { clipboard } from 'electron'
import { join } from 'path'
import { app } from 'electron'
import { basename, extname } from 'path'
import { nativeSimulateCopy, fallbackSimulateCopy } from './native-keyboard-sim'
import { getClipboardFormat, readClipboardFiles } from '../utils/clipboard-helper'
import { getDarwinFinderSelectedPaths } from './native-finder-selection'
import type { ActiveWindowInfo, InputAttachment } from '../../shared/types/plugin'
import log from 'electron-log'

// ==================== 公共接口 ====================

/** 捕获内容的语义类型 */
export type SelectionKind = 'text' | 'files' | 'image'

/** 取词结果 */
export interface TextSelectionResult {
  /** 获取到的选中文本（null 表示无选中或获取失败） */
  text: string | null
  /** 连带捕获的附件（仅在剪贴板回退或有新选中文件时存在） */
  attachments: InputAttachment[]
  /** 捕获内容的语义类型：text=文本、files=文件选中、image=图片 */
  kind: SelectionKind
  /** 取词来源 */
  source: 'accessibility' | 'clipboard' | 'primary-selection'
  /** 取词耗时（毫秒） */
  durationMs: number
}

/** 剪贴板完整快照（内部隔离格式） */
interface ClipboardSnapshot {
  text: string
  html: string
  rtf: string
  bookmark: { title: string; url: string } | null
  hasImage: boolean
  image: Electron.NativeImage | null
  files: string[]
}

/**
 * 异步获取当前焦点应用的选中文本
 *
 * 优先使用原生 API，失败时自动回退到剪贴板模拟。
 */
export async function getSelectedTextAsync(options?: {
  /** 剪贴板历史管理器（回退模式需要暂停/恢复） */
  clipboardHistoryManager?: { pause(): void; resume(): void }
  /** 输入抑制回调（回退模式需要抑制合成事件） */
  suppressSyntheticInput?: (durationMs: number) => void
  /** 是否允许模拟复制剪贴板回退；macOS 超级面板禁用以避免污染剪贴板 */
  allowClipboardFallback?: boolean
  /** 回退模式等待剪贴板更新的时间（毫秒） */
  fallbackDelayMs?: number
  /** 触发时的前台窗口，用于判断文件管理器中“文件名文本”是否需要二次验证 */
  activeWindow?: ActiveWindowInfo
  /** 触发坐标（屏幕 DIP 坐标），macOS AX 焦点链失效时用于命中鼠标下元素 */
  triggerPoint?: { x: number; y: number }
}): Promise<TextSelectionResult> {
  const start = performance.now()
  const allowClipboardFallback = options?.allowClipboardFallback ?? true

  // 1. 尝试原生 API
  const nativeResult = await getNativeSelectedText(options?.activeWindow, options?.triggerPoint)
  if (nativeResult !== null && nativeResult.trim().length > 0) {
    if (shouldProbeFileSelection(options?.activeWindow)) {
      const fileSelectionAttachments = getNativeFileSelectionAttachments()
      if (fileSelectionAttachments.length > 0) {
        const text = null
        const kind = inferSelectionKind(text, fileSelectionAttachments)
        const durationMs = Math.round(performance.now() - start)
        log.info(`[NativeTextSelection] 原生文件选区读取成功 (${durationMs}ms, nativeText=${nativeResult.length}字符, attachments=${fileSelectionAttachments.length}, kind=${kind})`)
        return { text, attachments: fileSelectionAttachments, kind, source: 'accessibility', durationMs }
      }

      if (allowClipboardFallback) {
        const fallbackResult = await fallbackGetSelectedText(options)
        if (fallbackResult.attachments.length > 0) {
          const text = null
          const kind = inferSelectionKind(text, fallbackResult.attachments)
          const durationMs = Math.round(performance.now() - start)
          log.info(`[NativeTextSelection] 文件管理器附件验证成功 (${durationMs}ms, nativeText=${nativeResult.length}字符, attachments=${fallbackResult.attachments.length}, kind=${kind})`)
          return { text, attachments: fallbackResult.attachments, kind, source: 'clipboard', durationMs }
        }
      }
    }

    const durationMs = Math.round(performance.now() - start)
    log.info(`[NativeTextSelection] 原生取词成功 (${durationMs}ms, ${nativeResult.length}字符, source=${getSourceName()})`)
    return { text: nativeResult, attachments: [], kind: 'text', source: getSourceName(), durationMs }
  }

  // Windows Explorer 的文件选区不一定能被 UIA 文本接口或 Ctrl+C 回退可靠捕获。
  if (shouldProbeFileSelection(options?.activeWindow)) {
    const fileSelectionAttachments = getNativeFileSelectionAttachments()
    if (fileSelectionAttachments.length > 0) {
      const durationMs = Math.round(performance.now() - start)
      const kind = inferSelectionKind(null, fileSelectionAttachments)
      log.info(`[NativeTextSelection] 原生文件选区读取成功 (${durationMs}ms, attachments=${fileSelectionAttachments.length}, kind=${kind})`)
      return { text: null, attachments: fileSelectionAttachments, kind, source: 'accessibility', durationMs }
    }
  }

  if (!allowClipboardFallback) {
    const durationMs = Math.round(performance.now() - start)
    log.info(`[NativeTextSelection] 原生取词无结果，已禁用剪贴板回退 (${durationMs}ms)`)
    return { text: null, attachments: [], kind: 'text', source: getSourceName(), durationMs }
  }

  // 2. 回退到剪贴板模拟（原生 API 未获取到文本，可能是无选中或 API 不可用）
  const fallbackResult = await fallbackGetSelectedText(options)
  const durationMs = Math.round(performance.now() - start)

  if (fallbackResult.text || fallbackResult.attachments.length > 0) {
    const kind = inferSelectionKind(fallbackResult.text, fallbackResult.attachments)
    log.info(`[NativeTextSelection] 剪贴板回退取词 (${durationMs}ms, ${(fallbackResult.text || '').length}字符, attachments=${fallbackResult.attachments.length}, kind=${kind})`)
    return { text: fallbackResult.text, attachments: fallbackResult.attachments, kind, source: 'clipboard', durationMs }
  }

  // 3. 回退也无结果 → 检查剪贴板是否已有文件/图片（用户之前复制的文件/截图）
  const existingAttachments = captureClipboardContent()
  if (existingAttachments.length > 0) {
    const kind = inferSelectionKind(null, existingAttachments)
    log.info(`[NativeTextSelection] 剪贴板附件直接读取 (${durationMs}ms, attachments=${existingAttachments.length}, kind=${kind})`)
    return { text: null, attachments: existingAttachments, kind, source: getSourceName(), durationMs }
  }

  log.info(`[NativeTextSelection] 取词无结果 (${durationMs}ms)`)
  return { text: null, attachments: [], kind: 'text', source: 'clipboard', durationMs }
}

// ==================== 独立附件采集 ====================

/**
 * 独立采集剪贴板中的文件/图片附件（同步）
 *
 * 与文本取词分离，直接读取当前剪贴板格式并提取文件列表或图片。
 * 适用于原生取词成功后补充捕获用户之前复制的文件/图片。
 *
 * 支持：
 * - 文件列表（Finder / Explorer / 文件管理器中复制的文件）
 * - 图片（截图、复制的图片）
 */
export function captureClipboardContent(): InputAttachment[] {
  const attachments: InputAttachment[] = []
  try {
    const format = getClipboardFormat()

    if (format === 'files') {
      const files = readClipboardFiles()
      for (const filePath of files) {
        const name = basename(filePath)
        const ext = extname(filePath)
        const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico']
        const isImage = imageExts.some(e => ext.toLowerCase() === e)
        attachments.push({
          id: `sp_file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name,
          size: 0,
          kind: isImage ? 'image' : 'file',
          ext,
          path: filePath
        })
      }
    } else if (format === 'image') {
      const image = clipboard.readImage()
      if (image && !image.isEmpty()) {
        const pngBuffer = image.toPNG()
        const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`
        attachments.push({
          id: `sp_img_${Date.now()}`,
          name: 'clipboard-image.png',
          size: pngBuffer.length,
          kind: 'image',
          ext: '.png',
          dataUrl
        })
      }
    }
  } catch (err) {
    log.error('[NativeTextSelection] 读取剪贴板附件失败:', err)
  }
  return attachments
}

// ==================== 平台分发 ====================

function getSourceName(): 'accessibility' | 'primary-selection' {
  return process.platform === 'linux' ? 'primary-selection' : 'accessibility'
}

function shouldProbeFileSelection(activeWindow?: ActiveWindowInfo): boolean {
  if (!activeWindow) return false

  const appName = (activeWindow.app || '').toLowerCase()
  const title = (activeWindow.title || '').toLowerCase()
  const bundleId = (activeWindow.bundleId || '').toLowerCase()
  const haystack = `${appName} ${title} ${bundleId}`

  if (process.platform === 'darwin') {
    return bundleId === 'com.apple.finder' || appName.includes('finder') || haystack.includes('访达')
  }

  if (process.platform === 'win32') {
    return (
      appName.includes('explorer') ||
      appName.includes('file explorer') ||
      title.includes('file explorer') ||
      haystack.includes('资源管理器') ||
      haystack.includes('文件资源管理器')
    )
  }

  if (process.platform === 'linux') {
    return [
      'nautilus',
      'dolphin',
      'thunar',
      'nemo',
      'pcmanfm',
      'caja',
      'files',
      '文件'
    ].some((name) => haystack.includes(name))
  }

  return false
}

function getWin32ExplorerSelectionAttachments(): InputAttachment[] {
  if (process.platform !== 'win32') return []

  const t0 = performance.now()
  const selectedPaths = win32GetExplorerSelectedFiles()
  if (selectedPaths.length === 0) {
    log.info(`[NativeTextSelection][ExplorerSelection] 无选中文件 (${Math.round(performance.now() - t0)}ms)`)
    return []
  }
  log.info(`[NativeTextSelection][ExplorerSelection] 读取到 ${selectedPaths.length} 个文件 (${Math.round(performance.now() - t0)}ms)`)
  return selectedPaths.map(filePathToAttachment)
}

function getDarwinFinderSelectionAttachments(): InputAttachment[] {
  if (process.platform !== 'darwin') return []

  const t0 = performance.now()
  const selectedPaths = getDarwinFinderSelectedPaths()
  if (selectedPaths.length === 0) {
    log.info(`[NativeTextSelection][FinderSelection] 无选中文件 (${Math.round(performance.now() - t0)}ms)`)
    return []
  }
  log.info(`[NativeTextSelection][FinderSelection] 读取到 ${selectedPaths.length} 个文件 (${Math.round(performance.now() - t0)}ms)`)
  return selectedPaths.map(filePathToAttachment)
}

function getNativeFileSelectionAttachments(): InputAttachment[] {
  if (process.platform === 'darwin') return getDarwinFinderSelectionAttachments()
  if (process.platform === 'win32') return getWin32ExplorerSelectionAttachments()
  return []
}

export function prepareNativeTextSelectionForActiveWindow(activeWindow?: ActiveWindowInfo | null): void {
  if (process.platform !== 'darwin' || !activeWindow?.pid) return

  try {
    const api = getDarwinAxApi()
    darwinPrepareAccessibilityForPids(api, [activeWindow.pid], 'activeWindow')
  } catch (err) {
    log.warn('[NativeTextSelection][AX] 预激活目标应用无障碍树失败:', err)
  }
}

function filePathToAttachment(filePath: string): InputAttachment {
  const name = basename(filePath)
  const ext = extname(filePath)
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico']
  const isImage = imageExts.some(e => ext.toLowerCase() === e)

  return {
    id: `sp_file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    size: 0,
    kind: isImage ? 'image' : 'file',
    ext,
    path: filePath
  }
}

function uniquePositiveNumbers(values: Array<number | undefined>): number[] {
  const result: number[] = []
  for (const value of values) {
    if (!Number.isFinite(value) || !value || value <= 0) continue
    if (!result.includes(value)) result.push(value)
  }
  return result
}

async function getNativeSelectedText(
  activeWindow?: ActiveWindowInfo,
  triggerPoint?: { x: number; y: number }
): Promise<string | null> {
  const t0 = performance.now()
  try {
    let result: string | null = null
    switch (process.platform) {
      case 'darwin': {
        // 优先使用系统当前前台 PID，缓存 PID 只作为触发瞬间的兜底，避免读到旧应用选区。
        const appPids = uniquePositiveNumbers([darwinGetFrontmostPid(), activeWindow?.pid])
        result = darwinGetSelectedText(appPids, triggerPoint)
        break
      }
      case 'win32':
        result = win32GetSelectedText()
        break
      case 'linux':
        result = await linuxGetSelectedText()
        break
      default:
        break
    }
    const elapsed = Math.round(performance.now() - t0)
    log.info(`[NativeTextSelection][Native] platform=${process.platform}, result=${result !== null ? `${result.length}字符` : 'null'}, elapsed=${elapsed}ms`)
    return result
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0)
    log.warn(`[NativeTextSelection][Native] 原生取词异常 (${elapsed}ms)，交由上层决定是否回退:`, err)
    return null
  }
}

// ==================== macOS: Accessibility API ====================

interface DarwinAxApi {
  AXUIElementCreateSystemWide: () => unknown
  AXUIElementCreateApplication: (pid: number) => unknown
  AXUIElementCopyElementAtPosition: (application: unknown, x: number, y: number, valueOut: unknown[]) => number
  AXUIElementCopyAttributeValue: (element: unknown, attribute: unknown, valueOut: unknown[]) => number
  AXUIElementCopyParameterizedAttributeValue: (element: unknown, attribute: unknown, parameter: unknown, valueOut: unknown[]) => number
  AXUIElementSetAttributeValue: (element: unknown, attribute: unknown, value: unknown) => number
  AXUIElementSetMessagingTimeout: (element: unknown, timeoutInSeconds: number) => number
  AXValueGetValue: (value: unknown, type: number, valueOut: unknown) => boolean
  CFStringCreateWithCString: (alloc: null, str: string, encoding: number) => unknown
  CFStringGetLength: (str: unknown) => number
  CFStringGetCString: (str: unknown, buf: Buffer, bufSize: number, encoding: number) => boolean
  CFRelease: (obj: unknown) => void
  // 预创建的属性名 CFString（避免每次调用重复创建）
  kAXFocusedUIElementAttribute: unknown
  kAXFocusedWindowAttribute: unknown
  kAXParentAttribute: unknown
  kAXRoleAttribute: unknown
  kAXManualAccessibilityAttribute: unknown
  kAXSelectedTextAttribute: unknown
  kAXSelectedTextRangeAttribute: unknown
  kAXSelectedTextMarkerRangeAttribute: unknown
  kAXStringForRangeParameterizedAttribute: unknown
  kAXStringForTextMarkerRangeParameterizedAttribute: unknown
  kAXEnhancedUserInterfaceAttribute: unknown
  kCFBooleanTrue: unknown
}

let _darwinAxApi: DarwinAxApi | null = null

/** 懒加载 macOS Accessibility API 绑定 */
function getDarwinAxApi(): DarwinAxApi {
  if (_darwinAxApi) return _darwinAxApi

  const t0 = performance.now()

  // ApplicationServices 包含 HIServices（Accessibility API 所在子框架）
  const ax = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
  const t1 = performance.now()
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
  const t2 = performance.now()

  const kCFStringEncodingUTF8 = 0x08000100

  // 创建属性名常量（这些 CFString 常驻内存，不需要释放）
  const cfStringCreate = cf.func('void* CFStringCreateWithCString(void*, str, uint32_t)')
  const focusedAttr = cfStringCreate(null, 'AXFocusedUIElement', kCFStringEncodingUTF8)
  const focusedWindowAttr = cfStringCreate(null, 'AXFocusedWindow', kCFStringEncodingUTF8)
  const parentAttr = cfStringCreate(null, 'AXParent', kCFStringEncodingUTF8)
  const roleAttr = cfStringCreate(null, 'AXRole', kCFStringEncodingUTF8)
  const manualAccessibilityAttr = cfStringCreate(null, 'AXManualAccessibility', kCFStringEncodingUTF8)
  const selectedTextAttr = cfStringCreate(null, 'AXSelectedText', kCFStringEncodingUTF8)
  const selectedTextRangeAttr = cfStringCreate(null, 'AXSelectedTextRange', kCFStringEncodingUTF8)
  const selectedTextMarkerRangeAttr = cfStringCreate(null, 'AXSelectedTextMarkerRange', kCFStringEncodingUTF8)
  const stringForRangeAttr = cfStringCreate(null, 'AXStringForRange', kCFStringEncodingUTF8)
  const stringForTextMarkerRangeAttr = cfStringCreate(null, 'AXStringForTextMarkerRange', kCFStringEncodingUTF8)
  const enhancedUserInterfaceAttr = cfStringCreate(null, 'AXEnhancedUserInterface', kCFStringEncodingUTF8)
  const cfBooleanTrue = koffi.decode(cf.symbol('kCFBooleanTrue', 'void*'), 'void*')

  // 检查辅助功能权限
  const AXIsProcessTrusted = ax.func('bool AXIsProcessTrusted()')
  const isTrusted = AXIsProcessTrusted()

  koffi.struct('CFRange', { location: 'int64_t', length: 'int64_t' })

  _darwinAxApi = {
    AXUIElementCreateSystemWide: ax.func('void* AXUIElementCreateSystemWide()'),
    AXUIElementCreateApplication: ax.func('void* AXUIElementCreateApplication(int32_t)'),
    AXUIElementCopyElementAtPosition: ax.func('int32_t AXUIElementCopyElementAtPosition(void*, float, float, _Out_ void**)'),
    // 注意：第三个参数是 CFTypeRef*（即 void**），koffi _Out_ 正确处理
    AXUIElementCopyAttributeValue: ax.func('int32_t AXUIElementCopyAttributeValue(void*, void*, _Out_ void**)'),
    AXUIElementCopyParameterizedAttributeValue: ax.func('int32_t AXUIElementCopyParameterizedAttributeValue(void*, void*, void*, _Out_ void**)'),
    AXUIElementSetAttributeValue: ax.func('int32_t AXUIElementSetAttributeValue(void*, void*, void*)'),
    AXUIElementSetMessagingTimeout: ax.func('int32_t AXUIElementSetMessagingTimeout(void*, float)'),
    AXValueGetValue: ax.func('bool AXValueGetValue(void*, int32_t, _Out_ void*)'),
    CFStringCreateWithCString: cfStringCreate,
    CFStringGetLength: cf.func('int64_t CFStringGetLength(void*)'),
    CFStringGetCString: cf.func('bool CFStringGetCString(void*, _Out_ uint8_t*, int64_t, uint32_t)'),
    CFRelease: cf.func('void CFRelease(void*)'),
    kAXFocusedUIElementAttribute: focusedAttr,
    kAXFocusedWindowAttribute: focusedWindowAttr,
    kAXParentAttribute: parentAttr,
    kAXRoleAttribute: roleAttr,
    kAXManualAccessibilityAttribute: manualAccessibilityAttr,
    kAXSelectedTextAttribute: selectedTextAttr,
    kAXSelectedTextRangeAttribute: selectedTextRangeAttr,
    kAXSelectedTextMarkerRangeAttribute: selectedTextMarkerRangeAttr,
    kAXStringForRangeParameterizedAttribute: stringForRangeAttr,
    kAXStringForTextMarkerRangeParameterizedAttribute: stringForTextMarkerRangeAttr,
    kAXEnhancedUserInterfaceAttribute: enhancedUserInterfaceAttr,
    kCFBooleanTrue: cfBooleanTrue
  }

  const t3 = performance.now()
  log.info(`[NativeTextSelection][AX-Init] koffi 加载: ApplicationServices=${Math.round(t1 - t0)}ms, CoreFoundation=${Math.round(t2 - t1)}ms, FFI绑定=${Math.round(t3 - t2)}ms, AXIsProcessTrusted=${isTrusted}, 总计=${Math.round(t3 - t0)}ms`)

  return _darwinAxApi
}

// ---- macOS: 获取当前前台应用 PID（同步系统调用，不依赖事件缓存） ----

let _darwinNsApi: {
  objc_getClass: (name: string) => unknown
  sel_registerName: (name: string) => unknown
  objc_msgSend: (...args: unknown[]) => unknown
  objc_msgSend_int: (...args: unknown[]) => number
} | null = null

/**
 * 通过 ObjC runtime 调用 NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier
 * 获取当前前台应用的真实 PID（同步，微秒级）
 */
function darwinGetFrontmostPid(): number | undefined {
  try {
    if (!_darwinNsApi) {
      const objcLib = koffi.load('/usr/lib/libobjc.dylib')
      // 加载 AppKit 确保 NSWorkspace 类可用
      koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit')
      _darwinNsApi = {
        objc_getClass: objcLib.func('void* objc_getClass(str)'),
        sel_registerName: objcLib.func('void* sel_registerName(str)'),
        objc_msgSend: objcLib.func('void* objc_msgSend(void*, void*)'),
        objc_msgSend_int: objcLib.func('int32_t objc_msgSend(void*, void*)')
      }
    }
    const api = _darwinNsApi

    // [NSWorkspace sharedWorkspace]
    const NSWorkspace = api.objc_getClass('NSWorkspace')
    const selShared = api.sel_registerName('sharedWorkspace')
    const workspace = api.objc_msgSend(NSWorkspace, selShared)
    if (!workspace) return undefined

    // [workspace frontmostApplication]
    const selFrontmost = api.sel_registerName('frontmostApplication')
    const frontApp = api.objc_msgSend(workspace, selFrontmost)
    if (!frontApp) return undefined

    // [frontApp processIdentifier] -> pid_t (int32)
    const selPid = api.sel_registerName('processIdentifier')
    const pid = api.objc_msgSend_int(frontApp, selPid)
    return pid > 0 ? pid : undefined
  } catch (err) {
    log.warn('[NativeTextSelection] darwinGetFrontmostPid 失败:', err)
    return undefined
  }
}

/**
 * macOS: 通过 Accessibility API 获取当前焦点元素的选中文本
 *
 * 优先使用 AXUIElementCreateApplication(pid) 直接查询触发瞬间的前台应用，
 * 再回退到 systemWide。部分应用会在应用级 AX 根节点上对 AXFocusedUIElement
 * 返回 kAXErrorNoValue，但 systemWide 仍能拿到真实焦点元素。
 *
 * 调用链：
 * AXUIElementCreateApplication(pid) 或 AXUIElementCreateSystemWide()
 *   → AXUIElementCopyAttributeValue(element, "AXFocusedUIElement", &focusedEl)
 *     → AXUIElementCopyAttributeValue(focusedEl, "AXSelectedText", &textRef)
 *       → CFStringGetCString(textRef) → JS string
 */
function darwinGetSelectedText(appPids: number[], triggerPoint?: { x: number; y: number }): string | null {
  const t0 = performance.now()
  const api = getDarwinAxApi()
  const tInit = performance.now()
  const candidates = createDarwinAxRootCandidates(api, appPids)

  if (candidates.length === 0) {
    log.info(`[NativeTextSelection][AX] CreateCandidates 返回空 (${Math.round(performance.now() - t0)}ms)`)
    return null
  }

  try {
    for (const candidate of candidates) {
      const text = darwinReadSelectedTextFromRoot(api, candidate.element, candidate.source, t0, tInit)
      if (text !== null) {
        return text
      }
    }

    if (triggerPoint) {
      for (const candidate of candidates) {
        const text = darwinReadSelectedTextAtPosition(api, candidate.element, candidate.source, triggerPoint, t0, tInit)
        if (text !== null) {
          return text
        }
      }
    }

    return null
  } finally {
    for (const candidate of candidates) {
      api.CFRelease(candidate.element)
    }
  }
}

function createDarwinAxRootCandidates(
  api: DarwinAxApi,
  appPids: number[]
): Array<{ source: string; element: unknown }> {
  const candidates: Array<{ source: string; element: unknown }> = []

  for (const pid of appPids) {
    const element = api.AXUIElementCreateApplication(pid)
    if (!element) {
      continue
    }
    const source = `app(pid=${pid})`
    darwinEnableAccessibilityTree(api, element, source)
    candidates.push({ source, element })
  }

  const systemWide = api.AXUIElementCreateSystemWide()
  if (systemWide) {
    candidates.push({ source: 'systemWide', element: systemWide })
  }

  return candidates
}

function darwinPrepareAccessibilityForPids(api: DarwinAxApi, appPids: number[], reason: string): void {
  for (const pid of uniquePositiveNumbers(appPids)) {
    const element = api.AXUIElementCreateApplication(pid)
    if (!element) {
      continue
    }

    try {
      darwinEnableAccessibilityTree(api, element, `app(pid=${pid}).prepare(${reason})`)
    } finally {
      api.CFRelease(element)
    }
  }
}

function darwinEnableAccessibilityTree(api: DarwinAxApi, element: unknown, source: string): void {
  api.AXUIElementSetMessagingTimeout(element, 0.1)

  darwinSetAccessibilityTreeAttributes(api, element, source)

  const windowOut: unknown[] = [null]
  const windowErr = api.AXUIElementCopyAttributeValue(element, api.kAXFocusedWindowAttribute, windowOut)
  if (windowErr === 0 && windowOut[0]) {
    try {
      darwinSetAccessibilityTreeAttributes(api, windowOut[0], `${source}.focusedWindow`)
    } finally {
      api.CFRelease(windowOut[0])
    }
  }
}

function darwinSetAccessibilityTreeAttributes(api: DarwinAxApi, element: unknown, _source: string): void {
  api.AXUIElementSetAttributeValue(
    element,
    api.kAXManualAccessibilityAttribute,
    api.kCFBooleanTrue
  )
  api.AXUIElementSetAttributeValue(
    element,
    api.kAXEnhancedUserInterfaceAttribute,
    api.kCFBooleanTrue
  )

  const roleRefOut: unknown[] = [null]
  api.AXUIElementCopyAttributeValue(element, api.kAXRoleAttribute, roleRefOut)
  if (roleRefOut[0]) {
    api.CFRelease(roleRefOut[0])
  }
}

function darwinReadSelectedTextFromRoot(
  api: DarwinAxApi,
  axElement: unknown,
  source: string,
  t0: number,
  tInit: number
): string | null {
  // 对根元素设置 100ms 超时，防止目标应用挂起时首次查询阻塞主进程
  api.AXUIElementSetMessagingTimeout(axElement, 0.1)

  const focusedText = darwinReadSelectedTextFromAttribute(
    api,
    axElement,
    api.kAXFocusedUIElementAttribute,
    `${source}.focusedUIElement`,
    t0,
    tInit
  )
  if (focusedText !== null) return focusedText

  const focusedWindowText = darwinReadSelectedTextFromAttribute(
    api,
    axElement,
    api.kAXFocusedWindowAttribute,
    `${source}.focusedWindow`,
    t0,
    tInit
  )
  if (focusedWindowText !== null) return focusedWindowText

  return darwinReadSelectedTextFromElement(api, axElement, `${source}.root`, t0, tInit)
}

function darwinReadSelectedTextFromAttribute(
  api: DarwinAxApi,
  axElement: unknown,
  attribute: unknown,
  source: string,
  t0: number,
  tInit: number
): string | null {
  const elementOut: unknown[] = [null]
  const err = api.AXUIElementCopyAttributeValue(axElement, attribute, elementOut)
  const tElement = performance.now()
  if (err !== 0 || !elementOut[0]) {
    log.info(`[NativeTextSelection][AX] GetElement 失败: source=${source}, AXError=${err}(${darwinAxErrorName(err)}), init=${Math.round(tInit - t0)}ms, element=${Math.round(tElement - tInit)}ms`)
    return null
  }

  const element = elementOut[0]
  try {
    return darwinReadSelectedTextFromElement(api, element, source, t0, tInit)
  } finally {
    api.CFRelease(element)
  }
}

function darwinReadSelectedTextFromElement(
  api: DarwinAxApi,
  element: unknown,
  source: string,
  t0: number,
  tInit: number
): string | null {
  // 对目标元素设置 100ms 超时防止目标应用卡住主线程
  api.AXUIElementSetMessagingTimeout(element, 0.1)

  const textRefOut: unknown[] = [null]
  const err = api.AXUIElementCopyAttributeValue(
    element, api.kAXSelectedTextAttribute, textRefOut
  )
  const tText = performance.now()
  if (err !== 0 || !textRefOut[0]) {
    log.info(`[NativeTextSelection][AX] GetSelectedText 失败: source=${source}, AXError=${err}(${darwinAxErrorName(err)}), hasRef=${!!textRefOut[0]}, init=${Math.round(tInit - t0)}ms, text=${Math.round(tText - tInit)}ms`)
    return darwinReadSelectedTextFromParameterizedRange(api, element, source, t0, tInit)
  }

  const textRef = textRefOut[0]
  try {
    const result = cfStringToJs(api, textRef)
    const tDone = performance.now()
    if (!result || result.trim().length === 0) {
      log.info(`[NativeTextSelection][AX] GetSelectedText 空结果: source=${source}, text=${Math.round(tText - tInit)}ms, convert=${Math.round(tDone - tText)}ms`)
      return darwinReadSelectedTextFromParameterizedRange(api, element, source, t0, tInit)
    }
    log.info(`[NativeTextSelection][AX] 成功: source=${source}, length=${result.length}, text=${Math.round(tText - tInit)}ms, convert=${Math.round(tDone - tText)}ms, 总计=${Math.round(tDone - t0)}ms`)
    return result
  } finally {
    api.CFRelease(textRef)
  }
}

function darwinReadSelectedTextFromParameterizedRange(
  api: DarwinAxApi,
  element: unknown,
  source: string,
  t0: number,
  tInit: number
): string | null {
  const rangeText = darwinReadSelectedTextFromRange(api, element, source, t0, tInit)
  if (rangeText !== null) return rangeText

  return darwinReadSelectedTextFromTextMarkerRange(api, element, source, t0, tInit)
}

function darwinReadSelectedTextFromRange(
  api: DarwinAxApi,
  element: unknown,
  source: string,
  t0: number,
  tInit: number
): string | null {
  const rangeRefOut: unknown[] = [null]
  const err = api.AXUIElementCopyAttributeValue(element, api.kAXSelectedTextRangeAttribute, rangeRefOut)
  const tRange = performance.now()
  if (err !== 0 || !rangeRefOut[0]) {
    log.info(`[NativeTextSelection][AX] GetSelectedTextRange 失败: source=${source}, AXError=${err}(${darwinAxErrorName(err)}), hasRef=${!!rangeRefOut[0]}, range=${Math.round(tRange - tInit)}ms`)
    return null
  }

  const rangeRef = rangeRefOut[0]
  try {
    const range: { location?: number; length?: number } = {}
    const ok = api.AXValueGetValue(rangeRef, 4, koffi.as(range, 'CFRange *'))
    if (!ok) {
      log.info(`[NativeTextSelection][AX] AXValueGetValue(range) 失败: source=${source}`)
      return null
    }
    if (!range.length || range.length <= 0) {
      log.info(`[NativeTextSelection][AX] SelectedTextRange 空范围: source=${source}, location=${range.location ?? -1}, length=${range.length ?? 0}`)
      return null
    }

    return darwinReadStringForParameterizedAttribute(
      api,
      element,
      api.kAXStringForRangeParameterizedAttribute,
      rangeRef,
      `${source}.stringForRange`,
      t0,
      tInit
    )
  } finally {
    api.CFRelease(rangeRef)
  }
}

function darwinReadSelectedTextFromTextMarkerRange(
  api: DarwinAxApi,
  element: unknown,
  source: string,
  t0: number,
  tInit: number
): string | null {
  const markerRangeOut: unknown[] = [null]
  const err = api.AXUIElementCopyAttributeValue(element, api.kAXSelectedTextMarkerRangeAttribute, markerRangeOut)
  const tRange = performance.now()
  if (err !== 0 || !markerRangeOut[0]) {
    log.info(`[NativeTextSelection][AX] GetSelectedTextMarkerRange 失败: source=${source}, AXError=${err}(${darwinAxErrorName(err)}), hasRef=${!!markerRangeOut[0]}, range=${Math.round(tRange - tInit)}ms`)
    return null
  }

  const markerRange = markerRangeOut[0]
  try {
    return darwinReadStringForParameterizedAttribute(
      api,
      element,
      api.kAXStringForTextMarkerRangeParameterizedAttribute,
      markerRange,
      `${source}.stringForTextMarkerRange`,
      t0,
      tInit
    )
  } finally {
    api.CFRelease(markerRange)
  }
}

function darwinReadStringForParameterizedAttribute(
  api: DarwinAxApi,
  element: unknown,
  attribute: unknown,
  parameter: unknown,
  source: string,
  t0: number,
  tInit: number
): string | null {
  const textRefOut: unknown[] = [null]
  const err = api.AXUIElementCopyParameterizedAttributeValue(element, attribute, parameter, textRefOut)
  const tText = performance.now()
  if (err !== 0 || !textRefOut[0]) {
    log.info(`[NativeTextSelection][AX] GetParameterizedText 失败: source=${source}, AXError=${err}(${darwinAxErrorName(err)}), hasRef=${!!textRefOut[0]}, text=${Math.round(tText - tInit)}ms`)
    return null
  }

  const textRef = textRefOut[0]
  try {
    const result = cfStringToJs(api, textRef)
    const tDone = performance.now()
    if (!result || result.trim().length === 0) {
      log.info(`[NativeTextSelection][AX] GetParameterizedText 空结果: source=${source}, text=${Math.round(tText - tInit)}ms, convert=${Math.round(tDone - tText)}ms`)
      return null
    }
    log.info(`[NativeTextSelection][AX] 参数化取词成功: source=${source}, length=${result.length}, text=${Math.round(tText - tInit)}ms, convert=${Math.round(tDone - tText)}ms, 总计=${Math.round(tDone - t0)}ms`)
    return result
  } finally {
    api.CFRelease(textRef)
  }
}

function darwinReadSelectedTextAtPosition(
  api: DarwinAxApi,
  axElement: unknown,
  source: string,
  point: { x: number; y: number },
  t0: number,
  tInit: number
): string | null {
  api.AXUIElementSetMessagingTimeout(axElement, 0.1)

  const elementOut: unknown[] = [null]
  const err = api.AXUIElementCopyElementAtPosition(axElement, point.x, point.y, elementOut)
  const tHit = performance.now()
  if (err !== 0 || !elementOut[0]) {
    log.info(`[NativeTextSelection][AX] ElementAtPosition 失败: source=${source}, point=${Math.round(point.x)},${Math.round(point.y)}, AXError=${err}(${darwinAxErrorName(err)}), init=${Math.round(tInit - t0)}ms, hit=${Math.round(tHit - tInit)}ms`)
    return null
  }

  let element = elementOut[0]
  try {
    for (let depth = 0; depth < 4 && element; depth++) {
      const text = darwinReadSelectedTextFromElement(api, element, `${source}.atPosition(depth=${depth})`, t0, tInit)
      if (text !== null) {
        return text
      }

      const parentOut: unknown[] = [null]
      const parentErr = api.AXUIElementCopyAttributeValue(element, api.kAXParentAttribute, parentOut)
      if (parentErr !== 0 || !parentOut[0]) {
        log.info(`[NativeTextSelection][AX] GetParent 失败: source=${source}.atPosition(depth=${depth}), AXError=${parentErr}(${darwinAxErrorName(parentErr)})`)
        return null
      }

      const parent = parentOut[0]
      api.CFRelease(element)
      element = parent
    }
  } finally {
    if (element) {
      api.CFRelease(element)
    }
  }

  return null
}

function darwinAxErrorName(error: number): string {
  switch (error) {
    case 0: return 'Success'
    case -25200: return 'Failure'
    case -25201: return 'IllegalArgument'
    case -25202: return 'InvalidUIElement'
    case -25203: return 'InvalidUIElementObserver'
    case -25204: return 'CannotComplete'
    case -25205: return 'AttributeUnsupported'
    case -25206: return 'ActionUnsupported'
    case -25207: return 'NotificationUnsupported'
    case -25208: return 'NotImplemented'
    case -25209: return 'NotificationAlreadyRegistered'
    case -25210: return 'NotificationNotRegistered'
    case -25211: return 'APIDisabled'
    case -25212: return 'NoValue'
    case -25213: return 'ParameterizedAttributeUnsupported'
    case -25214: return 'NotEnoughPrecision'
    default: return 'Unknown'
  }
}

/** 将 CFStringRef 转换为 JS string */
function cfStringToJs(api: DarwinAxApi, cfStr: unknown): string | null {
  const kCFStringEncodingUTF8 = 0x08000100
  const len = Number(api.CFStringGetLength(cfStr))
  if (len <= 0) return null

  // UTF-8 最多 4 字节/字符 + 终止符
  const bufSize = len * 4 + 1
  const buf = Buffer.alloc(bufSize)
  const ok = api.CFStringGetCString(cfStr, buf, bufSize, kCFStringEncodingUTF8)
  if (!ok) return null

  // 寻找 null 终止符
  const nullIdx = buf.indexOf(0)
  return buf.toString('utf8', 0, nullIdx >= 0 ? nullIdx : bufSize)
}

// ==================== Windows: UI Automation DLL ====================

interface Win32TextSelectionApi {
  GetSelectedTextW: (buffer: Buffer, bufferSize: number) => number
  GetExplorerSelectedFilesW: (buffer: Buffer, bufferSize: number) => number
}

let _win32TsApi: Win32TextSelectionApi | null = null
/** DLL 加载是否已失败（缓存失败状态，避免每次触发都重复尝试和打日志） */
let _win32TsApiFailed = false

/**
 * Windows: 通过预编译 DLL 调用 UI Automation 获取选中文本
 *
 * DLL 封装了复杂的 COM vtable 调用：
 * CoCreateInstance(CLSID_CUIAutomation) → GetFocusedElement → GetCurrentPattern(TextPatternId)
 * → GetSelection → GetText
 *
 * 耗时：~5-15ms
 *
 * 注意：DLL 需要在 Windows 上用 MSVC 编译后放入 native/win32-text-selection/ 目录，
 * 并将该目录添加到 electron-builder 的 extraResources 配置中。
 * DLL 不存在时自动回退到剪贴板模拟（仅首次打印警告）。
 */
function win32GetSelectedText(): string | null {
  if (_win32TsApiFailed) return null
  if (!_win32TsApi) {
    try {
      // 查找预编译 DLL 路径
      // electron-builder extraResources 放到 resources/ 下，非 app.asar.unpacked/
      let dllPath: string
      if (app.isPackaged) {
        dllPath = join(process.resourcesPath, 'native', 'win32-text-selection', 'text_selection.dll')
      } else {
        dllPath = join(app.getAppPath(), 'native', 'win32-text-selection', 'build', 'Release', 'text_selection.dll')
      }

      const dll = koffi.load(dllPath)
      _win32TsApi = {
        GetSelectedTextW: dll.func('int GetSelectedTextW(_Out_ uint8_t*, int)'),
        GetExplorerSelectedFilesW: dll.func('int GetExplorerSelectedFilesW(_Out_ uint8_t*, int)')
      }
    } catch (err) {
      _win32TsApiFailed = true
      log.warn('[NativeTextSelection] Windows UIA DLL 加载失败，将始终使用剪贴板回退。', err)
      return null
    }
  }

  const buffer = Buffer.alloc(65536) // 32K wchar_t
  const len = _win32TsApi.GetSelectedTextW(buffer, 32768)
  if (len <= 0) return null

  return koffi.decode(buffer, 'char16_t', len) as string
}

function win32GetExplorerSelectedFiles(): string[] {
  if (_win32TsApiFailed) return []
  if (!_win32TsApi) {
    win32GetSelectedText()
  }
  if (!_win32TsApi) return []

  try {
    const buffer = Buffer.alloc(65536)
    const len = _win32TsApi.GetExplorerSelectedFilesW(buffer, 32768)
    if (len <= 0) return []

    const raw = koffi.decode(buffer, 'char16_t', len) as string
    return raw
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
  } catch (err) {
    log.warn('[NativeTextSelection] Explorer 文件选区读取失败:', err)
    return []
  }
}

// ==================== Linux: X11 PRIMARY Selection ====================

/**
 * Linux: 通过 xclip/xsel/wl-paste 读取 PRIMARY selection
 *
 * X11 中，鼠标选中的文本自动写入 PRIMARY selection（无需 Ctrl+C）。
 * Wayland 中，使用 wl-paste --primary 替代。
 *
 * 优先级：xclip → xsel → wl-paste
 *
 * 耗时：~5-20ms（子进程）
 */
function linuxGetSelectedText(): string | null {
  // 删除基于 PRIMARY 的获取，由于 Linux 缺乏可靠的前台应用选择状态校验，
  // 过去滞留的 PRIMARY 文本往往会导致用户无选中的唤醒展示成了错误旧文本。
  // 此处一律返回 null，让 Linux 统一触发基于 Ctrl+C 的回退取词。
  return null
}

// ==================== 剪贴板回退方案 ====================

/** 保存剪贴板完整快照 */
function snapshotClipboard(): ClipboardSnapshot {
  const text = clipboard.readText() || ''
  const html = clipboard.readHTML() || ''
  const rtf = clipboard.readRTF() || ''
  let bookmark: { title: string; url: string } | null = null
  try {
    const bm = clipboard.readBookmark()
    if (bm && bm.url) bookmark = bm
  } catch { /* 部分平台不支持 */ }
  const image = clipboard.readImage()
  const hasImage = image && !image.isEmpty()
  let files: string[] = []
  try {
    if (getClipboardFormat() === 'files') {
      files = readClipboardFiles()
    }
  } catch { /* 忽略 */ }
  return {
    text,
    html,
    rtf,
    bookmark,
    hasImage: !!hasImage,
    image: hasImage ? image : null,
    files
  }
}

/**
 * 恢复原始剪贴板状态
 *
 * 注意：Electron 的 clipboard API 无法写回文件列表格式（NSFilenamesPboardType / CF_HDROP），
 * 如果快照中包含文件，强行恢复会用纯文本覆盖文件列表，导致用户剪贴板损坏。
 * 此时跳过恢复，保留模拟 Cmd+C 后的剪贴板状态（可能已被新内容覆盖，但至少不会丢失文件列表）。
 */
function restoreClipboard(snap: ClipboardSnapshot): void {
  // 快照中有文件时跳过恢复（无法重建文件格式，恢复会导致数据损坏）
  if (snap.files.length > 0) return

  try {
    if (snap.hasImage && snap.image) {
      clipboard.writeImage(snap.image)
    } else if (snap.html) {
      clipboard.write({
        text: snap.text,
        html: snap.html,
        rtf: snap.rtf || undefined,
        bookmark: snap.bookmark ? `${snap.bookmark.title}\n${snap.bookmark.url}` : undefined
      })
    } else {
      clipboard.writeText(snap.text)
    }
  } catch (err) {
    log.error('[NativeTextSelection] 恢复剪贴板失败:', err)
  }
}

/** 比较差异，提取新附件 */
function parseClipboardAttachments(savedSnapshot: ClipboardSnapshot): InputAttachment[] {
  const attachments: InputAttachment[] = []
  try {
    const format = getClipboardFormat()

    if (format === 'files') {
      const files = readClipboardFiles()
      if (savedSnapshot.files.length > 0) {
        const oldFiles = savedSnapshot.files
        if (files.length === oldFiles.length && files.every((f, i) => f === oldFiles[i])) {
          return [] 
        }
      }

      for (const filePath of files) {
        const name = basename(filePath)
        const ext = extname(filePath)
        const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico']
        const isImage = imageExts.some(e => ext.toLowerCase() === e)

        attachments.push({
          id: `sp_file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name,
          size: 0,
          kind: isImage ? 'image' : 'file',
          ext,
          path: filePath
        })
      }
    } else if (format === 'image') {
      if (savedSnapshot.hasImage) {
        return []
      }

      const image = clipboard.readImage()
      if (image && !image.isEmpty()) {
        const pngBuffer = image.toPNG()
        const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`
        attachments.push({
          id: `sp_img_${Date.now()}`,
          name: 'clipboard-image.png',
          size: pngBuffer.length,
          kind: 'image',
          ext: '.png',
          dataUrl
        })
      }
    }
  } catch (err) {
    log.error('[NativeTextSelection] 解析剪贴板附件失败:', err)
  }
  return attachments
}

/**
 * 回退方案：模拟 Cmd/Ctrl+C + 短延迟 + 剪贴板比较
 *
 * 仅在原生 API 完全失败时使用。
 * 相比旧方案的改进：
 * - 固定短延迟（30ms）替代轮询循环
 * - 模拟复制后立即恢复剪贴板，严格保证一致性
 */
async function fallbackGetSelectedText(options?: {
  clipboardHistoryManager?: { pause(): void; resume(): void }
  suppressSyntheticInput?: (durationMs: number) => void
  fallbackDelayMs?: number
}): Promise<{ text: string | null; attachments: InputAttachment[] }> {
  const t0 = performance.now()
  const delayMs = options?.fallbackDelayMs ?? 50
  log.info(`[NativeTextSelection][Fallback] 开始, delayMs=${delayMs}`)

  // 1. 保存当前剪贴板状态快照
  const snap = snapshotClipboard()
  const tSnap = performance.now()
  log.info(`[NativeTextSelection][Fallback] 快照完成 (${Math.round(tSnap - t0)}ms), snap.text=${snap.text.length}字符, files=${snap.files.length}, hasImage=${snap.hasImage}`)

  // 2. 暂停剪贴板历史
  options?.clipboardHistoryManager?.pause()

  let text: string | null = null
  let attachments: InputAttachment[] = []

  try {
    // 3. 抑制合成事件（避免污染双击检测）
    options?.suppressSyntheticInput?.(100)

    // 4. 模拟 Cmd/Ctrl+C
    const tCopyStart = performance.now()
    let copySuccess = nativeSimulateCopy()
    const tNativeCopy = performance.now()
    log.info(`[NativeTextSelection][Fallback] nativeSimulateCopy: ${copySuccess ? '成功' : '失败'} (${Math.round(tNativeCopy - tCopyStart)}ms)`)

    if (!copySuccess) {
      copySuccess = await fallbackSimulateCopy()
      const tFallbackCopy = performance.now()
      log.info(`[NativeTextSelection][Fallback] fallbackSimulateCopy: ${copySuccess ? '成功' : '失败'} (${Math.round(tFallbackCopy - tNativeCopy)}ms)`)
    }
    
    if (copySuccess) {
      // 5. 轮询等待剪贴板更新（检测文本变化或文件格式变化）
      const startTime = Date.now()
      const pollInterval = 10
      let pollCount = 0
      const snapFormat = getClipboardFormat()
      while (Date.now() - startTime < delayMs) {
        await sleep(pollInterval)
        pollCount++
        const currentText = clipboard.readText() || ''
        if (currentText !== snap.text) {
          break
        }
        // Windows: 文件复制不改变 readText()，额外检测格式从非 files 变为 files
        if (snapFormat !== 'files' && getClipboardFormat() === 'files') {
          break
        }
      }
      const tPoll = performance.now()
      log.info(`[NativeTextSelection][Fallback] 轮询完成: ${pollCount}次, elapsed=${Math.round(tPoll - tNativeCopy)}ms`)
      
      const newText = clipboard.readText() || ''
      const hasNew = newText !== snap.text && newText.trim().length > 0
      if (hasNew) {
        text = newText
      }
      log.info(`[NativeTextSelection][Fallback] 剪贴板变化: ${hasNew}, newLen=${newText.length}, oldLen=${snap.text.length}`)
      
      attachments = parseClipboardAttachments(snap)
      if (attachments.length > 0 && attachmentTextMatches(text, attachments)) {
        text = null
      }
    }
    const tDone = performance.now()
    log.info(`[NativeTextSelection][Fallback] 完成: text=${text !== null ? `${text.length}字符` : 'null'}, attachments=${attachments.length}, 总计=${Math.round(tDone - t0)}ms`)
    return { text, attachments }
  } finally {
    // 6. 等待可能的延迟 copy 写入沉淀后，再恢复原始剪贴板内容（防止迟到的 copy 覆盖用户原始剪贴板），
    // 7. 然后恢复剪贴板历史采样
    setTimeout(() => {
      restoreClipboard(snap)
      options?.clipboardHistoryManager?.resume()
    }, 50)
  }
}

/** Promise 化的延迟 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 根据取词结果推断语义类型。
 *
 * 规则：
 * - 有文件附件（kind=file）且无有效文本 → 'files'
 * - 仅有图片附件且无有效文本 → 'image'
 * - 其他 → 'text'
 */
function inferSelectionKind(text: string | null, attachments: InputAttachment[]): SelectionKind {
  const hasText = text !== null && text.trim().length > 0
  if (attachments.length === 0) return 'text'

  const fileAttachments = attachments.filter(a => a.kind === 'file')
  const imageAttachments = attachments.filter(a => a.kind === 'image')
  const textIsAttachmentLabel = hasText && attachmentTextMatches(text, attachments)

  if (fileAttachments.length > 0 && (!hasText || textIsAttachmentLabel)) return 'files'
  if (imageAttachments.length > 0 && fileAttachments.length === 0 && (!hasText || textIsAttachmentLabel)) return 'image'

  return 'text'
}

function attachmentTextMatches(text: string | null, attachments: InputAttachment[]): boolean {
  const value = (text || '').trim()
  if (!value) return false

  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length > 1) {
    return lines.every((line) => attachments.some((attachment) => attachmentTextLineMatches(line, attachment)))
  }

  return attachments.some((attachment) => attachmentTextLineMatches(value, attachment))
}

function attachmentTextLineMatches(value: string, attachment: InputAttachment): boolean {
  if (!attachment.path && !attachment.name) return false
  if (attachment.path && attachment.path === value) return true
  if (attachment.name && attachment.name === value) return true
  if (value.includes('/') || value.includes('\\')) return false
  return Boolean(
    attachment.path &&
    (attachment.path.endsWith(`/${value}`) || attachment.path.endsWith(`\\${value}`))
  )
}
