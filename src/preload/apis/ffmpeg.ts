import type { IpcRenderer, IpcRendererEvent } from 'electron'

export function createFfmpegApi(ipcRenderer: IpcRenderer) {
  type DownloadProgress = {
    phase: 'downloading' | 'extracting' | 'done'
    percent: number
    downloaded?: number
    total?: number
  }
  type RunProgress = {
    bitrate: string
    fps: number
    frame: number
    percent?: number
    q: number | string
    size: string
    speed: string
    time: string
  }

  return {
    isAvailable: () => ipcRenderer.invoke('ffmpeg:isAvailable'),
    getVersion: () => ipcRenderer.invoke('ffmpeg:getVersion'),
    getPath: () => ipcRenderer.invoke('ffmpeg:getPath'),
    download: (onProgress?: (progress: DownloadProgress) => void) => {
      if (onProgress) {
        const listener = (_event: unknown, progress: DownloadProgress) => onProgress(progress)
        ipcRenderer.on('ffmpeg:downloadProgress', listener)
        return ipcRenderer.invoke('ffmpeg:download').finally(() => {
          ipcRenderer.removeListener('ffmpeg:downloadProgress', listener)
        })
      }
      return ipcRenderer.invoke('ffmpeg:download')
    },
    run: (args: string[], onProgress?: (progress: RunProgress) => void) => {
      const taskId = `ffmpeg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      console.log('[FFmpeg Preload] run() 启动任务, taskId:', taskId)

      let progressListener: ((event: IpcRendererEvent, data: { taskId: string; progress: RunProgress }) => void) | undefined
      if (onProgress) {
        progressListener = (_event: IpcRendererEvent, data: { taskId: string; progress: RunProgress }) => {
          if (data.taskId === taskId) {
            onProgress(data.progress)
          }
        }
        ipcRenderer.on('ffmpeg:progress', progressListener)
      }

      const resultPromise = ipcRenderer.invoke('ffmpeg:run', { args, taskId }).finally(() => {
        if (progressListener) {
          ipcRenderer.removeListener('ffmpeg:progress', progressListener)
        }
      })

      return {
        promise: resultPromise,
        kill: () => {
          console.log('[FFmpeg Preload] kill() 被调用, taskId:', taskId)
          ipcRenderer.invoke('ffmpeg:kill', taskId)
        },
        quit: () => {
          console.log('[FFmpeg Preload] quit() 被调用, taskId:', taskId)
          ipcRenderer.invoke('ffmpeg:quit', taskId)
        }
      }
    }
  }
}
