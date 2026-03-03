import type { IpcRenderer } from 'electron'

export function createSharpApi(ipcRenderer: IpcRenderer) {
  return (input?: string | Buffer | ArrayBuffer | Uint8Array | object | unknown[], options?: object) => {
    const operations: Array<{ method: string; args: unknown[] }> = []

    const createBuilder = () => {
      const executeIpc = async () => {
        return ipcRenderer.invoke('sharp:execute', { input, options, operations })
      }

      const builder: Record<string, (...args: unknown[]) => unknown> = {}

      const terminalMethods = ['toBuffer', 'toFile', 'metadata', 'stats']
      terminalMethods.forEach((method) => {
        builder[method] = async (...args: unknown[]) => {
          operations.push({ method, args })
          return executeIpc()
        }
      })

      const chainMethods = [
        'resize', 'extend', 'extract', 'trim',
        'rotate', 'flip', 'flop', 'affine',
        'median', 'blur', 'sharpen', 'flatten', 'gamma', 'negate',
        'normalise', 'normalize', 'clahe', 'convolve', 'threshold',
        'linear', 'recomb', 'modulate',
        'tint', 'greyscale', 'grayscale', 'pipelineColorspace', 'toColorspace',
        'removeAlpha', 'ensureAlpha', 'extractChannel', 'joinChannel', 'bandbool',
        'composite',
        'png', 'jpeg', 'webp', 'gif', 'tiff', 'avif', 'heif', 'raw',
        'withMetadata', 'keepExif', 'withExif', 'keepIccProfile', 'withIccProfile',
        'timeout', 'tile'
      ]

      chainMethods.forEach((method) => {
        builder[method] = (...args: unknown[]) => {
          operations.push({ method, args })
          return builder
        }
      })

      builder.clone = (..._args: unknown[]) => {
        const clonedOps = [...operations]
        const newBuilder = createBuilder()
        clonedOps.forEach((op) => operations.push(op))
        return newBuilder
      }

      return builder
    }

    return createBuilder()
  }
}
