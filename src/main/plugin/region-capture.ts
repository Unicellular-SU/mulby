/**
 * region-capture.ts — 区域截图模块（已原生化）
 *
 * 平台策略:
 *   macOS: 直接调用系统 screencapture -i (原生选区 UI，零延迟)
 *   Windows/Linux: 先用原生模块逐屏截取静态快照 → 覆盖窗口显示静态图 → 用户画选区 → 从静态图裁剪
 *
 * 核心优化: 消除了旧方案中 "隐藏窗口 → 等 100ms → 再截图" 的延迟问题
 *
 * codex review 修复:
 *   - [P1] 多显示器：每个显示器独立截取快照，而不是复用 display 0 的快照
 *   - completeRegionCapture 根据选区坐标定位正确的显示器和快照
 */

import { BrowserWindow, screen, ipcMain, nativeImage, desktopCapturer } from 'electron'
import { join } from 'path'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { readFileSync, unlinkSync, existsSync } from 'fs'
import {
import log from 'electron-log'
  nativeCaptureScreen,
  isNativeScreenCaptureAvailable,
  nativeStartRegionCapture
} from '../services/native-screen-capture'
import { registerSystemInternalWindow, unregisterSystemInternalWindow } from '../services/ipc-caller-resolver'

interface RegionCaptureWindow {
  window: BrowserWindow
  displayId: number
  bounds: { x: number; y: number; width: number; height: number }
}

let captureWindows: RegionCaptureWindow[] = []
let captureResolve: ((result: string | null) => void) | null = null

// 每个显示器独立的快照（displayId → dataUrl）
let displaySnapshots = new Map<number, string>()

// ===========================================================
// macOS: 系统 screencapture 命令
// ===========================================================

/**
 * macOS 原生区域截图
 * 调用系统 screencapture -i -r，提供：
 *   - 原生选区 UI（支持空格键切换窗口截图）
 *   - 像素级精准
 *   - 零延迟（不需要创建或隐藏任何窗口）
 *   - 自动支持 HiDPI
 */
async function captureRegionMacOS(): Promise<string | null> {
  const tmpPath = join(tmpdir(), `mulby-capture-${Date.now()}.png`)

  return new Promise((resolve) => {
    execFile('screencapture', ['-i', '-r', tmpPath], (error) => {
      if (error || !existsSync(tmpPath)) {
        resolve(null) // 用户取消了截图
        return
      }
      try {
        const buffer = readFileSync(tmpPath)
        unlinkSync(tmpPath)
        const base64 = buffer.toString('base64')
        resolve(`data:image/png;base64,${base64}`)
      } catch (err) {
        log.error('[RegionCapture] macOS: 读取截图文件失败:', err)
        resolve(null)
      }
    })
  })
}

// ===========================================================
// Windows / Linux: 预截取 + 覆盖窗口方案
// ===========================================================

/**
 * 区域截图 HTML 模板（Windows/Linux 用）
 * 与旧版的核心区别：背景是预截取的静态图片（而非透明层）
 * 用户在静态图片上画选区，松开鼠标后直接从静态图片裁剪
 */
function getRegionCaptureHTML(displayInfo: object): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>区域截图</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; cursor: crosshair; user-select: none; }
    #bg { position: fixed; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
    #canvas { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; }
    #info-panel { position: fixed; padding: 8px 12px; background: rgba(0,0,0,0.75); color: white; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 12px; border-radius: 4px; pointer-events: none; display: none; z-index: 1000; }
    #tip { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 10px 20px; background: rgba(0,0,0,0.8); color: white; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; border-radius: 6px; z-index: 1000; }
  </style>
</head>
<body>
  <img id="bg" />
  <canvas id="canvas"></canvas>
  <div id="info-panel"></div>
  <div id="tip">拖拽选择截图区域，按 ESC 取消</div>
  <script>
    const displayInfo = ${JSON.stringify(displayInfo)};
    const bgImg = document.getElementById('bg');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const infoPanel = document.getElementById('info-panel');
    const tip = document.getElementById('tip');

    let isDrawing = false, startX = 0, startY = 0, currentX = 0, currentY = 0;

    // 接收预截取的全屏快照
    if (window.regionCapture && window.regionCapture.onSnapshot) {
      window.regionCapture.onSnapshot((dataUrl) => {
        bgImg.src = dataUrl;
      });
    }

    function resizeCanvas() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      draw();
    }

    function draw() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
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
      if (rect.width > 5 && rect.height > 5) {
        // 传递屏幕坐标和 displayId 给主进程
        const screenRect = {
          x: displayInfo.bounds.x + rect.x,
          y: displayInfo.bounds.y + rect.y,
          width: rect.width,
          height: rect.height,
          displayId: displayInfo.displayId
        };
        if (window.regionCapture) window.regionCapture.complete(screenRect);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (window.regionCapture) window.regionCapture.cancel();
      }
    });

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
  </script>
