import { BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import { withIgnoringBlur } from './blur-manager'

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

async function measureContentLayout(
  win: BrowserWindow,
  fallback: number
): Promise<{ contentHeight: number; overflowHeight: number }> {
  try {
    const raw = await win.webContents.executeJavaScript(
      `(() => {
        const card = document.querySelector('.card');
        const cardHeight = card ? Math.ceil(card.getBoundingClientRect().height) : 0;
        const body = document.body;
        const docEl = document.documentElement;
        const bodyScrollHeight = body ? Math.max(body.scrollHeight, body.offsetHeight) : 0;
        const docScrollHeight = docEl ? Math.max(docEl.scrollHeight, docEl.offsetHeight) : 0;
        const contentHeight = Math.max(cardHeight, bodyScrollHeight, docScrollHeight, ${fallback});
        const viewportHeight = Math.max(
          body ? body.clientHeight : 0,
          docEl ? docEl.clientHeight : 0
        );
        const overflowHeight = Math.max(0, contentHeight - viewportHeight);
        return { contentHeight, overflowHeight };
      })()`,
      true
    )
    if (!raw || typeof raw !== 'object') {
      return { contentHeight: fallback, overflowHeight: 0 }
    }
    const contentValue = Number((raw as { contentHeight?: unknown }).contentHeight)
    const overflowValue = Number((raw as { overflowHeight?: unknown }).overflowHeight)
    const contentHeight = Number.isFinite(contentValue) && contentValue > 0 ? Math.ceil(contentValue) : fallback
    const overflowHeight = Number.isFinite(overflowValue) && overflowValue > 0 ? Math.ceil(overflowValue) : 0
    return { contentHeight, overflowHeight }
  } catch {
    return { contentHeight: fallback, overflowHeight: 0 }
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
    html, body { height: 100%; }
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
      flex: 1;
      display: flex;
      flex-direction: column;
      background: ${palette.cardBg};
      overflow: hidden;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 22px;
      border-bottom: 1px solid ${palette.divider};
      -webkit-app-region: drag;
      user-select: none;
    }
    .title {
      font-size: 15px;
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
      flex: 1;
      padding: 20px 22px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .message {
      font-size: 14px;
      line-height: 1.6;
      color: ${palette.messageText};
      word-break: break-word;
    }
    .detail {
      font-size: 13px;
      line-height: 1.55;
      color: ${palette.detailText};
      word-break: break-word;
      border-radius: 10px;
      border: 1px solid ${palette.detailBorder};
      background: ${palette.detailBg};
      padding: 10px 14px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 22px 18px;
      border-top: 1px solid ${palette.divider};
    }
    .btn {
      appearance: none;
      outline: none;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 500;
      padding: 7px 18px;
      min-width: 72px;
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
  const width = 600
  const initialHeight = 260

  return await withIgnoringBlur(async () => {
    const channel = `ui-dialog:message-box:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const parent = pickDefaultParent(input?.parentWindow)
    const display = pickDisplay(parent)
    const win = new BrowserWindow({
      width,
      height: initialHeight,
      useContentSize: true,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      title: options.title || '提示',
      backgroundColor: theme === 'dark' ? '#0b1220' : '#f8fafc',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })

    win.setBounds(buildCenteredBounds({ parent, display, width, height: initialHeight }))

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
          const measured = await measureContentLayout(win, initialHeight)
          const maxHeight = Math.max(200, display.workArea.height - 24)
          let finalHeight = clamp(measured.contentHeight, 220, maxHeight)
          if (measured.overflowHeight > 0 && finalHeight < maxHeight) {
            finalHeight = clamp(finalHeight + measured.overflowHeight + 8, 220, maxHeight)
          }
          if (win.isDestroyed()) return
          win.setBounds(buildCenteredBounds({ parent, display, width, height: finalHeight }))
          const secondPass = await measureContentLayout(win, finalHeight)
          if (secondPass.overflowHeight > 0 && finalHeight < maxHeight && !win.isDestroyed()) {
            finalHeight = clamp(finalHeight + secondPass.overflowHeight + 4, 220, maxHeight)
            win.setBounds(buildCenteredBounds({ parent, display, width, height: finalHeight }))
          }
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
