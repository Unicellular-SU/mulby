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
import type { InputAttachment } from '../../shared/types/plugin'

// ==================== 公共接口 ====================

/** 取词结果 */
export interface TextSelectionResult {
  /** 获取到的选中文本（null 表示无选中或获取失败） */
  text: string | null
  /** 连带捕获的附件（仅在剪贴板回退或有新选中文件时存在） */
  attachments: InputAttachment[]
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
  /** 回退模式等待剪贴板更新的时间（毫秒） */
  fallbackDelayMs?: number
}): Promise<TextSelectionResult> {
  const start = performance.now()

  // 1. 尝试原生 API
  const nativeResult = await getNativeSelectedText()
  if (nativeResult !== null && nativeResult.trim().length > 0) {
    const durationMs = Math.round(performance.now() - start)
    console.log(`[NativeTextSelection] 原生取词成功 (${durationMs}ms, ${nativeResult.length}字符, source=${getSourceName()})`)
    // 原生取词只会有文本，不提取附件避免污染
    return { text: nativeResult, attachments: [], source: getSourceName(), durationMs }
  }

  // 2. 回退到剪贴板模拟（原生 API 未获取到文本，可能是无选中或 API 不可用）
  const fallbackResult = await fallbackGetSelectedText(options)
  const durationMs = Math.round(performance.now() - start)

  if (fallbackResult.text || fallbackResult.attachments.length > 0) {
    console.log(`[NativeTextSelection] 剪贴板回退取词 (${durationMs}ms, ${(fallbackResult.text || '').length}字符, attachments=${fallbackResult.attachments.length})`)
    return { text: fallbackResult.text, attachments: fallbackResult.attachments, source: 'clipboard', durationMs }
  }

  // 3. 回退也无结果 → 检查剪贴板是否已有文件/图片（用户之前复制的文件/截图）
  // 放在回退之后，确保不会因剪贴板中有旧附件而跳过对选中文本的捕获
  const existingAttachments = captureClipboardContent()
  if (existingAttachments.length > 0) {
    console.log(`[NativeTextSelection] 剪贴板附件直接读取 (${durationMs}ms, attachments=${existingAttachments.length})`)
    return { text: null, attachments: existingAttachments, source: getSourceName(), durationMs }
  }

  console.log(`[NativeTextSelection] 取词无结果 (${durationMs}ms)`)
  return { text: null, attachments: [], source: 'clipboard', durationMs }
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
    console.error('[NativeTextSelection] 读取剪贴板附件失败:', err)
  }
  return attachments
}

// ==================== 平台分发 ====================

function getSourceName(): 'accessibility' | 'primary-selection' {
  return process.platform === 'linux' ? 'primary-selection' : 'accessibility'
}

