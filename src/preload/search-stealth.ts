/**
 * 搜索窗口 Stealth Preload — 消除 Electron BrowserWindow 的自动化特征
 *
 * 该脚本在搜索引擎页面的任何 JS 之前执行（依赖 contextIsolation: false 运行在主世界）。
 * 使 Bing/Google 等搜索引擎无法检测到隐藏 BrowserWindow 与真实浏览器的差异。
 *
 * 注意：版本号需与 search-window-service.ts 中的 EDGE_VERSION 保持一致。
 */

// Edge 伪装版本号（与 search-window-service.ts 中的 SPOOFED_UA 一致）
const EDGE_VER = '136'
const EDGE_FULL = '136.0.3240.76'
const CHROMIUM_FULL = '136.0.7103.114'

// 1. 移除 webdriver 标志（最关键的单一检测信号）
Object.defineProperty(navigator, 'webdriver', {
  get: () => false,
  configurable: true,
})

// 2. 伪造 navigator.plugins（真实浏览器有 PDF Viewer 等内置插件）
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const p = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: '', length: 1 },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '', length: 1 },
    ]
    Object.defineProperty(p, 'length', { value: 3, writable: false })
    return p
  },
  configurable: true,
})

// 3. 补充 window.chrome 对象（Chrome/Edge 浏览器特有）
const win = window as any
if (!win.chrome) win.chrome = {}
win.chrome.runtime = win.chrome.runtime || {}

// 4. 覆盖 navigator.userAgentData（消除真实 Chromium 版本泄露）
Object.defineProperty(navigator, 'userAgentData', {
  get: () => ({
    brands: [
      { brand: 'Chromium', version: EDGE_VER },
      { brand: 'Microsoft Edge', version: EDGE_VER },
      { brand: 'Not.A/Brand', version: '99' },
    ],
    mobile: false,
    platform: 'macOS',
    getHighEntropyValues: async () => ({
      brands: [
        { brand: 'Chromium', version: CHROMIUM_FULL },
        { brand: 'Microsoft Edge', version: EDGE_FULL },
        { brand: 'Not.A/Brand', version: '99.0.0.0' },
      ],
      mobile: false,
      platform: 'macOS',
      platformVersion: '15.4.0',
      architecture: 'arm',
      model: '',
      uaFullVersion: EDGE_FULL,
    }),
  }),
  configurable: true,
})

// 5. 确保 navigator.languages 与 Accept-Language 一致
Object.defineProperty(navigator, 'languages', {
  get: () => ['zh-CN', 'zh', 'en', 'en-US'],
  configurable: true,
})
