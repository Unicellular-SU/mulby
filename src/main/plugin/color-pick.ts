import { BrowserWindow, ipcMain, nativeImage, screen } from 'electron'
import { join } from 'path'
import { pluginScreen } from './screen'

interface ColorPickResult {
  hex: string
  rgb: string
  r: number
  g: number
  b: number
}

interface ColorPickerWindow {
  window: BrowserWindow
  displayId: number
  bounds: { x: number; y: number; width: number; height: number }
}

let pickerWindows: ColorPickerWindow[] = []
let pickResolve: ((result: ColorPickResult | null) => void) | null = null

function getColorPickHTML(displayInfo: object): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>屏幕取色</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; cursor: crosshair; user-select: none; }
    #tip { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 10px 20px; background: rgba(0,0,0,0.85); color: white; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; border-radius: 6px; z-index: 1000; }
    #magnifier { position: fixed; width: 120px; height: 120px; border-radius: 12px; background: rgba(0,0,0,0.85); border: 2px solid rgba(255,255,255,0.9); box-shadow: 0 6px 20px rgba(0,0,0,0.35); overflow: hidden; pointer-events: none; z-index: 1000; }
    #magnifier canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
    #magnifier .crosshair { position: absolute; left: 50%; top: 50%; width: 100%; height: 100%; transform: translate(-50%, -50%); }
    #magnifier .crosshair::before,
    #magnifier .crosshair::after { content: ''; position: absolute; background: rgba(255,255,255,0.9); }
    #magnifier .crosshair::before { left: 50%; top: 0; width: 1px; height: 100%; transform: translateX(-50%); }
    #magnifier .crosshair::after { top: 50%; left: 0; height: 1px; width: 100%; transform: translateY(-50%); }
  </style>
</head>
<body>
  <div id="tip">点击取色，按 ESC 取消</div>
  <div id="magnifier">
    <canvas id="magnifier-canvas" width="120" height="120"></canvas>
    <div class="crosshair"></div>
  </div>
  <script>
    const displayInfo = ${JSON.stringify(displayInfo)};
    const magnifier = document.getElementById('magnifier');
    const magnifierCanvas = document.getElementById('magnifier-canvas');
    const magnifierCtx = magnifierCanvas.getContext('2d');
    const sampleSize = 11;
    const magnifierSize = 120;
    const offset = 16;
    let pendingPreview = false;
    let lastPoint = null;
    let lastClient = { x: 0, y: 0 };
    let lastPreviewTs = 0;
    const previewInterval = 70;
    let queuedPoint = null;
    let hideTimer = null;

    function toScreenPoint(e) {
      return {
        x: displayInfo.bounds.x + e.clientX,
        y: displayInfo.bounds.y + e.clientY
      };
    }

    function positionMagnifier(x, y) {
      const left = Math.min(window.innerWidth - magnifierSize - 4, Math.max(4, x + offset));
      const top = Math.min(window.innerHeight - magnifierSize - 4, Math.max(4, y + offset));
      magnifier.style.left = left + 'px';
      magnifier.style.top = top + 'px';
    }

    async function runPreview() {
      if (pendingPreview || !queuedPoint || !window.colorPicker || !window.colorPicker.preview) return;
      const now = performance.now();
      if (now - lastPreviewTs < previewInterval) return;
      const point = queuedPoint;
      queuedPoint = null;
      pendingPreview = true;
      lastPreviewTs = now;
      try {
        const dataUrl = await window.colorPicker.preview(point, sampleSize);
        if (dataUrl) {
          const img = new Image();
          img.onload = () => {
            magnifierCtx.clearRect(0, 0, magnifierSize, magnifierSize);
            magnifierCtx.imageSmoothingEnabled = false;
            magnifierCtx.drawImage(img, 0, 0, magnifierSize, magnifierSize);
          };
          img.src = dataUrl;
        }
      } finally {
        pendingPreview = false;
        if (queuedPoint) {
          runPreview();
        }
      }
    }

    window.addEventListener('mousedown', e => {
      if (e.button !== 0) {
        if (window.colorPicker) window.colorPicker.cancel();
        return;
      }
      if (window.colorPicker) window.colorPicker.pick(toScreenPoint(e));
    });

    window.addEventListener('mousemove', e => {
      const point = toScreenPoint(e);
      lastPoint = point;
      lastClient = { x: e.clientX, y: e.clientY };
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      magnifier.style.display = 'block';
      queuedPoint = point;
      runPreview();
    });

    function animateMagnifier() {
      if (magnifier.style.display !== 'none') {
        positionMagnifier(lastClient.x, lastClient.y);
      }
      requestAnimationFrame(animateMagnifier);
    }

    animateMagnifier();

    window.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(() => {
        magnifier.style.display = 'none';
      }, 150);
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (window.colorPicker) window.colorPicker.cancel();
      }
    });
  </script>
