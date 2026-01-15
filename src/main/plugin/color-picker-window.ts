import { BrowserWindow, screen, ipcMain, desktopCapturer } from 'electron'
import { join } from 'path'

interface ColorPickerWindow {
  window: BrowserWindow
  displayId: number
  bounds: { x: number; y: number; width: number; height: number }
}

export interface ColorPickResult {
  hex: string
  rgb: string
  r: number
  g: number
  b: number
}

let pickerWindows: ColorPickerWindow[] = []
let pickerResolve: ((result: ColorPickResult | null) => void) | null = null
let screenshotDataUrls: Map<number, string> = new Map()

/**
 * 获取颜色拾取器 HTML 模板
 * 截图通过 IPC 传递，不嵌入 HTML 中
 */
function getColorPickerHTML(displayInfo: object): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>屏幕取色</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { 
      width: 100%; 
      height: 100%; 
      overflow: hidden; 
      cursor: crosshair; 
      user-select: none;
      background: #000;
    }
    #screenshot {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: none;
    }
    #cursor-dot {
      position: fixed;
      width: 10px;
      height: 10px;
      background: white;
      border: 2px solid black;
      border-radius: 50%;
      pointer-events: none;
      transform: translate(-50%, -50%);
      z-index: 1002;
      display: none;
    }
    #magnifier {
      position: fixed;
      width: 120px;
      height: 120px;
      border: 3px solid white;
      border-radius: 50%;
      pointer-events: none;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      overflow: hidden;
      z-index: 1000;
      display: none;
    }
    #magnifier-canvas {
      width: 100%;
      height: 100%;
    }
    #crosshair {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 12px;
      height: 12px;
      border: 2px solid white;
      box-shadow: 0 0 0 1px black;
      pointer-events: none;
    }
    #color-info {
      position: fixed;
      padding: 10px 14px;
      background: rgba(0,0,0,0.9);
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', monospace;
      font-size: 13px;
      border-radius: 8px;
      pointer-events: none;
      z-index: 1001;
      min-width: 140px;
      display: none;
    }
    #color-preview {
      width: 24px;
      height: 24px;
      border-radius: 4px;
      border: 2px solid white;
      display: inline-block;
      vertical-align: middle;
      margin-right: 10px;
    }
    .color-text {
      display: block;
      margin-top: 4px;
    }
    #tip {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      padding: 20px 40px;
      background: rgba(0,0,0,0.9);
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 16px;
      border-radius: 12px;
      z-index: 1000;
      display: none;
    }
  </style>
