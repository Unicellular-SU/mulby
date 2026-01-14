import { BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'
import { pluginScreen } from './screen'

interface RegionCaptureWindow {
  window: BrowserWindow
  displayId: number
  bounds: { x: number; y: number; width: number; height: number }
}

let captureWindows: RegionCaptureWindow[] = []
let captureResolve: ((result: string | null) => void) | null = null

// 区域截图 HTML 模板
function getRegionCaptureHTML(displayInfo: object): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>区域截图</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; cursor: crosshair; user-select: none; }
    #canvas { width: 100%; height: 100%; display: block; }
    #info-panel { position: fixed; padding: 8px 12px; background: rgba(0,0,0,0.75); color: white; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 12px; border-radius: 4px; pointer-events: none; display: none; z-index: 1000; }
    #tip { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 10px 20px; background: rgba(0,0,0,0.8); color: white; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; border-radius: 6px; z-index: 1000; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <div id="info-panel"></div>
  <div id="tip">拖拽选择截图区域，按 ESC 取消</div>
  <script>
    const displayInfo = ${JSON.stringify(displayInfo)};
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const infoPanel = document.getElementById('info-panel');
    const tip = document.getElementById('tip');
    
    let isDrawing = false, startX = 0, startY = 0, currentX = 0, currentY = 0;
    
    function resizeCanvas() {
      canvas.width = window.innerWidth * window.devicePixelRatio;
      canvas.height = window.innerHeight * window.devicePixelRatio;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      draw();
    }
    
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      if (isDrawing) {
        const rect = getSelectionRect();
        ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
        ctx.strokeStyle = '#007AFF';
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
        ctx.fillStyle = '#007AFF';
        const cs = 8;
        ctx.fillRect(rect.x - cs/2, rect.y - cs/2, cs, cs);
        ctx.fillRect(rect.x + rect.width - cs/2, rect.y - cs/2, cs, cs);
        ctx.fillRect(rect.x - cs/2, rect.y + rect.height - cs/2, cs, cs);
        ctx.fillRect(rect.x + rect.width - cs/2, rect.y + rect.height - cs/2, cs, cs);
      }
    }
    
    function getSelectionRect() {
      return { x: Math.min(startX, currentX), y: Math.min(startY, currentY), width: Math.abs(currentX - startX), height: Math.abs(currentY - startY) };
    }
    
    function updateInfo(rect) {
      if (rect.width > 0 && rect.height > 0) {
        infoPanel.style.display = 'block';
        infoPanel.textContent = Math.round(rect.width) + ' × ' + Math.round(rect.height);
        infoPanel.style.left = rect.x + 'px';
        infoPanel.style.top = (rect.y < 30 ? rect.y + rect.height + 10 : rect.y - 30) + 'px';
      } else { infoPanel.style.display = 'none'; }
    }
    
    function getScreenCoordinates(rect) {
      return { x: displayInfo.bounds.x + rect.x, y: displayInfo.bounds.y + rect.y, width: rect.width, height: rect.height };
    }
    
    function completeCapture(rect) {
      if (rect.width > 5 && rect.height > 5) {
        if (window.regionCapture) window.regionCapture.complete(getScreenCoordinates(rect));
      }
    }
    
    function cancelCapture() { if (window.regionCapture) window.regionCapture.cancel(); }
    
    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      isDrawing = true;
      startX = e.clientX; startY = e.clientY; currentX = e.clientX; currentY = e.clientY;
      tip.style.display = 'none';
      draw();
    });
    
    canvas.addEventListener('mousemove', e => {
      if (!isDrawing) return;
      currentX = e.clientX; currentY = e.clientY;
      updateInfo(getSelectionRect()); draw();
    });
    
    canvas.addEventListener('mouseup', e => {
      if (!isDrawing) return;
      isDrawing = false;
      currentX = e.clientX; currentY = e.clientY;
      const rect = getSelectionRect();
      // 松开鼠标后自动完成截图
      if (rect.width > 5 && rect.height > 5) {
        completeCapture(rect);
      }
    });
    
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') cancelCapture();
    });
    
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
  </script>