</body>
</html>`
}

function formatHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => value.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

function getPixelFromBuffer(buffer: Buffer): { r: number; g: number; b: number } {
  const image = nativeImage.createFromBuffer(buffer)
  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  const x = Math.max(0, Math.min(width - 1, Math.floor(width / 2)))
  const y = Math.max(0, Math.min(height - 1, Math.floor(height / 2)))
  const index = (y * width + x) * 4
  const b = bitmap[index]
  const g = bitmap[index + 1]
  const r = bitmap[index + 2]
  return { r, g, b }
}

async function pickColorAtPoint(point: { x: number; y: number }): Promise<ColorPickResult> {
  const buffer = await pluginScreen.captureRegion(
    { x: point.x, y: point.y, width: 1, height: 1 },
    { format: 'png' }
  )
  const { r, g, b } = getPixelFromBuffer(buffer)
  const hex = formatHex(r, g, b)
  return {
    hex,
    rgb: `rgb(${r}, ${g}, ${b})`,
    r,
    g,
    b
  }
}

function closeAllPickerWindows(): void {
  pickerWindows.forEach(pw => {
    if (!pw.window.isDestroyed()) {
      pw.window.destroy()
    }
  })
  pickerWindows = []
}

export async function startColorPick(): Promise<ColorPickResult | null> {
  if (pickResolve) {
    pickResolve(null)
    pickResolve = null
  }
  closeAllPickerWindows()

  const displays = screen.getAllDisplays()

  return new Promise((resolve) => {
    pickResolve = resolve

    displays.forEach((display, index) => {
      const win = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        fullscreenable: true,
        simpleFullscreen: true,
        enableLargerThanScreen: true,
        hasShadow: false,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: join(__dirname, '../preload/color-pick.js')
        }
      })

      win.setSimpleFullScreen(true)

      if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        win.setAlwaysOnTop(true, 'screen-saver')
      }

      const displayInfo = {
        index,
        displayId: display.id,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
        isPrimary: display.id === screen.getPrimaryDisplay().id,
        totalDisplays: displays.length
      }

      const html = getColorPickHTML(displayInfo)
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

      win.once('ready-to-show', () => {
        win.show()
        win.focus()
      })

      pickerWindows.push({
        window: win,
        displayId: display.id,
        bounds: display.bounds
      })

      win.on('closed', () => {
        pickerWindows = pickerWindows.filter(pw => pw.window !== win)
      })
    })
  })
}

async function completeColorPick(point: { x: number; y: number }): Promise<void> {
  pickerWindows.forEach(pw => pw.window.hide())
  await new Promise(resolve => setTimeout(resolve, 80))

  try {
    const result = await pickColorAtPoint(point)
    if (pickResolve) {
      pickResolve(result)
      pickResolve = null
    }
  } catch (error) {
    console.error('Color pick failed:', error)
    if (pickResolve) {
      pickResolve(null)
      pickResolve = null
    }
  } finally {
    closeAllPickerWindows()
  }
}

function cancelColorPick(): void {
  if (pickResolve) {
    pickResolve(null)
    pickResolve = null
  }
  closeAllPickerWindows()
}

export function registerColorPickHandlers(): void {
  ipcMain.handle('screen:colorPick', async () => {
    return startColorPick()
  })

  ipcMain.handle('color-pick:preview', async (_event, point: { x: number; y: number }, size: number) => {
    const safeSize = Math.max(3, Math.min(45, Math.floor(size)))
    const half = Math.floor(safeSize / 2)
    const region = {
      x: point.x - half,
      y: point.y - half,
      width: safeSize,
      height: safeSize
    }
    try {
      const buffer = await pluginScreen.captureRegion(region, { format: 'png' })
      return `data:image/png;base64,${buffer.toString('base64')}`
    } catch (error) {
      console.error('Color preview failed:', error)
      return null
    }
  })

  ipcMain.on('color-pick:pick', async (_event, point: { x: number; y: number }) => {
    await completeColorPick(point)
  })

  ipcMain.on('color-pick:cancel', () => {
    cancelColorPick()
  })
}
