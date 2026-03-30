/// <reference types="vite/client" />

declare module 'better-sqlite3';

/**
 * Electron 41 类型兼容 shim
 *
 * Electron 41 的 electron.d.ts 仅声明 `declare namespace Electron`，
 * 不再包含 `declare module 'electron'` 声明。
 * 此 shim 将 namespace 成员重新导出为 ES module，
 * 使 `import { BrowserWindow } from 'electron'` 在 bundler moduleResolution 下正常工作。
 */
declare module 'electron' {
  export = Electron;
}