</body>
</html>`
}

/**
 * 开始区域截图
 * 为每个显示器创建全屏透明覆盖窗口
 */
export async function startRegionCapture(): Promise<string | null> {
  console.log('[RegionCapture] Starting region capture...')

  // 如果已有截图窗口，先关闭
  closeAllCaptureWindows()

  const displays = screen.getAllDisplays()
  console.log(`[RegionCapture] Found ${displays.length} display(s)`)

  return new Promise((resolve) => {
    captureResolve = resolve

    // 为每个显示器创建覆盖窗口
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
        simpleFullscreen: true, // macOS: 使用简单全屏模式
        enableLargerThanScreen: true,
        hasShadow: false,
        show: false, // 先隐藏，等加载完成后显示
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: join(__dirname, '../preload/region-capture.js')
        }
      })

      // 设置全屏并确保覆盖整个显示器
      win.setSimpleFullScreen(true)

      // macOS 特殊处理
      if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        win.setAlwaysOnTop(true, 'screen-saver')
      }

      // 构建显示器信息
      const displayInfo = {
        index,
        displayId: display.id,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor,
        isPrimary: display.id === screen.getPrimaryDisplay().id,
        totalDisplays: displays.length,
        allDisplayBounds: displays.map(d => ({
          id: d.id,
          bounds: d.bounds
        }))
      }

      // 使用 data URL 加载内嵌 HTML，避免 Vite 服务器问题
      const html = getRegionCaptureHTML(displayInfo)
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

      // 确保窗口加载后显示并获得焦点
      win.once('ready-to-show', () => {
        win.show()
        win.focus()
      })

      captureWindows.push({
        window: win,
        displayId: display.id,
        bounds: display.bounds
      })

      // 监听窗口关闭事件
      win.on('closed', () => {
        // 仅移除当前关闭的窗口实例，避免误删新创建的同显示器窗口
        captureWindows = captureWindows.filter(cw => cw.window !== win)
      })
    })
  })
}

/**
 * 完成区域截图
 */
export async function completeRegionCapture(region: {
  x: number
  y: number
  width: number
  height: number
}): Promise<void> {
  // 先隐藏所有窗口避免截到自己
  captureWindows.forEach(cw => cw.window.hide())

  // 等待窗口完全隐藏
  await new Promise(resolve => setTimeout(resolve, 100))

  try {
    // 使用现有的 captureRegion 方法截取选定区域
    const buffer = await pluginScreen.captureRegion(region, { format: 'png' })

    // 转换为 base64 Data URL
    const base64 = buffer.toString('base64')
    const dataUrl = `data:image/png;base64,${base64}`

    if (captureResolve) {
      captureResolve(dataUrl)
      captureResolve = null
    }
  } catch (error) {
    console.error('Region capture failed:', error)
    if (captureResolve) {
      captureResolve(null)
      captureResolve = null
    }
  } finally {
    closeAllCaptureWindows()
  }
}

/**
 * 取消区域截图
 */
export function cancelRegionCapture(): void {
  if (captureResolve) {
    captureResolve(null)
    captureResolve = null
  }
  closeAllCaptureWindows()
}

/**
 * 关闭所有截图覆盖窗口
 */
function closeAllCaptureWindows(): void {
  captureWindows.forEach(cw => {
    if (!cw.window.isDestroyed()) {
      cw.window.destroy()
    }
  })
  captureWindows = []
}

/**
 * 注册 IPC 处理器
 */
export function registerRegionCaptureHandlers(): void {
  ipcMain.handle('screen:startRegionCapture', async () => {
    console.log('[RegionCapture] IPC: screen:startRegionCapture received')
    return startRegionCapture()
  })

  ipcMain.on('region-capture:complete', async (_event, region) => {
    console.log('[RegionCapture] IPC: region-capture:complete received', region)
    await completeRegionCapture(region)
  })

  ipcMain.on('region-capture:cancel', () => {
    console.log('[RegionCapture] IPC: region-capture:cancel received')
    cancelRegionCapture()
  })
}
