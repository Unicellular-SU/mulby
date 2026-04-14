import { app, BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import { withIgnoringBlur, hasDetachedWindows } from './blur-manager'

export interface UiMessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title?: string
  message: string
  detail?: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
}

export interface UiMessageBoxResult {
  response: number
  checkboxChecked: boolean
}

type UiDialogTheme = 'light' | 'dark'

let themeResolver: () => UiDialogTheme = () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')

export function setUiDialogThemeResolver(resolver?: (() => UiDialogTheme) | null): void {
  if (typeof resolver === 'function') {
    themeResolver = resolver
    return
  }
  themeResolver = () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
}

function getUiDialogTheme(): UiDialogTheme {
  try {
    const value = themeResolver()
    return value === 'dark' ? 'dark' : 'light'
  } catch {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }
}

function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function clampIndex(input: number | undefined, max: number, fallback: number): number {
  const value = Number(input)
  if (!Number.isFinite(value)) return fallback
  const index = Math.floor(value)
  if (index < 0 || index >= max) return fallback
  return index
}

function pickDefaultParent(input?: BrowserWindow | null): BrowserWindow | null {
  if (input && !input.isDestroyed()) return input
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  const candidates = BrowserWindow.getAllWindows().filter((item) => !item.isDestroyed() && item.isVisible())
  return candidates[0] || null
}

function normalizeButtons(input?: string[]): string[] {
  if (!Array.isArray(input) || input.length === 0) return ['OK']
  const out = input.map((item) => String(item || '').trim()).filter(Boolean)
  return out.length > 0 ? out : ['OK']
}

function clamp(input: number, min: number, max: number): number {
  return Math.min(Math.max(input, min), max)
}

function pickDisplay(parent: BrowserWindow | null): Electron.Display {
  if (parent && !parent.isDestroyed()) {
    return screen.getDisplayMatching(parent.getBounds())
  }
  return screen.getPrimaryDisplay()
}

function buildCenteredBounds(input: {
  parent: BrowserWindow | null
  display: Electron.Display
  width: number
  height: number
}): Electron.Rectangle {
  const { display, width, height, parent } = input
  const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = display.workArea
  const maxX = Math.max(areaX, areaX + areaWidth - width)
  const maxY = Math.max(areaY, areaY + areaHeight - height)

  if (parent && !parent.isDestroyed()) {
    const [px, py] = parent.getPosition()
    const [pw, ph] = parent.getSize()
    const centeredX = Math.floor(px + (pw - width) / 2)
    const centeredY = Math.floor(py + (ph - height) / 2)
    return {
      x: clamp(centeredX, areaX, maxX),
      y: clamp(centeredY, areaY, maxY),
      width,
      height
    }
  }

  return {
    x: Math.floor(areaX + (areaWidth - width) / 2),
    y: Math.floor(areaY + (areaHeight - height) / 2),
    width,
    height
  }
}

async function measureNaturalHeight(win: BrowserWindow): Promise<number> {
  try {
    const height = await win.webContents.executeJavaScript(
      `(() => {
        const card = document.querySelector('.card');
        if (!card) return 200;
        return Math.ceil(card.getBoundingClientRect().height);
      })()`,
      true
    )
    const value = Number(height)
    return Number.isFinite(value) && value > 0 ? value : 200
  } catch {
    return 200
  }
}

async function applyConstrainedLayout(win: BrowserWindow): Promise<void> {
  try {
    await win.webContents.executeJavaScript(
      `(() => {
        document.documentElement.style.cssText = 'height:100%;overflow:hidden';
        Object.assign(document.body.style, { height:'100%', overflow:'hidden' });
        const card = document.querySelector('.card');
        if (card) Object.assign(card.style, { height:'100%', flex:'1', overflow:'hidden' });
        const bd = document.querySelector('.body');
        if (bd) Object.assign(bd.style, { flex:'1', minHeight:'0', overflowY:'auto' });
      })()`,
      true
    )
  } catch {
    // ignore
  }
}

function colorByType(
  type: UiMessageBoxOptions['type'],
  theme: UiDialogTheme
): { chipBg: string; chipText: string; chipLabel: string } {
  const isDark = theme === 'dark'
  switch (type) {
    case 'error':
      return isDark
        ? { chipBg: '#3b0a14', chipText: '#fecdd3', chipLabel: 'Error' }
        : { chipBg: '#fee2e2', chipText: '#991b1b', chipLabel: 'Error' }
    case 'warning':
      return isDark
        ? { chipBg: '#3a2605', chipText: '#fde68a', chipLabel: 'Warning' }
        : { chipBg: '#fef3c7', chipText: '#92400e', chipLabel: 'Warning' }
    case 'question':
      return isDark
        ? { chipBg: '#102347', chipText: '#bfdbfe', chipLabel: 'Question' }
        : { chipBg: '#dbeafe', chipText: '#1e3a8a', chipLabel: 'Question' }
    case 'info':
      return isDark
        ? { chipBg: '#082f49', chipText: '#bae6fd', chipLabel: 'Info' }
        : { chipBg: '#e0f2fe', chipText: '#0c4a6e', chipLabel: 'Info' }
    default:
      return isDark
        ? { chipBg: '#1e293b', chipText: '#cbd5e1', chipLabel: 'Message' }
        : { chipBg: '#e2e8f0', chipText: '#334155', chipLabel: 'Message' }
  }
}

