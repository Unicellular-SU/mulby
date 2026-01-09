export interface ElectronAPI {
  hideWindow: () => void
  setWindowSize: (width: number, height: number) => void
  clipboard: {
    readText: () => Promise<string>
    writeText: (text: string) => Promise<void>
  }
  notification: {
    show: (message: string, type?: string) => void
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
