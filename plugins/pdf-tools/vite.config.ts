import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src/ui',
  base: './',
  build: {
    outDir: '../../ui',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})