</head>
<body>
  <img id="screenshot" />
  <div id="cursor-dot"></div>
  <div id="magnifier">
    <canvas id="magnifier-canvas" width="120" height="120"></canvas>
    <div id="crosshair"></div>
  </div>
  <div id="color-info">
    <span id="color-preview"></span>
    <span class="color-text" id="color-hex">HEX: #000000</span>
    <span class="color-text" id="color-rgb">RGB: 0, 0, 0</span>
  </div>
  <div id="tip">正在加载...</div>
  <script>
    console.log('[ColorPicker UI] Script loaded');
    
    const displayInfo = ${JSON.stringify(displayInfo)};
    const screenshot = document.getElementById('screenshot');
    const magnifier = document.getElementById('magnifier');
    const magnifierCanvas = document.getElementById('magnifier-canvas');
    const magnifierCtx = magnifierCanvas.getContext('2d', { willReadFrequently: true });
    const colorInfo = document.getElementById('color-info');
    const colorPreview = document.getElementById('color-preview');
    const colorHex = document.getElementById('color-hex');
    const colorRgb = document.getElementById('color-rgb');
    const tip = document.getElementById('tip');
    const cursorDot = document.getElementById('cursor-dot');
    
    const MAGNIFIER_SIZE = 120;
    const ZOOM_LEVEL = 8;
    const SAMPLE_SIZE = Math.floor(MAGNIFIER_SIZE / ZOOM_LEVEL);
    
    let currentColor = { r: 0, g: 0, b: 0, hex: '#000000', rgb: 'rgb(0, 0, 0)' };
    let isReady = false;
    
    const offCanvas = document.createElement('canvas');
    const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
    
    // 接收主进程发送的截图数据
    if (window.colorPicker && window.colorPicker.onScreenshot) {
      window.colorPicker.onScreenshot((dataUrl) => {
        console.log('[ColorPicker UI] Received screenshot data, length:', dataUrl.length);
        screenshot.src = dataUrl;
      });
    }
    
    screenshot.onload = () => {
      console.log('[ColorPicker UI] Screenshot loaded');
      offCanvas.width = screenshot.naturalWidth;
      offCanvas.height = screenshot.naturalHeight;
      offCtx.drawImage(screenshot, 0, 0);
      tip.style.display = 'none';
      screenshot.style.display = 'block';
      // 显示 UI 元素
      cursorDot.style.display = 'block';
      magnifier.style.display = 'block';
      colorInfo.style.display = 'block';
      isReady = true;
      // 通知主进程显示窗口
      if (window.colorPicker && window.colorPicker.ready) {
        window.colorPicker.ready();
      }
    };
    
    screenshot.onerror = () => {
      console.error('[ColorPicker UI] Failed to load screenshot');
      tip.textContent = '加载失败，按 ESC 退出';
    };
    
    function rgbToHex(r, g, b) {
      return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    
    function updateMagnifier(e) {
      if (!isReady) return;
      
      const rect = screenshot.getBoundingClientRect();
      const scaleX = screenshot.naturalWidth / rect.width;
      const scaleY = screenshot.naturalHeight / rect.height;
      
      const imgX = Math.floor((e.clientX - rect.left) * scaleX);
      const imgY = Math.floor((e.clientY - rect.top) * scaleY);
      
      // Update cursor dot
      cursorDot.style.left = e.clientX + 'px';
      cursorDot.style.top = e.clientY + 'px';
      
      // Magnifier position
      const magX = e.clientX + 30;
      const magY = e.clientY - MAGNIFIER_SIZE - 20;
      magnifier.style.left = Math.max(10, Math.min(window.innerWidth - MAGNIFIER_SIZE - 10, magX)) + 'px';
      magnifier.style.top = Math.max(10, magY < 10 ? e.clientY + 30 : magY) + 'px';
      
      // Color info position
      colorInfo.style.left = magnifier.style.left;
      colorInfo.style.top = (parseInt(magnifier.style.top) + MAGNIFIER_SIZE + 10) + 'px';
      
      // Draw magnified area
      const halfSample = Math.floor(SAMPLE_SIZE / 2);
      const sourceX = Math.max(0, Math.min(offCanvas.width - SAMPLE_SIZE, imgX - halfSample));
      const sourceY = Math.max(0, Math.min(offCanvas.height - SAMPLE_SIZE, imgY - halfSample));
      
      magnifierCtx.imageSmoothingEnabled = false;
      magnifierCtx.clearRect(0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE);
      magnifierCtx.drawImage(
        offCanvas,
        sourceX, sourceY, SAMPLE_SIZE, SAMPLE_SIZE,
        0, 0, MAGNIFIER_SIZE, MAGNIFIER_SIZE
      );
      
      // Draw grid
      magnifierCtx.strokeStyle = 'rgba(255,255,255,0.3)';
      magnifierCtx.lineWidth = 0.5;
      for (let i = 0; i <= SAMPLE_SIZE; i++) {
        const pos = i * ZOOM_LEVEL;
        magnifierCtx.beginPath();
        magnifierCtx.moveTo(pos, 0);
        magnifierCtx.lineTo(pos, MAGNIFIER_SIZE);
        magnifierCtx.stroke();
        magnifierCtx.beginPath();
        magnifierCtx.moveTo(0, pos);
        magnifierCtx.lineTo(MAGNIFIER_SIZE, pos);
        magnifierCtx.stroke();
      }
      
      // Get center pixel color
      const clampedX = Math.max(0, Math.min(offCanvas.width - 1, imgX));
      const clampedY = Math.max(0, Math.min(offCanvas.height - 1, imgY));
      const centerPixel = offCtx.getImageData(clampedX, clampedY, 1, 1).data;
      currentColor = {
        r: centerPixel[0],
        g: centerPixel[1],
        b: centerPixel[2],
        hex: rgbToHex(centerPixel[0], centerPixel[1], centerPixel[2]),
        rgb: 'rgb(' + centerPixel[0] + ', ' + centerPixel[1] + ', ' + centerPixel[2] + ')'
      };
      
      colorPreview.style.backgroundColor = currentColor.hex;
      colorHex.textContent = 'HEX: ' + currentColor.hex;
      colorRgb.textContent = 'RGB: ' + currentColor.r + ', ' + currentColor.g + ', ' + currentColor.b;
    }
    
    function pickColor() {
      console.log('[ColorPicker UI] pickColor called', currentColor);
      if (window.colorPicker) {
        window.colorPicker.complete(currentColor);
      } else {
        console.error('[ColorPicker UI] window.colorPicker not available!');
      }
    }
    
    function cancelPick() {
      console.log('[ColorPicker UI] cancelPick called');
      if (window.colorPicker) {
        window.colorPicker.cancel();
      } else {
        console.error('[ColorPicker UI] window.colorPicker not available!');
      }
    }
    
    document.addEventListener('mousemove', updateMagnifier);
    
    document.addEventListener('mousedown', (e) => {
      console.log('[ColorPicker UI] mousedown', e.button);
      if (e.button === 0 && isReady) {
        e.preventDefault();
        pickColor();
      }
    });
    
    document.addEventListener('keydown', (e) => {
      console.log('[ColorPicker UI] keydown', e.key);
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelPick();
      } else if ((e.key === 'Enter' || e.key === ' ') && isReady) {
        e.preventDefault();
        pickColor();
      }
    });
    
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      cancelPick();
    });
    
    // Initial position update
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[ColorPicker UI] DOM ready, colorPicker available:', !!window.colorPicker);
      // 不在此处调用 ready()，等待截图加载完成后再显示窗口
    });
  </script>
