/**
 * React 插件模板 - 统一导出入口
 *
 * 将原 react.ts 拆分为多个模块文件，便于维护和 AI 阅读：
 * - config.ts   - 配置文件生成器（manifest, package.json, tsconfig 等）
 * - backend.ts  - 后端代码生成器（main.ts）
 * - ui.ts       - UI 代码生成器（index.html, main.tsx, App.tsx, styles.css）
 * - hooks.ts    - Hooks 代码生成器（useIntools.ts）
 * - types.ts    - 类型定义生成器（intools.d.ts）
 * - docs.ts     - 文档生成器（README.md）
 */

// 配置文件
export {
    buildReactManifest,
    buildReactPackageJson,
    buildTsConfig,
    buildViteConfig,
    buildPostcssConfig,
    buildTailwindConfig,
    buildGitignore
} from './config.js'

// 后端代码
export { buildBackendMain } from './backend.js'

// UI 代码
export {
    buildIndexHtml,
    buildMainTsx,
    buildAppTsx,
    buildStylesCss
} from './ui.js'

// Hooks 代码
export { buildUseIntools } from './hooks.js'

// 类型定义
export { buildIntoolsTypes } from './types.js'

// 文档
export { buildReactReadme } from './docs.js'
