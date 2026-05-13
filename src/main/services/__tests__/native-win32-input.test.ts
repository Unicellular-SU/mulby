import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildWin32KeyboardTapInputs,
  buildWin32UnicodeTextInputs,
  createWin32HdropBuffer,
  INPUT_KEYBOARD,
  KEYEVENTF_KEYUP,
  KEYEVENTF_UNICODE,
  restoreWin32ForegroundWindowWithApi,
  writeWin32FilesToClipboardWithApi
} from '../native-win32-input'
import type { Win32ClipboardApi, Win32FocusApi, Win32Input } from '../native-win32-input'

function keyboardEventDetails(event: Win32Input): { type: number; vk: number; scan: number; flags: number } {
  assert.ok(event.u.ki, 'expected keyboard input')
  return {
    type: event.type,
    vk: event.u.ki.wVk,
    scan: event.u.ki.wScan,
    flags: event.u.ki.dwFlags
  }
}

function unicodeEventDetails(event: Win32Input): { vk: number; scan: number; flags: number } {
  const details = keyboardEventDetails(event)
  return {
    vk: details.vk,
    scan: details.scan,
    flags: details.flags
  }
}

describe('native win32 input builders', () => {
  it('builds a native ctrl+v keyboard sequence without SendKeys syntax', () => {
    const events = buildWin32KeyboardTapInputs('v', ['ctrl'])

    assert.deepEqual(
      events.map(keyboardEventDetails),
      [
        { type: INPUT_KEYBOARD, vk: 0x11, scan: 0, flags: 0 },
        { type: INPUT_KEYBOARD, vk: 0x56, scan: 0, flags: 0 },
        { type: INPUT_KEYBOARD, vk: 0x56, scan: 0, flags: KEYEVENTF_KEYUP },
        { type: INPUT_KEYBOARD, vk: 0x11, scan: 0, flags: KEYEVENTF_KEYUP }
      ]
    )
  })

  it('keeps the Windows key available as a native modifier', () => {
    const events = buildWin32KeyboardTapInputs('r', ['win'])

    assert.deepEqual(
      events.map(keyboardEventDetails),
      [
        { type: INPUT_KEYBOARD, vk: 0x5B, scan: 0, flags: 1 },
        { type: INPUT_KEYBOARD, vk: 0x52, scan: 0, flags: 0 },
        { type: INPUT_KEYBOARD, vk: 0x52, scan: 0, flags: KEYEVENTF_KEYUP },
        { type: INPUT_KEYBOARD, vk: 0x5B, scan: 0, flags: 1 | KEYEVENTF_KEYUP }
      ]
    )
  })

  it('types non-ascii text with KEYEVENTF_UNICODE code units', () => {
    const events = buildWin32UnicodeTextInputs('中A')

    assert.deepEqual(
      events.map(unicodeEventDetails),
      [
        { vk: 0, scan: '中'.charCodeAt(0), flags: KEYEVENTF_UNICODE },
        { vk: 0, scan: '中'.charCodeAt(0), flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP },
        { vk: 0, scan: 'A'.charCodeAt(0), flags: KEYEVENTF_UNICODE },
        { vk: 0, scan: 'A'.charCodeAt(0), flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP }
      ]
    )
  })

  it('creates a CF_HDROP DROPFILES payload with utf-16 double-null paths', () => {
    const buffer = createWin32HdropBuffer([
      'C:\\Temp\\demo.txt',
      'D:\\Docs\\演示.docx'
    ])

    assert.equal(buffer.readUInt32LE(0), 20, 'pFiles must point after the DROPFILES header')
    assert.equal(buffer.readInt32LE(4), 0, 'drop point x defaults to 0')
    assert.equal(buffer.readInt32LE(8), 0, 'drop point y defaults to 0')
    assert.equal(buffer.readInt32LE(12), 0, 'fNC defaults to false')
    assert.equal(buffer.readInt32LE(16), 1, 'fWide must request Unicode paths')
    assert.equal(buffer.subarray(20).toString('utf16le'), 'C:\\Temp\\demo.txt\0D:\\Docs\\演示.docx\0\0')
  })

  it('writes CF_HDROP data through native memory copy instead of external ArrayBuffer views', () => {
    const hMem = { kind: 'hMem' }
    const lockedPtr = { kind: 'lockedPtr' }
    const calls: string[] = []
    let copied: Buffer | null = null
    const api: Win32ClipboardApi = {
      OpenClipboard: () => {
        calls.push('OpenClipboard')
        return 1
      },
      EmptyClipboard: () => {
        calls.push('EmptyClipboard')
        return 1
      },
      SetClipboardData: (_format, mem) => {
        calls.push('SetClipboardData')
        assert.equal(mem, hMem)
        return hMem
      },
      CloseClipboard: () => {
        calls.push('CloseClipboard')
        return 1
      },
      GlobalAlloc: (_flags, bytes) => {
        calls.push(`GlobalAlloc:${bytes}`)
        return hMem
      },
      GlobalLock: (mem) => {
        calls.push('GlobalLock')
        assert.equal(mem, hMem)
        return lockedPtr
      },
      GlobalUnlock: (mem) => {
        calls.push('GlobalUnlock')
        assert.equal(mem, hMem)
        return 1
      },
      GlobalFree: () => {
        calls.push('GlobalFree')
        return null
      },
      CopyMemory: (dest, source, bytes) => {
        calls.push(`CopyMemory:${bytes}`)
        assert.equal(dest, lockedPtr)
        copied = Buffer.from(source)
      },
      GetLastError: () => 0
    }

    const paths = ['C:\\Temp\\demo.txt']
    assert.equal(writeWin32FilesToClipboardWithApi(api, paths), true)
    assert.deepEqual(copied, createWin32HdropBuffer(paths))
    assert.deepEqual(calls, [
      'OpenClipboard',
      'EmptyClipboard',
      `GlobalAlloc:${createWin32HdropBuffer(paths).byteLength}`,
      'GlobalLock',
      `CopyMemory:${createWin32HdropBuffer(paths).byteLength}`,
      'GlobalUnlock',
      'SetClipboardData',
      'CloseClipboard'
    ])
  })

  it('restores the cached target window using foreground-thread attachment', () => {
    const targetHwnd = { kind: 'target' }
    const foregroundHwnd = { kind: 'mulby' }
    const calls: string[] = []
    const api: Win32FocusApi = {
      IsWindow: (hWnd) => {
        calls.push('IsWindow')
        assert.equal(hWnd, targetHwnd)
        return 1
      },
      IsIconic: () => {
        calls.push('IsIconic')
        return 1
      },
      ShowWindow: (hWnd, command) => {
        calls.push(`ShowWindow:${command}`)
        assert.equal(hWnd, targetHwnd)
        return 1
      },
      BringWindowToTop: (hWnd) => {
        calls.push('BringWindowToTop')
        assert.equal(hWnd, targetHwnd)
        return 1
      },
      SetForegroundWindow: (hWnd) => {
        calls.push('SetForegroundWindow')
        assert.equal(hWnd, targetHwnd)
        return 1
      },
      GetForegroundWindow: () => {
        calls.push('GetForegroundWindow')
        return foregroundHwnd
      },
      GetWindowThreadProcessId: (hWnd) => {
        calls.push(hWnd === targetHwnd ? 'GetTargetThread' : 'GetForegroundThread')
        return hWnd === targetHwnd ? 20 : 30
      },
      GetCurrentThreadId: () => {
        calls.push('GetCurrentThreadId')
        return 10
      },
      AttachThreadInput: (from, to, attach) => {
        calls.push(`AttachThreadInput:${from}:${to}:${attach}`)
        return 1
      },
      GetLastError: () => 0
    }

    assert.equal(restoreWin32ForegroundWindowWithApi(api, targetHwnd), true)
    assert.deepEqual(calls, [
      'IsWindow',
      'IsIconic',
      'ShowWindow:9',
      'GetCurrentThreadId',
      'GetTargetThread',
      'GetForegroundWindow',
      'GetForegroundThread',
      'AttachThreadInput:10:20:1',
      'AttachThreadInput:10:30:1',
      'BringWindowToTop',
      'SetForegroundWindow',
      'AttachThreadInput:10:30:0',
      'AttachThreadInput:10:20:0'
    ])
  })
})