</body>
</html>`
}

/**
 * 为指定显示器截取快照（优先原生模块，回退 desktopCapturer）
 */
async function captureSnapshotForDisplay(display: Electron.Display, displayIndex: number): Promise<string | null> {
  // 策略 1: 原生模块
  const buffer = nativeCaptureScreen(displayIndex, 'png')
  if (buffer) {
    return `data:image/png;base64,${buffer.toString('base64')}`
  }

  // 策略 2: desktopCapturer fallback
  log.warn(`[RegionCapture] 显示器 ${display.id} 原生截图不可用，使用 desktopCapturer fallback`)
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.bounds.width * display.scaleFactor),
        height: Math.round(display.bounds.height * display.scaleFactor)
      }
    })
    const source = sources.find(s => s.display_id === String(display.id)) || sources[displayIndex]
    if (source) {
      return source.thumbnail.toDataURL()
    }
  } catch (err) {
    log.error(`[RegionCapture] 显示器 ${display.id} desktopCapturer 也失败:`, err)
  }
  return null
}

/**
 * Windows/Linux: 逐屏预截取 → 显示覆盖窗口 → 用户选区 → 从快照裁剪
 */
async function captureRegionWithOverlay(): Promise<string | null> {
  log.info('[RegionCapture] 开始预截取 + 覆盖窗口方案...')

  // 如果已有截图窗口，先关闭
  closeAllCaptureWindows()
  displaySnapshots.clear()

  const displays = screen.getAllDisplays()
  log.info(`[RegionCapture] 发现 ${displays.length} 个显示器`)

  // 第 1 步：逐屏预截取静态快照（在创建覆盖窗口之前！）
  for (let i = 0; i < displays.length; i++) {
    const display = displays[i]
    const snapshot = await captureSnapshotForDisplay(display, i)
    if (snapshot) {
      displaySnapshots.set(display.id, snapshot)
    }
  }

  if (displaySnapshots.size === 0) {
    log.error('[RegionCapture] 所有显示器截图均失败')
    return null
  }

  return new Promise((resolve) => {
    captureResolve = resolve

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
        simpleFullscreen: process.platform === 'darwin',
        enableLargerThanScreen: true,
        hasShadow: false,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: join(__dirname, '../preload/region-capture.js')
        }
      })

      if (process.platform === 'darwin') {
        win.setSimpleFullScreen(true)
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        win.setAlwaysOnTop(true, 'screen-saver')
      }

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

      const html = getRegionCaptureHTML(displayInfo)
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

      win.once('ready-to-show', () => {
        win.show()
        win.focus()
        // 发送该显示器对应的快照（不是 display 0 的！）
        const snapshot = displaySnapshots.get(display.id)
        if (snapshot) {
          win.webContents.send('region-capture:snapshot', snapshot)
        }
      })

      registerSystemInternalWindow(win.id)

      captureWindows.push({
        window: win,
        displayId: display.id,
        bounds: display.bounds
      })

      win.on('closed', () => {
        unregisterSystemInternalWindow(win.id)
        captureWindows = captureWindows.filter(cw => cw.window !== win)
      })
    })
  })
}

// ===========================================================
// 公共 API
// ===========================================================

// 短期缓存：preCapture 与插件自身调用 screenCapture 的去重
// preCapture 先截图 → 插件拿到 attachment → 插件又调 screenCapture → 直接返回缓存
let cachedCaptureResult: string | null = null
let cachedCaptureTime = 0
const CAPTURE_CACHE_TTL = 3000 // 3 秒内的第二次调用直接返回缓存

/**
 * 开始区域截图（跨平台入口）
 */
export async function startRegionCapture(): Promise<string | null> {
  log.info('[RegionCapture] 开始区域截图...')

  // 去重：如果刚刚截图过，直接返回缓存结果（一次性使用）
  const now = Date.now()
  if (cachedCaptureResult && (now - cachedCaptureTime) < CAPTURE_CACHE_TTL) {
    log.info('[RegionCapture] 返回缓存结果（去重，距上次截图', now - cachedCaptureTime, 'ms）')
    const cached = cachedCaptureResult
    cachedCaptureResult = null // 一次性使用
    return cached
  }

  if (process.platform === 'darwin') {
    // macOS: 使用系统 screencapture 命令（原生 UI，最佳体验）
    return captureRegionMacOS()
  }

  if (process.platform === 'win32' && isNativeScreenCaptureAvailable()) {
    // Windows: 原生 C++ 覆盖窗口方案（解决双任务栏 bug）
    log.info('[RegionCapture] 使用原生区域截图...')
    const result = await nativeStartRegionCapture()
    if (result) {
      log.info('[RegionCapture] 原生区域截图成功, bounds:', result.bounds)
      // 缓存结果，防止插件重复调用
      cachedCaptureResult = result.dataUrl
      cachedCaptureTime = Date.now()
      return result.dataUrl
    }
    log.info('[RegionCapture] 原生区域截图返回 null（用户取消或失败）')
    return null
  }

  // Linux 或原生模块不可用时的 fallback
  return captureRegionWithOverlay()
}

/**
 * 完成区域截图（Windows/Linux 覆盖窗口方案专用）
 *
 * 核心改动：
 *   1. 根据选区坐标定位正确的显示器
 *   2. 从该显示器对应的快照中裁剪（而非始终用 display 0 的快照）
 *   3. 不再重新截图
 */
export async function completeRegionCapture(region: {
  x: number
  y: number
  width: number
  height: number
  displayId?: number
}): Promise<void> {
  try {
    closeAllCaptureWindows()

    // 定位选区所在的显示器
    const targetDisplay = region.displayId
      ? screen.getAllDisplays().find(d => d.id === region.displayId) || screen.getDisplayNearestPoint({ x: region.x, y: region.y })
      : screen.getDisplayNearestPoint({ x: region.x, y: region.y })

    // 获取该显示器的快照
    const snapshotDataUrl = displaySnapshots.get(targetDisplay.id)

    if (snapshotDataUrl) {
      const base64Data = snapshotDataUrl.replace(/^data:image\/png;base64,/, '')
      const snapshotBuffer = Buffer.from(base64Data, 'base64')
      const snapshotImage = nativeImage.createFromBuffer(snapshotBuffer)
      const fullSize = snapshotImage.getSize()

      if (fullSize.width > 0 && fullSize.height > 0) {
        const scaleFactor = targetDisplay.scaleFactor || 1

        // 将屏幕逻辑坐标转换为该显示器快照的像素坐标
        const cropX = Math.max(0, Math.round((region.x - targetDisplay.bounds.x) * scaleFactor))
        const cropY = Math.max(0, Math.round((region.y - targetDisplay.bounds.y) * scaleFactor))
        const cropW = Math.min(fullSize.width - cropX, Math.max(1, Math.round(region.width * scaleFactor)))
        const cropH = Math.min(fullSize.height - cropY, Math.max(1, Math.round(region.height * scaleFactor)))

        const cropped = snapshotImage.crop({
          x: cropX,
          y: cropY,
          width: cropW,
          height: cropH
        })

        const resultBase64 = cropped.toPNG().toString('base64')
        const dataUrl = `data:image/png;base64,${resultBase64}`

        if (captureResolve) {
          captureResolve(dataUrl)
          captureResolve = null
        }
        displaySnapshots.clear()
        return
      }
    }

    // Fallback: 如果快照裁剪失败，用原生模块直接截取区域
    const { pluginScreen } = await import('./screen')
    const buffer = await pluginScreen.captureRegion(region, { format: 'png' })
    const base64 = buffer.toString('base64')
    const dataUrl = `data:image/png;base64,${base64}`

    if (captureResolve) {
      captureResolve(dataUrl)
      captureResolve = null
    }
  } catch (error) {
    log.error('[RegionCapture] 区域截图失败:', error)
    if (captureResolve) {
      captureResolve(null)
      captureResolve = null
    }
  } finally {
    displaySnapshots.clear()
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
  displaySnapshots.clear()
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
    log.info('[RegionCapture] IPC: screen:startRegionCapture received')
    return startRegionCapture()
  })

  ipcMain.on('region-capture:complete', async (_event, region) => {
    log.info('[RegionCapture] IPC: region-capture:complete received', region)
    await completeRegionCapture(region)
  })

  ipcMain.on('region-capture:cancel', () => {
    log.info('[RegionCapture] IPC: region-capture:cancel received')
    cancelRegionCapture()
  })
}
