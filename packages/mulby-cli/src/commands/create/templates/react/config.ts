/**
 * React 插件模板 - 配置文件生成器
 * 包含：manifest.json, package.json, tsconfig.json, vite.config.ts,
 * postcss.config.mjs, tailwind.config.js, .gitignore
 */

/**
 * 生成 manifest.json 内容
 */
export function buildReactManifest(name: string) {
  return {
    id: name,
    name,
    version: '1.0.0',
    author: 'mulby',
    displayName: name,
    description: '插件描述',
    main: 'dist/main.js',
    ui: 'ui/index.html',
    icon: 'icon.png',
    window: {
      width: 800,       // 默认宽度
      height: 600,      // 默认高度
      minWidth: 400,    // 最小宽度
      minHeight: 300,   // 最小高度
      maxWidth: 1200,   // 最大宽度
      maxHeight: 900,   // 最大高度
      type: 'default'   // 可选：default / borderless / fullscreen
      // 截图标注类 detached 插件可额外使用：
      // transparent: true,
      // alwaysOnTop: true,
      // position: 'capture-region',
      // fit: 'capture-region-with-toolbar',
      // captureToolbarHeight: 56
    },
    features: [
      {
        code: 'main',
        explain: '主功能',
        cmds: [{ type: 'keyword', value: name }]
      }
    ]
  }
}

/**
 * 生成 package.json 内容
 */
export function buildReactPackageJson(name: string) {
  return {
    name,
    version: '1.0.0',
    type: 'module',
    packageManager: 'pnpm@9.1.0',
    scripts: {
      dev: 'mulby dev',
      build: 'pnpm run build:backend && pnpm run build:ui',
      'build:backend': 'esbuild src/main.ts --bundle --platform=node --outfile=dist/main.js',
      'build:ui': 'vite build',
      pack: 'pnpm run build && mulby pack'
    },
    dependencies: {
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      'lucide-react': '^0.562.0'
    },
    devDependencies: {
      '@types/node': '^20.0.0',
      '@types/react': '^18.3.3',
      '@types/react-dom': '^18.3.0',
      '@vitejs/plugin-react': '^4.3.1',
      autoprefixer: '^10.4.19',
      esbuild: '^0.20.0',
      postcss: '^8.4.38',
      tailwindcss: '^3.4.4',
      typescript: '^5.2.2',
      vite: '^5.3.1'
    }
  }
}

/**
 * 生成 tsconfig.json 内容
 */
export function buildTsConfig() {
  return {
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noFallthroughCasesInSwitch: true
    },
    include: ['src']
  }
}

/**
 * 生成 vite.config.ts 内容
 */
export function buildViteConfig() {
  return `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  root: 'src/ui',
  base: './',
  build: {
    outDir: '../../ui',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
})
`
}

/**
 * 生成 postcss.config.mjs 内容
 */
export function buildPostcssConfig() {
  return `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`
}

/**
 * 生成 tailwind.config.js 内容
 */
export function buildTailwindConfig() {
  return `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/ui/index.html",
    "./src/ui/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
`
}

/**
 * 生成 .gitignore 内容
 */
export function buildGitignore() {
  return `node_modules
dist
/ui/
.DS_Store
*.log
`
}