function buildMessageBoxHtml(input: {
  options: UiMessageBoxOptions
  channel: string
  buttons: string[]
  defaultId: number
  cancelId: number
  theme: UiDialogTheme
}): string {
  const typeStyle = colorByType(input.options.type, input.theme)
  const isDark = input.theme === 'dark'
  const palette = isDark
    ? {
      pageBg: 'radial-gradient(120% 120% at 15% 0%, #0b2447 0%, #111827 42%, #020617 100%)',
      text: '#e2e8f0',
      cardBorder: '#334155',
      cardBg: 'rgba(15, 23, 42, 0.96)',
      cardShadow: '0 20px 56px rgba(2, 6, 23, 0.6)',
      divider: '#334155',
      messageText: '#e2e8f0',
      detailText: '#cbd5e1',
      detailBorder: '#334155',
      detailBg: '#0f172a',
      buttonBg: '#0f172a',
      buttonText: '#e2e8f0',
      buttonBorder: '#475569',
      buttonHoverBorder: '#64748b',
      primaryBg: '#e2e8f0',
      primaryText: '#0f172a',
      primaryHoverBg: '#cbd5e1'
    }
    : {
      pageBg: 'radial-gradient(110% 120% at 15% 0%, #dbeafe 0%, #eef2ff 40%, #f8fafc 100%)',
      text: '#0f172a',
      cardBorder: '#cbd5e1',
      cardBg: 'rgba(255, 255, 255, 0.96)',
      cardShadow: '0 20px 56px rgba(15, 23, 42, 0.22)',
      divider: '#e2e8f0',
      messageText: '#0f172a',
      detailText: '#334155',
      detailBorder: '#e2e8f0',
      detailBg: '#f8fafc',
      buttonBg: '#ffffff',
      buttonText: '#1e293b',
      buttonBorder: '#cbd5e1',
      buttonHoverBorder: '#94a3b8',
      primaryBg: '#0f172a',
      primaryText: '#ffffff',
      primaryHoverBg: '#111827'
    }
  const title = escapeHtml(input.options.title || '提示')
  const message = escapeHtml(input.options.message || '')
  const detail = escapeHtml(input.options.detail || '')
  const buttonsHtml = input.buttons
    .map((label, index) => {
      const escaped = escapeHtml(label)
      const isPrimary = index === input.defaultId
      const autoFocus = isPrimary ? ' autofocus' : ''
      return `<button data-index="${index}" class="btn ${isPrimary ? 'btn-primary' : 'btn-default'}"${autoFocus}>${escaped}</button>`
    })
    .join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root { color-scheme: ${input.theme}; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 100%;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
      background: ${palette.pageBg};
      color: ${palette.text};
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .card {
      width: 100%;
      display: flex;
      flex-direction: column;
      background: ${palette.cardBg};
    }
    @keyframes dialogIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .card { animation: dialogIn 0.18s ease-out; }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid ${palette.divider};
      -webkit-app-region: drag;
      user-select: none;
    }
    .title {
      font-size: 14px;
      font-weight: 650;
      line-height: 1.4;
      letter-spacing: -0.01em;
    }
    .chip {
      -webkit-app-region: no-drag;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 500;
      padding: 3px 10px;
      background: ${typeStyle.chipBg};
      color: ${typeStyle.chipText};
      border: 1px solid ${isDark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.35)'};
      white-space: nowrap;
      letter-spacing: 0.02em;
    }
    .body {
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .message {
      font-size: 13.5px;
      line-height: 1.6;
      color: ${palette.messageText};
      word-break: break-word;
    }
    .detail {
      font-size: 12.5px;
      line-height: 1.55;
      color: ${palette.detailText};
      word-break: break-word;
      border-radius: 8px;
      border: 1px solid ${palette.detailBorder};
      background: ${palette.detailBg};
      padding: 10px 14px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 18px 14px;
      border-top: 1px solid ${palette.divider};
    }
    .btn {
      appearance: none;
      outline: none;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 500;
      padding: 6px 16px;
      min-width: 64px;
      border: 1px solid ${palette.buttonBorder};
      cursor: pointer;
      background: ${palette.buttonBg};
      color: ${palette.buttonText};
      transition: all 0.15s ease;
      -webkit-app-region: no-drag;
    }
    .btn:active { transform: scale(0.97); }
    .btn:focus-visible {
      outline: 2px solid ${isDark ? '#60a5fa' : '#3b82f6'};
      outline-offset: 2px;
    }
    .btn-default:hover {
      border-color: ${palette.buttonHoverBorder};
      background: ${isDark ? '#1e293b' : '#f1f5f9'};
    }
    .btn-primary {
      background: ${palette.primaryBg};
      color: ${palette.primaryText};
      border-color: ${palette.primaryBg};
      font-weight: 600;
    }
    .btn-primary:hover {
      background: ${palette.primaryHoverBg};
      box-shadow: ${isDark ? '0 2px 8px rgba(226, 232, 240, 0.15)' : '0 2px 8px rgba(15, 23, 42, 0.2)'};
    }
    .body::-webkit-scrollbar { width: 5px; }
    .body::-webkit-scrollbar-track { background: transparent; }
    .body::-webkit-scrollbar-thumb {
      background: ${isDark ? 'rgba(148,163,184,0.25)' : 'rgba(100,116,139,0.2)'};
      border-radius: 3px;
    }
    .body::-webkit-scrollbar-thumb:hover {
      background: ${isDark ? 'rgba(148,163,184,0.4)' : 'rgba(100,116,139,0.35)'};
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="head">
      <h1 class="title">${title}</h1>
      <span class="chip">${escapeHtml(typeStyle.chipLabel)}</span>
    </div>
    <div class="body">
      <div class="message">${message}</div>
      ${detail ? `<div class="detail">${detail}</div>` : ''}
    </div>
    <div class="actions">${buttonsHtml}</div>
  </div>

  <script>
    const { ipcRenderer } = require('electron');
    const channel = ${JSON.stringify(input.channel)};
    const defaultId = ${input.defaultId};
    const cancelId = ${input.cancelId};
    let sent = false;
    const send = (index) => {
      if (sent) return;
      sent = true;
      ipcRenderer.send(channel, index);
    };

    for (const btn of document.querySelectorAll('.btn')) {
      btn.addEventListener('click', () => {
        const index = Number(btn.getAttribute('data-index') || 0);
        send(index);
      });
    }

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        send(cancelId);
      } else if (event.key === 'Enter') {
        send(defaultId);
      }
    });
  </script>