</body>
</html>`
}

/**
 * 预先截取所有屏幕
 */
async function captureAllScreens(): Promise<Map<number, string>> {
  const displays = screen.getAllDisplays()
  const result = new Map<number, string>()

  // 获取所有屏幕源
  console.time('desktopCapturer.getSources')
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      // 使用高分辨率以获得更好的取色精度
      width: Math.max(...displays.map(d => d.bounds.width * d.scaleFactor)),
      height: Math.max(...displays.map(d => d.bounds.height * d.scaleFactor))
    }
  })
  console.timeEnd('desktopCapturer.getSources')

  // 将每个源与显示器匹配
  for (const display of displays) {
    // 尝试通过 display_id 匹配
    let source = sources.find((s: Electron.DesktopCapturerSource) => s.display_id === String(display.id))

    // 如果没匹配到，尝试通过 sourceId 解析
    if (!source) {
      source = sources.find((s: Electron.DesktopCapturerSource) => {
        const parts = s.id.split(':')
        return parts[0] === 'screen' && parseInt(parts[1]) === display.id
      })
    }

    // 还是没有就用第一个屏幕源
    if (!source && sources.length > 0) {
      source = sources[0]
    }

    if (source) {
      console.time(`toDataURL-${display.id}`)
      result.set(display.id, source.thumbnail.toDataURL())
      console.timeEnd(`toDataURL-${display.id}`)
    }
  }

  return result
}

/**
 * 开始屏幕取色
 */
export async function startColorPick(): Promise<ColorPickResult | null> {
  console.log('[ColorPicker] Starting color pick...')

  // 如果已有取色窗口，先关闭
  closeAllPickerWindows()

  // 预先截取所有屏幕
  try {
    screenshotDataUrls = await captureAllScreens()
    console.log('[ColorPicker] Captured screenshots for', screenshotDataUrls.size, 'display(s)')
  } catch (error) {
    console.error('[ColorPicker] Failed to capture screenshots:', error)
    return null
  }

  const displays = screen.getAllDisplays()
  console.log(`[ColorPicker] Found ${displays.length} display(s)`)

  return new Promise((resolve) => {
    pickerResolve = resolve

    // 为每个显示器创建覆盖窗口
    displays.forEach((display, index) => {
      console.log(`[ColorPicker] Creating window for display ${display.id}...`)

      const screenshotDataUrl = screenshotDataUrls.get(display.id)
      if (!screenshotDataUrl) {
        console.warn(`[ColorPicker] No screenshot for display ${display.id}, available keys:`, Array.from(screenshotDataUrls.keys()))
        return
      }

      console.log(`[ColorPicker] Screenshot data URL length: ${screenshotDataUrl.length}`)

      try {
        const preloadPath = join(__dirname, '../preload/color-picker.js')
        console.log(`[ColorPicker] Preload path: ${preloadPath}`)

        const win = new BrowserWindow({
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
          frame: false,
          transparent: false,
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
            preload: preloadPath
          }
        })

        console.log(`[ColorPicker] BrowserWindow created: ${win.id}`)

        // 设置全屏
        win.setSimpleFullScreen(true)

        // macOS 特殊处理
        if (process.platform === 'darwin') {
          win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
          win.setAlwaysOnTop(true, 'screen-saver')
        }

        // 构建显示器信息（不包含截图）
        const displayInfo = {
          index,
          displayId: display.id,
          bounds: display.bounds,
          scaleFactor: display.scaleFactor,
          isPrimary: display.id === screen.getPrimaryDisplay().id
        }

        // 加载取色器 HTML（不含截图数据）
        const html = getColorPickerHTML(displayInfo)
        console.log(`[ColorPicker] Loading HTML (${html.length} chars)`)

        // 窗口保持隐藏，等待截图加载完成后再显示（由 color-picker:ready IPC 触发）
        win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

        // 页面加载后发送截图数据
        win.webContents.on('did-finish-load', () => {
          console.log(`[ColorPicker] Window did-finish-load, sending screenshot...`)
          win.webContents.send('color-picker:screenshot', screenshotDataUrl)
        })

        win.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
          console.error(`[ColorPicker] Failed to load: ${errorCode} - ${errorDescription}`)
        })

        pickerWindows.push({
          window: win,
          displayId: display.id,
          bounds: display.bounds
        })

        win.on('closed', () => {
          pickerWindows = pickerWindows.filter(pw => pw.window !== win)
        })
      } catch (err) {
        console.error(`[ColorPicker] Error creating window:`, err)
      }
    })
  })
}

/**
 * 完成取色
 */
export function completeColorPick(color: ColorPickResult): void {
  console.log('[ColorPicker] Color picked:', color)
  if (pickerResolve) {
    pickerResolve(color)
    pickerResolve = null
  }
  closeAllPickerWindows()
  screenshotDataUrls.clear()
}

/**
 * 取消取色
 */
export function cancelColorPick(): void {
  console.log('[ColorPicker] Color pick cancelled')
  if (pickerResolve) {
    pickerResolve(null)
    pickerResolve = null
  }
  closeAllPickerWindows()
  screenshotDataUrls.clear()
}

/**
 * 关闭所有取色器窗口
 */
function closeAllPickerWindows(): void {
  pickerWindows.forEach(pw => {
    if (!pw.window.isDestroyed()) {
      pw.window.destroy()
    }
  })
  pickerWindows = []
}

/**
 * 注册 IPC 处理器
 */
export function registerColorPickerHandlers(): void {
  ipcMain.handle('screen:colorPick', async () => {
    console.log('[ColorPicker] IPC: screen:colorPick received')
    return startColorPick()
  })

  ipcMain.on('color-picker:complete', (_event, color: ColorPickResult) => {
    console.log('[ColorPicker] IPC: color-picker:complete received', color)
    completeColorPick(color)
  })

  ipcMain.on('color-picker:cancel', () => {
    console.log('[ColorPicker] IPC: color-picker:cancel received')
    cancelColorPick()
  })

  // 截图加载完成，显示窗口
  ipcMain.on('color-picker:ready', (event) => {
    console.log('[ColorPicker] IPC: color-picker:ready received')
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
  })
}