async function getNativeSelectedText(): Promise<string | null> {
  const t0 = performance.now()
  try {
    let result: string | null = null
    switch (process.platform) {
      case 'darwin': {
        // 直接通过系统调用获取当前前台应用 PID
        const appPid = darwinGetFrontmostPid()
        result = darwinGetSelectedText(appPid)
        // 注意：双击修饰键触发时，macOS 菜单栏激活/反激活会导致 AXFocusedUIElement 变为 nil，
        // 这是系统行为，重试无效。快速失败后立即进入剪贴板回退。
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
    console.log(`[NativeTextSelection][Native] platform=${process.platform}, result=${result !== null ? `${result.length}字符` : 'null'}, elapsed=${elapsed}ms`)
    return result
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0)
    console.warn(`[NativeTextSelection][Native] 原生取词异常 (${elapsed}ms)，将使用剪贴板回退:`, err)
    return null
  }
}

// ==================== macOS: Accessibility API ====================

interface DarwinAxApi {
  AXUIElementCreateSystemWide: () => unknown
  AXUIElementCreateApplication: (pid: number) => unknown
  AXUIElementCopyAttributeValue: (element: unknown, attribute: unknown, valueOut: unknown[]) => number
  AXUIElementSetMessagingTimeout: (element: unknown, timeoutInSeconds: number) => number
  CFStringCreateWithCString: (alloc: null, str: string, encoding: number) => unknown
  CFStringGetLength: (str: unknown) => number
  CFStringGetCString: (str: unknown, buf: Buffer, bufSize: number, encoding: number) => boolean
  CFRelease: (obj: unknown) => void
  // 预创建的属性名 CFString（避免每次调用重复创建）
  kAXFocusedUIElementAttribute: unknown
  kAXSelectedTextAttribute: unknown
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
  const selectedTextAttr = cfStringCreate(null, 'AXSelectedText', kCFStringEncodingUTF8)

  // 检查辅助功能权限
  const AXIsProcessTrusted = ax.func('bool AXIsProcessTrusted()')
  const isTrusted = AXIsProcessTrusted()

  _darwinAxApi = {
    AXUIElementCreateSystemWide: ax.func('void* AXUIElementCreateSystemWide()'),
    AXUIElementCreateApplication: ax.func('void* AXUIElementCreateApplication(int32_t)'),
    // 注意：第三个参数是 CFTypeRef*（即 void**），koffi _Out_ 正确处理
    AXUIElementCopyAttributeValue: ax.func('int32_t AXUIElementCopyAttributeValue(void*, void*, _Out_ void**)'),
    AXUIElementSetMessagingTimeout: ax.func('int32_t AXUIElementSetMessagingTimeout(void*, float)'),
    CFStringCreateWithCString: cfStringCreate,
    CFStringGetLength: cf.func('int64_t CFStringGetLength(void*)'),
    CFStringGetCString: cf.func('bool CFStringGetCString(void*, _Out_ uint8_t*, int64_t, uint32_t)'),
    CFRelease: cf.func('void CFRelease(void*)'),
    kAXFocusedUIElementAttribute: focusedAttr,
    kAXSelectedTextAttribute: selectedTextAttr
  }

  const t3 = performance.now()
  console.log(`[NativeTextSelection][AX-Init] koffi 加载: ApplicationServices=${Math.round(t1 - t0)}ms, CoreFoundation=${Math.round(t2 - t1)}ms, FFI绑定=${Math.round(t3 - t2)}ms, AXIsProcessTrusted=${isTrusted}, 总计=${Math.round(t3 - t0)}ms`)

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
    console.warn('[NativeTextSelection] darwinGetFrontmostPid 失败:', err)
    return undefined
  }
}

/**
 * macOS: 通过 Accessibility API 获取当前焦点元素的选中文本
 *
 * 优先使用 AXUIElementCreateApplication(pid) 直接查询已知前台应用的焦点元素，
 * 避免 AXUIElementCreateSystemWide() 在双击修饰键后因菜单栏焦点干扰返回 kAXErrorNoValue。
 * 如无 PID 则回退到 systemWide。
 *
 * 调用链：
 * AXUIElementCreateApplication(pid) 或 AXUIElementCreateSystemWide()
 *   → AXUIElementCopyAttributeValue(element, "AXFocusedUIElement", &focusedEl)
 *     → AXUIElementCopyAttributeValue(focusedEl, "AXSelectedText", &textRef)
 *       → CFStringGetCString(textRef) → JS string
 */
