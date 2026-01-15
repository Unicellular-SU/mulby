import { BrowserWindow, clipboard, nativeImage } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const FOCUS_DELAY_MS = 120

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function hideFocusedWindow(): void {
  const win = BrowserWindow.getFocusedWindow()
  if (win && !win.isDestroyed()) {
    win.hide()
  }
}

function writeImageToClipboard(image: string | Buffer): boolean {
  try {
    let nativeImg: Electron.NativeImage
    if (Buffer.isBuffer(image)) {
      nativeImg = nativeImage.createFromBuffer(image)
    } else if (typeof image === 'string') {
      if (image.startsWith('data:image')) {
        nativeImg = nativeImage.createFromDataURL(image)
      } else {
        nativeImg = nativeImage.createFromPath(image)
      }
    } else {
      return false
    }

    if (!nativeImg || nativeImg.isEmpty()) return false
    clipboard.writeImage(nativeImg)
    return true
  } catch (error) {
    console.error('[Input] Failed to write image to clipboard:', error)
    return false
  }
}

function writeFilesToClipboard(filePaths: string | string[]): boolean {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
  if (paths.length === 0) return false

  if (process.platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${paths.map(p => `    <string>${p}</string>`).join('\n')}
</array>
</plist>`
    clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist))
    return true
  }

  if (process.platform === 'win32') {
    // @ts-ignore - Electron 20+ supports clipboard.write({ files })
    if (clipboard.write && typeof clipboard.write === 'function') {
      // @ts-ignore
      clipboard.write({ files: paths })
      return true
    }
    return false
  }

  const uriList = paths.map(p => `file://${p}`).join('\n')
  clipboard.writeBuffer('text/uri-list', Buffer.from(uriList))
  return true
}

function escapeSendKeys(text: string): string {
  const map: Record<string, string> = {
    '{': '{{}',
    '}': '{}}',
    '+': '{+}',
    '^': '{^}',
    '%': '{%}',
    '~': '{~}',
    '(': '{(}',
    ')': '{)}'
  }
  return text.replace(/[{}+^%~()]/g, ch => map[ch])
}

async function sendPasteShortcut(): Promise<void> {
  if (process.platform === 'darwin') {
    await execFileAsync('osascript', [
      '-e',
      'tell application "System Events" to keystroke "v" using command down'
    ])
    return
  }

  if (process.platform === 'win32') {
    const script = '$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys("^v")'
    await execFileAsync('powershell', ['-NoProfile', '-Command', script])
    return
  }

  await execFileAsync('xdotool', ['key', '--clearmodifiers', 'ctrl+v'])
}

async function sendTypeString(text: string): Promise<void> {
  if (process.platform === 'darwin') {
    await execFileAsync('osascript', [
      '-e',
      'on run argv',
      '-e',
      'tell application "System Events" to keystroke (item 1 of argv)',
      '-e',
      'end run',
      text
    ])
    return
  }

  if (process.platform === 'win32') {
    const escaped = escapeSendKeys(text)
    const script = 'param([string]$text) Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait($text)'
    await execFileAsync('powershell', ['-NoProfile', '-Command', script, escaped])
    return
  }

  await execFileAsync('xdotool', ['type', '--clearmodifiers', '--delay', '1', '--', text])
}

async function withHiddenWindow(action: () => Promise<void>): Promise<void> {
  hideFocusedWindow()
  await sleep(FOCUS_DELAY_MS)
  await action()
}

export const pluginInput = {
  async hideMainWindowPasteText(text: string): Promise<boolean> {
    try {
      clipboard.writeText(text)
      await withHiddenWindow(() => sendPasteShortcut())
      return true
    } catch (error) {
      console.error('[Input] Failed to paste text:', error)
      return false
    }
  },
  async hideMainWindowPasteImage(image: string | Buffer): Promise<boolean> {
    try {
      const ok = writeImageToClipboard(image)
      if (!ok) return false
      await withHiddenWindow(() => sendPasteShortcut())
      return true
    } catch (error) {
      console.error('[Input] Failed to paste image:', error)
      return false
    }
  },
  async hideMainWindowPasteFile(filePaths: string | string[]): Promise<boolean> {
    try {
      const ok = writeFilesToClipboard(filePaths)
      if (!ok) return false
      await withHiddenWindow(() => sendPasteShortcut())
      return true
    } catch (error) {
      console.error('[Input] Failed to paste file:', error)
      return false
    }
  },
  async hideMainWindowTypeString(text: string): Promise<boolean> {
    try {
      await withHiddenWindow(() => sendTypeString(text))
      return true
    } catch (error) {
      console.error('[Input] Failed to type string:', error)
      return false
    }
  }
}
