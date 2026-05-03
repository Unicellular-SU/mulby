const fs = require('fs');
const path = require('path');

const dirs = [
  '/Users/su/workspace/mulby/docs/apis',
  '/Users/su/workspace/mulby/skills/develop-mulby-plugin/references/apis'
];

// Map of replacements (synchronous to asynchronous) for common API calls in examples
const replacements = [
  { search: /clipboard\.getFormat\(/g, replace: 'await clipboard.getFormat(' },
  { search: /clipboard\.readImage\(/g, replace: 'await clipboard.readImage(' },
  { search: /clipboard\.readFiles\(/g, replace: 'await clipboard.readFiles(' },
  { search: /clipboard\.readText\(/g, replace: 'await clipboard.readText(' },
  { search: /filesystem\.writeFile\(/g, replace: 'await filesystem.writeFile(' },
  { search: /filesystem\.readFile\(/g, replace: 'await filesystem.readFile(' },
  { search: /filesystem\.readdir\(/g, replace: 'await filesystem.readdir(' },
  { search: /filesystem\.stat\(/g, replace: 'await filesystem.stat(' },
  { search: /filesystem\.unlink\(/g, replace: 'await filesystem.unlink(' },
  { search: /notification\.show\(/g, replace: 'await notification.show(' },
  { search: /dialog\.showOpenDialog\(/g, replace: 'await dialog.showOpenDialog(' },
  { search: /dialog\.showSaveDialog\(/g, replace: 'await dialog.showSaveDialog(' },
  { search: /input\.hideMainWindowPasteText\(/g, replace: 'await input.hideMainWindowPasteText(' },
  { search: /input\.hideMainWindowPasteImage\(/g, replace: 'await input.hideMainWindowPasteImage(' },
  { search: /input\.hideMainWindowPasteFile\(/g, replace: 'await input.hideMainWindowPasteFile(' },
  { search: /input\.hideMainWindowTypeString\(/g, replace: 'await input.hideMainWindowTypeString(' },
  { search: /system\.getPath\(/g, replace: 'await system.getPath(' },
  { search: /tray\.create\(/g, replace: 'await tray.create(' },
  { search: /tray\.destroy\(/g, replace: 'await tray.destroy(' },
  { search: /shell\.showItemInFolder\(/g, replace: 'await shell.showItemInFolder(' },
  { search: /shell\.beep\(/g, replace: 'await shell.beep(' }
];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let originalContent = content;

  // Fix Return types for backend
  content = content.replace(/\*\*返回值\*\*:\s*`void`/g, '**返回值**: `void`（插件后端返回 `Promise<void>`）');
  content = content.replace(/\*\*返回值\*\*:\s*`boolean`/g, '**返回值**: `boolean`（插件后端返回 `Promise<boolean>`）');
  content = content.replace(/\*\*返回值\*\*:\s*`string`/g, '**返回值**: `string`（插件后端返回 `Promise<string>`）');
  content = content.replace(/\*\*返回值\*\*:\s*`number`/g, '**返回值**: `number`（插件后端返回 `Promise<number>`）');
  content = content.replace(/- 插件后端：`void`/g, '- 插件后端：`Promise<void>`');
  content = content.replace(/- 插件后端：`'text' \| 'image' \| 'files' \| 'empty'`/g, '- 插件后端：`Promise<\'text\' | \'image\' | \'files\' | \'empty\'>`');
  
  // Also replace some complex returns like Arrays
  content = content.replace(/\*\*返回值\*\*:\s*`Array<ClipboardFileInfo>`/g, '**返回值**: `Array<ClipboardFileInfo>`（插件后端返回 `Promise<Array<ClipboardFileInfo>>`）');

  // Fix missing awaits in examples
  // Only apply to backend examples, which usually start with `module.exports = { async run` or explicitly use `context.api`
  // Actually, to be safe, any missing await on these methods should probably be fixed if it's inside `run(context)` or similar.
  // Wait, some methods might be used in frontend examples where they return Promises anyway, so `await` is still needed!
  // If `clipboard.readText()` is synchronous in UI, adding await doesn't hurt much, but let's just replace if not preceded by await.
  
  for (const { search, replace } of replacements) {
    // regex to replace only if not already preceded by await
    // negative lookbehind `(?<!await\s+)`
    const regex = new RegExp(`(?<!await\\s+(?:window\\.mulby\\.|mulby\\.|api\\.)?)(?<!await\\s+)` + search.source, 'g');
    content = content.replace(regex, replace);
  }

  // Double await fix
  content = content.replace(/await\s+await\s+/g, 'await ');

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Updated ${filePath}`);
  }
}

for (const dir of dirs) {
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        processFile(path.join(dir, file));
      }
    }
  }
}
