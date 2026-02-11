import { BrowserWindow, ipcMain, app } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'

export class CaptureWindow {
  private window: BrowserWindow | null = null
  private promiseMap = new Map<string, { resolve: (buffer: Buffer) => void; reject: (err: Error) => void }>()
  private static instance: CaptureWindow

  private constructor() {
    this.initIpc()
  }

  static getInstance(): CaptureWindow {
    if (!CaptureWindow.instance) {
      CaptureWindow.instance = new CaptureWindow()
    }
    return CaptureWindow.instance
  }

  private initIpc() {
    ipcMain.on('capture-success', (_, buffer: Buffer) => {
      const promise = this.promiseMap.get('current')
      if (promise) {
        promise.resolve(buffer)
        this.promiseMap.delete('current')
      }
    })

    ipcMain.on('capture-error', (_, error: string) => {
      const promise = this.promiseMap.get('current')
      if (promise) {
        promise.reject(new Error(error))
        this.promiseMap.delete('current')
      }
    })
  }

  private getCaptureHTML(): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Capture Window</title>
        </head>
        <body>
          <script>
            const { ipcRenderer } = require('electron')

            ipcRenderer.on('capture-request', async (_event, config) => {
              try {
                const { sourceId, width, height } = config

                const stream = await navigator.mediaDevices.getUserMedia({
                  audio: false,
                  video: {
                    mandatory: {
                      chromeMediaSource: 'desktop',
                      chromeMediaSourceId: sourceId,
                      minWidth: width,
                      maxWidth: width,
                      minHeight: height,
                      maxHeight: height
                    }
                  }
                })

                const video = document.createElement('video')
                video.style.width = width + 'px'
                video.style.height = height + 'px'
                
                await new Promise((resolve, reject) => {
                  video.onloadedmetadata = () => {
                    video.play()
                    resolve()
                  }
                  video.onerror = reject
                  video.srcObject = stream
                })

                const canvas = document.createElement('canvas')
                canvas.width = width
                canvas.height = height
                const ctx = canvas.getContext('2d')
                if (!ctx) throw new Error('Failed to get canvas context')

                ctx.drawImage(video, 0, 0, width, height)
                
                stream.getTracks().forEach(track => track.stop())
                video.srcObject = null
                video.remove()

                canvas.toBlob(async (blob) => {
                  if (!blob) {
                    ipcRenderer.send('capture-error', 'Failed to create blob')
                    return
                  }
                  const arrayBuffer = await blob.arrayBuffer()
                  ipcRenderer.send('capture-success', Buffer.from(arrayBuffer))
                }, 'image/png')

              } catch (error) {
                console.error('Capture failed:', error)
                ipcRenderer.send('capture-error', error instanceof Error ? error.message : String(error))
              }
            })
          </script>
        </body>
      </html>
    `
  }

  private async createWindow() {
    if (this.window && !this.window.isDestroyed()) {
      return
    }

    this.window = new BrowserWindow({
      show: false,
      width: 100,
      height: 100,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
        offscreen: true
      }
    })

    const html = this.getCaptureHTML()

    // data: 协议通常被视为不安全上下文，会导致 navigator.mediaDevices 为 undefined
    // 为了使用 getUserMedia，我们必须在安全上下文(https 或 file)中运行
    // 这里将 HTML 写入用户数据目录的临时文件，然后通过 file:// 协议加载
    try {
      const tempPath = join(app.getPath('userData'), 'mulby-capture-temp.html')
      await writeFile(tempPath, html, 'utf-8')
      await this.window.loadFile(tempPath)
    } catch (err) {
      console.error('Failed to create capture window temp file:', err)
      // Fallback: 尝试 data URL (虽然大概率会失败，但在某些 Electron 配置下可能可行)
      await this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    }
  }

  async capture(sourceId: string, width: number, height: number): Promise<Buffer> {
    await this.createWindow()

    return new Promise<Buffer>((resolve, reject) => {
      if (this.promiseMap.has('current')) {
        reject(new Error('Capture already in progress'))
        return
      }

      const timeout = setTimeout(() => {
        if (this.promiseMap.has('current')) {
          this.promiseMap.delete('current')
          reject(new Error('Capture timeout'))
        }
      }, 10000)

      this.promiseMap.set('current', {
        resolve: (buffer) => {
          clearTimeout(timeout)
          resolve(buffer)
        },
        reject: (err) => {
          clearTimeout(timeout)
          reject(err)
        }
      })

      this.window?.webContents.send('capture-request', { sourceId, width, height })
    })
  }

  destroy() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
      this.window = null
    }
  }
}
