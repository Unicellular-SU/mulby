import { execSync } from 'node:child_process';
import os from 'node:os';

const isWindows = os.platform() === 'win32';

// 基础的原生模块列表
const modules = [
  'better-sqlite3',
  'sharp',
  'koffi',
  'node-mac-permissions'
];

// 如果不是 Windows，则把 usocket 加入到重构建列表
if (!isWindows) {
  modules.push('usocket');
}

const command = `npx electron-rebuild --force --types prod,optional --only ${modules.join(',')}`;

console.log(`[Postinstall] Detected platform: ${os.platform()}`);
console.log(`[Postinstall] Running: ${command}`);

try {
  execSync(command, { stdio: 'inherit' });
  console.log('[Postinstall] Rebuild completed successfully.');
} catch (error) {
  console.error('[Postinstall] Rebuild failed.');
  process.exit(1);
}