</body>
</html>`
}

export async function showInternalMessageBox(
  options: UiMessageBoxOptions,
  input?: { parentWindow?: BrowserWindow | null }
): Promise<UiMessageBoxResult> {
  const theme = getUiDialogTheme()
  const buttons = normalizeButtons(options.buttons)
  const defaultId = clampIndex(options.defaultId, buttons.length, 0)
  const cancelId = clampIndex(options.cancelId, buttons.length, 0)
  const width = 480
  const measureHeight = 800

  return await withIgnoringBlur(async () => {
    const channel = `ui-dialog:message-box:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const parent = pickDefaultParent(input?.parentWindow)
    const display = pickDisplay(parent)
    const maxHeight = Math.max(200, display.workArea.height - 48)
    const win = new BrowserWindow({
      width,
      height: measureHeight,
      useContentSize: true,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: options.title || '提示',
      backgroundColor: theme === 'dark' ? '#0b1220' : '#f8fafc',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })

    // Place off-screen for invisible measurement
    win.setPosition(-9999, -9999)

    const html = buildMessageBoxHtml({ options, channel, buttons, defaultId, cancelId, theme })
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`

    return await new Promise<UiMessageBoxResult>((resolve) => {
      let settled = false
      const finish = (response: number) => {
        if (settled) return
        settled = true
        ipcMain.removeListener(channel, onResponse)
        if (!win.isDestroyed()) {
          win.close()
        }

        // 补偿 macOS LaunchServices 被激活唤醒后遗留的 Dock 图标
        if (process.platform === 'darwin' && app.dock) {
          setTimeout(() => {
            // 如果存在其他已分离的窗口（哪怕被最小化或隐藏），都不应当强行隐藏 Dock
            const hasOtherVisibleDialogs = BrowserWindow.getAllWindows().some(w => !w.isDestroyed() && w.isVisible() && w.id !== win.id)
            if (!hasDetachedWindows() && !hasOtherVisibleDialogs) {
              app.dock?.hide()
            }
          }, 50)
        }

        resolve({ response, checkboxChecked: false })
      }

      const onResponse = (_event: Electron.IpcMainEvent, rawIndex: unknown) => {
        const numeric = Number(rawIndex)
        const index = Number.isFinite(numeric) ? clampIndex(numeric, buttons.length, cancelId) : cancelId
        finish(index)
      }

      ipcMain.on(channel, onResponse)

      win.on('closed', () => {
        finish(cancelId)
      })

      win.webContents.once('did-finish-load', () => {
        void (async () => {
          if (win.isDestroyed()) return
          // Measure natural content height (HTML has no height constraints)
          const naturalHeight = await measureNaturalHeight(win)
          const finalHeight = clamp(naturalHeight, 120, maxHeight)

          if (win.isDestroyed()) return
          // Apply constrained layout so .body scrolls when content exceeds window
          await applyConstrainedLayout(win)

          if (win.isDestroyed()) return
          win.setBounds(buildCenteredBounds({ parent, display, width, height: finalHeight }))
          win.show()
          win.focus()
        })()
      })

      void win.loadURL(dataUrl).catch(() => {
        finish(cancelId)
      })
    })
  })
}
