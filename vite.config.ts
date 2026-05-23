import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const runtimeDependencyNames = new Set([
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.optionalDependencies || {})
])
const macResourceUpdatePublicKeyPem = process.env.MULBY_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM || ''
const macUnsignedResourceUpdates = process.env.MULBY_MAC_UNSIGNED_RESOURCE_UPDATES === 'true'
const buildDefines = {
  __MULBY_MAC_RESOURCE_UPDATE_PUBLIC_KEY_PEM__: JSON.stringify(macResourceUpdatePublicKeyPem),
  __MULBY_MAC_UNSIGNED_RESOURCE_UPDATES__: JSON.stringify(macUnsignedResourceUpdates)
}

function isRuntimeExternal(id: string): boolean {
  if (id === 'electron') return true
  for (const dependencyName of runtimeDependencyNames) {
    if (id === dependencyName || id.startsWith(`${dependencyName}/`)) {
      return true
    }
  }
  return false
}

export default defineConfig({
  define: buildDefines,
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: {
          define: buildDefines,
          build: {
            outDir: 'dist/main',
            rollupOptions: {
              external: isRuntimeExternal
            }
          }
        }
      },
      {
        entry: 'src/preload/index.ts',
        vite: {
          define: buildDefines,
          build: {
            outDir: 'dist/preload'
          }
        }
      },
      {
        entry: 'src/main/plugin/host-worker.ts',
        vite: {
          define: buildDefines,
          build: {
            outDir: 'dist/worker',
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      },
      {
        entry: 'src/main/plugin/search-worker.ts',
        vite: {
          define: buildDefines,
          build: {
            outDir: 'dist/worker'
          }
        }
      },
      {
        entry: 'src/preload/apis/region-capture.ts',
        vite: {
          define: buildDefines,
          build: {
            outDir: 'dist/preload'
          }
        }
      },
      {
        entry: 'src/preload/apis/color-pick.ts',
        vite: {
          define: buildDefines,
          build: {
            outDir: 'dist/preload'
          }
        }
      },
      {
        entry: 'src/preload/titlebar.ts',
        vite: {
          define: buildDefines,
          build: {
            outDir: 'dist/preload'
          }
        }
      },
      {
        entry: 'src/preload/action-menu.ts',
        vite: {
          define: buildDefines,
          build: {
            outDir: 'dist/preload'
          }
        }
      },
      {
        entry: 'src/preload/floating-ball.ts',
        vite: {
          define: buildDefines,
          build: {
            outDir: 'dist/preload'
          }
        }
      },
      {
        entry: 'src/preload/web-parser.ts',
        vite: {
          define: buildDefines,
          build: {
            outDir: 'dist/preload'
          }
        }
      },
      {
        entry: 'src/preload/search-stealth.ts',
        vite: {
          define: buildDefines,
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
