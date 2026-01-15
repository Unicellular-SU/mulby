import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist/main',
            rollupOptions: {
              external: ['electron', 'better-sqlite3', 'vm2']
            }
          }
        }
      },
      {
        entry: 'src/preload/index.ts',
        vite: {
          build: {
            outDir: 'dist/preload'
          }
        }
      },
      {
        entry: 'src/main/plugin/host-worker.ts',
        vite: {
          build: {
            outDir: 'dist/worker',
            rollupOptions: {
              external: ['electron', 'vm2']
            }
          }
        }
      },
      {
        entry: 'src/preload/region-capture.ts',
        vite: {
          build: {
            outDir: 'dist/preload'
          }
        }
      },
      {
        entry: 'src/preload/color-picker.ts',
        vite: {
          build: {
            outDir: 'dist/preload'
          }
        }
      }
    ])
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  build: {
    outDir: 'dist/renderer'
  }
})
