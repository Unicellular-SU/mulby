import { BrowserWindow, ipcMain, screen } from 'electron'
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

function colorByType(type: UiMessageBoxOptions['type']): { chipBg: string; chipText: string; chipLabel: string } {
  switch (type) {
    case 'error':
      return { chipBg: '#fee2e2', chipText: '#991b1b', chipLabel: 'Error' }
    case 'warning':
      return { chipBg: '#fef3c7', chipText: '#92400e', chipLabel: 'Warning' }
    case 'question':
      return { chipBg: '#dbeafe', chipText: '#1e3a8a', chipLabel: 'Question' }
    case 'info':
      return { chipBg: '#e0f2fe', chipText: '#0c4a6e', chipLabel: 'Info' }
    default:
      return { chipBg: '#e2e8f0', chipText: '#334155', chipLabel: 'Message' }
  }
}

function buildMessageBoxHtml(input: {
  options: UiMessageBoxOptions
  channel: string
  buttons: string[]
  defaultId: number
  cancelId: number
}): string {
  const typeStyle = colorByType(input.options.type)
  const title = escapeHtml(input.options.title || '提示')
  const message = escapeHtml(input.options.message || '')
  const detail = escapeHtml(input.options.detail || '')
  const buttonsHtml = input.buttons
    .map((label, index) => {
      const escaped = escapeHtml(label)
      const isPrimary = index === input.defaultId
      return `<button data-index="${index}" class="btn ${isPrimary ? 'btn-primary' : 'btn-default'}">${escaped}</button>`
    })
    .join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 100%;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: radial-gradient(110% 120% at 15% 0%, #dbeafe 0%, #eef2ff 40%, #f8fafc 100%);
      color: #0f172a;
    }
    .card {
      width: 100%;
      border-radius: 0;
      border: 1px solid #cbd5e1;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 20px 56px rgba(15, 23, 42, 0.22);
      overflow: hidden;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 14px 18px;
      border-bottom: 1px solid #e2e8f0;
    }
    .title {
      margin: 0;
      font-size: 15px;
      font-weight: 650;
      line-height: 1.35;
    }
    .chip {
      border-radius: 999px;
      font-size: 11px;
      padding: 3px 8px;
      background: ${typeStyle.chipBg};
      color: ${typeStyle.chipText};
      border: 1px solid rgba(148, 163, 184, 0.4);
      white-space: nowrap;
    }
    .body {
      padding: 16px 18px;
      display: grid;
      gap: 10px;
    }
    .message {
      font-size: 14px;
      line-height: 1.5;
      color: #0f172a;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .detail {
      font-size: 12px;
      line-height: 1.5;
      color: #334155;
      white-space: pre-wrap;
      word-break: break-word;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      padding: 10px 12px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 18px 16px;
      border-top: 1px solid #e2e8f0;
    }
    .btn {
      appearance: none;
      border-radius: 999px;
      font-size: 12px;
      padding: 8px 12px;
      border: 1px solid #cbd5e1;
      cursor: pointer;
      background: #fff;
      color: #1e293b;
    }
    .btn-default:hover { border-color: #94a3b8; }
    .btn-primary {
      background: #0f172a;
      color: #fff;
      border-color: #0f172a;
      font-weight: 600;
    }
    .btn-primary:hover { background: #111827; }
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
    const send = (index) => ipcRenderer.send(channel, index);

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
      backgroundColor: '#f8fafc',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })

    win.setBounds(buildCenteredBounds({ parent, display, width, height: initialHeight }))

    const html = buildMessageBoxHtml({ options, channel, buttons, defaultId, cancelId })
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