function darwinGetSelectedText(appPid?: number): string | null {
  const t0 = performance.now()
  const api = getDarwinAxApi()
  const tInit = performance.now()

  // 1. 创建 AX 元素：优先使用应用级（绕过系统焦点追踪），回退到系统级
  let axElement: unknown = null
  let source = 'systemWide'
  if (appPid && appPid > 0) {
    axElement = api.AXUIElementCreateApplication(appPid)
    source = `app(pid=${appPid})`
  }
  if (!axElement) {
    axElement = api.AXUIElementCreateSystemWide()
    source = 'systemWide'
  }
  if (!axElement) {
    console.log(`[NativeTextSelection][AX] Create${source} 返回 null (${Math.round(performance.now() - t0)}ms)`)
    return null
  }

  try {
    // 对 axElement 设置 100ms 超时，防止目标应用挂起时首次查询阻塞主进程
    api.AXUIElementSetMessagingTimeout(axElement, 0.1)

    // 2. 获取当前焦点 UI 元素
    const focusedElOut: unknown[] = [null]
    const err1 = api.AXUIElementCopyAttributeValue(
      axElement, api.kAXFocusedUIElementAttribute, focusedElOut
    )
    const tFocused = performance.now()
    if (err1 !== 0 || !focusedElOut[0]) {
      console.log(`[NativeTextSelection][AX] GetFocusedElement 失败: source=${source}, AXError=${err1}, init=${Math.round(tInit - t0)}ms, focused=${Math.round(tFocused - tInit)}ms`)
      return null
    }

    const focusedEl = focusedElOut[0]
    try {
      // 对 focusedEl 设置 100ms 超时防止目标应用卡住主线程
      api.AXUIElementSetMessagingTimeout(focusedEl, 0.1)
      
      // 3. 获取选中文本属性
      const textRefOut: unknown[] = [null]
      const err2 = api.AXUIElementCopyAttributeValue(
        focusedEl, api.kAXSelectedTextAttribute, textRefOut
      )
      const tText = performance.now()
      if (err2 !== 0 || !textRefOut[0]) {
        console.log(`[NativeTextSelection][AX] GetSelectedText 失败: source=${source}, AXError=${err2}, hasRef=${!!textRefOut[0]}, focused=${Math.round(tFocused - tInit)}ms, text=${Math.round(tText - tFocused)}ms`)
        return null
      }

      const textRef = textRefOut[0]
      try {
        // 4. CFStringRef → JS string
        const result = cfStringToJs(api, textRef)
        const tDone = performance.now()
        console.log(`[NativeTextSelection][AX] 成功: source=${source}, focused=${Math.round(tFocused - tInit)}ms, text=${Math.round(tText - tFocused)}ms, convert=${Math.round(tDone - tText)}ms, 总计=${Math.round(tDone - t0)}ms`)
        return result
      } finally {
        api.CFRelease(textRef)
      }
    } finally {
      api.CFRelease(focusedEl)
    }
  } finally {
    api.CFRelease(axElement)
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
        GetSelectedTextW: dll.func('int GetSelectedTextW(_Out_ uint8_t*, int)')
      }
    } catch (err) {
      _win32TsApiFailed = true
      console.warn('[NativeTextSelection] Windows UIA DLL 加载失败，将始终使用剪贴板回退。', err)
      return null
    }
  }

  const buffer = Buffer.alloc(65536) // 32K wchar_t
  const len = _win32TsApi.GetSelectedTextW(buffer, 32768)
  if (len <= 0) return null

  return koffi.decode(buffer, 'char16_t', len) as string
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
    console.error('[NativeTextSelection] 恢复剪贴板失败:', err)
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
    console.error('[NativeTextSelection] 解析剪贴板附件失败:', err)
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
  console.log(`[NativeTextSelection][Fallback] 开始, delayMs=${delayMs}`)

  // 1. 保存当前剪贴板状态快照
  const snap = snapshotClipboard()
  const tSnap = performance.now()
  console.log(`[NativeTextSelection][Fallback] 快照完成 (${Math.round(tSnap - t0)}ms), snap.text=${snap.text.length}字符, files=${snap.files.length}, hasImage=${snap.hasImage}`)

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
    console.log(`[NativeTextSelection][Fallback] nativeSimulateCopy: ${copySuccess ? '成功' : '失败'} (${Math.round(tNativeCopy - tCopyStart)}ms)`)

    if (!copySuccess) {
      copySuccess = await fallbackSimulateCopy()
      const tFallbackCopy = performance.now()
      console.log(`[NativeTextSelection][Fallback] fallbackSimulateCopy: ${copySuccess ? '成功' : '失败'} (${Math.round(tFallbackCopy - tNativeCopy)}ms)`)
    }
    
    if (copySuccess) {
      // 5. 轮询等待剪贴板更新
      const startTime = Date.now()
      const pollInterval = 10
      let pollCount = 0
      while (Date.now() - startTime < delayMs) {
        await sleep(pollInterval)
        pollCount++
        const currentText = clipboard.readText() || ''
        if (currentText !== snap.text) {
          break
        }
      }
      const tPoll = performance.now()
      console.log(`[NativeTextSelection][Fallback] 轮询完成: ${pollCount}次, elapsed=${Math.round(tPoll - tNativeCopy)}ms`)
      
      const newText = clipboard.readText() || ''
      const hasNew = newText !== snap.text && newText.trim().length > 0
      if (hasNew) {
        text = newText
      }
      console.log(`[NativeTextSelection][Fallback] 剪贴板变化: ${hasNew}, newLen=${newText.length}, oldLen=${snap.text.length}`)
      
      attachments = parseClipboardAttachments(snap)
    }
    const tDone = performance.now()
    console.log(`[NativeTextSelection][Fallback] 完成: text=${text !== null ? `${text.length}字符` : 'null'}, attachments=${attachments.length}, 总计=${Math.round(tDone - t0)}ms`)
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
