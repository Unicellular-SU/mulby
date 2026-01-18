# InTools 插件 API 参考

> 本文档包含 InTools 插件开发可用的全部 API。
> - **UI/渲染进程**：`window.intools.{模块名}`
> - **插件后端**：`context.api.{模块名}`

---

## 1. 剪贴板 (clipboard)

| 方法 | 环境 | 说明 |
|------|------|------|
| `readText()` | R/B | 读取文本 → `string` |
| `writeText(text)` | R/B | 写入文本 |
| `readImage()` | R/B | 读取图片 → `Buffer | null` |
| `writeImage(image)` | R/B | 写入图片（路径/Buffer/DataURL） |
| `writeFiles(paths)` | R | 写入文件路径 |
| `readFiles()` | R/B | 读取文件列表 → `ClipboardFileInfo[]` |
| `getFormat()` | R/B | 获取格式 → `'text' | 'image' | 'files' | 'html' | 'empty'` |

---

## 2. 文件系统 (filesystem)

| 方法 | 环境 | 说明 |
|------|------|------|
| `readFile(path, encoding?)` | R/B | 读取文件 → `Buffer | string` |
| `writeFile(path, data, encoding?)` | R/B | 写入文件 |
| `exists(path)` | R/B | 检查是否存在 → `boolean` |
| `unlink(path)` | R/B | 删除文件 |
| `readdir(path)` | R/B | 读取目录 → `string[]` |
| `mkdir(path)` | R/B | 创建目录（递归） |
| `stat(path)` | R/B | 获取文件信息 → `FileStat` |
| `copy(src, dest)` | R/B | 复制文件 |
| `move(src, dest)` | R/B | 移动/重命名文件 |
| `extname(path)` | B | 获取扩展名 |
| `join(...paths)` | B | 拼接路径 |
| `dirname(path)` | B | 获取目录名 |
| `basename(path, ext?)` | B | 获取文件名 |

---

## 3. 存储 (storage)

| 方法 | 环境 | 说明 |
|------|------|------|
| `get(key, namespace?)` | R/B | 获取数据 |
| `set(key, value, namespace?)` | R/B | 存储数据 |
| `remove(key, namespace?)` | R/B | 删除数据 |
| `clear()` | B | 清空存储 |
| `keys()` | B | 获取所有键 |

---

## 4. 对话框 (dialog)

| 方法 | 环境 | 说明 |
|------|------|------|
| `showOpenDialog(options?)` | R/B | 打开文件对话框 → `string[]` |
| `showSaveDialog(options?)` | R/B | 保存文件对话框 → `string | null` |
| `showMessageBox(options)` | R/B | 消息框 → `{ response, checkboxChecked }` |
| `showErrorBox(title, content)` | R/B | 错误框（同步） |

**OpenDialogOptions**: `title`, `defaultPath`, `buttonLabel`, `filters`, `properties`  
**properties**: `'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'`

---

## 5. 通知 (notification)

| 方法 | 环境 | 说明 |
|------|------|------|
| `show(message, type?)` | R/B | 显示通知（`type='error'` 时不静音） |

---

## 6. Shell

| 方法 | 环境 | 说明 |
|------|------|------|
| `openPath(path)` | R/B | 用默认应用打开文件 |
| `openExternal(url)` | R/B | 用浏览器打开 URL |
| `showItemInFolder(path)` | R/B | 在文件管理器中显示 |
| `openFolder(path)` | R/B | 打开文件所在目录 |
| `trashItem(path)` | R/B | 移动到回收站 |
| `beep()` | R/B | 播放系统提示音 |

---

## 7. HTTP 请求 (http)

| 方法 | 环境 | 说明 |
|------|------|------|
| `request(options)` | R/B | 发起请求 → `HttpResponse` |
| `get(url, headers?)` | R/B | GET 请求 |
| `post(url, body?, headers?)` | R/B | POST 请求 |
| `put(url, body?, headers?)` | R/B | PUT 请求 |
| `delete(url, headers?)` | R/B | DELETE 请求 |

**HttpRequestOptions**: `url`, `method`, `headers`, `body`, `timeout`  
**HttpResponse**: `{ status, statusText, headers, data }`

---

## 8. 系统 (system)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getSystemInfo()` | R/B | 获取系统信息 → `SystemInfo` |
| `getAppInfo()` | R/B | 获取应用信息 → `AppInfo` |
| `getPath(name)` | R/B | 获取特定路径 |
| `getEnv(name)` | R/B | 获取环境变量 |
| `getIdleTime()` | R/B | 获取空闲时间（秒） |
| `getFileIcon(path)` | R/B | 获取文件图标 → base64 DataURL |
| `getNativeId()` | R/B | 获取设备唯一标识 |
| `isDev()` | R/B | 是否开发环境 |
| `isMacOS() / isWindows() / isLinux()` | R/B | 判断操作系统 |

**getPath 支持**: `'home' | 'appData' | 'userData' | 'temp' | 'exe' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'logs'`

---

## 9. 屏幕 (screen)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getAllDisplays()` | R/B | 获取所有显示器 → `DisplayInfo[]` |
| `getPrimaryDisplay()` | R/B | 获取主显示器 |
| `getDisplayNearestPoint(point)` | R/B | 获取坐标位置的显示器 |
| `getCursorScreenPoint()` | R/B | 获取鼠标位置 |
| `getSources(options?)` | R/B | 获取捕获源列表 |
| `capture(options?)` | R/B | 截取屏幕 → `Buffer` |
| `captureRegion(region, options?)` | R/B | 截取指定区域 |
| `screenCapture()` | R | 交互式区域截图 → DataURL |
| `colorPick()` | R | 屏幕取色 → `{ hex, rgb, r, g, b }` |
| `getMediaStreamConstraints(options)` | R/B | 获取录屏约束配置 |

---

## 10. 输入 (input)

| 方法 | 环境 | 说明 |
|------|------|------|
| `hideMainWindowPasteText(text)` | R/B | 粘贴文本到焦点应用 |
| `hideMainWindowPasteImage(image)` | R/B | 粘贴图片到焦点应用 |
| `hideMainWindowPasteFile(paths)` | R/B | 粘贴文件到焦点应用 |
| `hideMainWindowTypeString(text)` | R/B | 模拟键入文本 |
| `simulateKeyboardTap(key, ...modifiers)` | R/B | 模拟按键 |
| `simulateMouseMove(x, y)` | R/B | 移动鼠标 |
| `simulateMouseClick(x, y)` | R/B | 左键单击 |
| `simulateMouseDoubleClick(x, y)` | R/B | 左键双击 |
| `simulateMouseRightClick(x, y)` | R/B | 右键点击 |

**修饰键**: `'ctrl' | 'alt' | 'shift' | 'command'`

---

## 11. 窗口 (window)

| 方法 | 环境 | 说明 |
|------|------|------|
| `hide(restorePreWindow?)` | R | 隐藏窗口 |
| `show()` | R | 显示窗口 |
| `setSize(width, height)` | R | 设置尺寸 |
| `setExpendHeight(height)` | R | 调整高度 |
| `center()` | R | 窗口居中 |
| `setAlwaysOnTop(flag)` | R | 设置置顶 |
| `detach()` | R | 分离为独立窗口 |
| `close()` | R | 关闭窗口 |
| `reload()` | R | 重新加载 |
| `getMode()` | R | 获取模式 → `'attached' | 'detached'` |
| `getWindowType()` | R | 获取类型 → `'main' | 'detach'` |
| `getState()` | R | 获取状态 |
| `minimize() / maximize()` | R | 最小化/最大化 |
| `create(url, options?)` | R | 创建子窗口 → `ChildWindowHandle` |
| `sendToParent(channel, ...args)` | R | 向父窗口发消息 |
| `onChildMessage(callback)` | R | 监听子窗口消息 |
| `findInPage(text, options?)` | R | 页面内查找 |
| `startDrag(filePath)` | R | 触发文件拖拽 |

### 子输入框 (subInput)

| 方法 | 说明 |
|------|------|
| `set(placeholder?, isFocus?)` | 显示子输入框 |
| `remove()` | 移除子输入框 |
| `setValue(text)` | 设置内容 |
| `focus() / blur() / select()` | 焦点控制 |
| `onChange(callback)` | 监听变化 |

---

## 12. 主题 (theme)

| 方法 | 环境 | 说明 |
|------|------|------|
| `get()` | R | 获取主题信息 → `{ mode, actual }` |
| `set(mode)` | R | 设置主题 → `'light' | 'dark' | 'system'` |
| `getActual()` | R | 获取实际主题 → `'light' | 'dark'` |
| `onThemeChange(callback)` | R | 监听主题变化 |

---

## 13. 插件管理 (plugin)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getAll()` | R | 获取所有插件 |
| `search(query)` | R | 搜索插件功能 |
| `run(name, featureCode, input?)` | R | 执行插件功能 |
| `install(filePath)` | R | 安装插件 |
| `enable(name) / disable(name)` | R | 启用/禁用插件 |
| `uninstall(name)` | R | 卸载插件 |
| `getReadme(name)` | R | 获取 README |
| `redirect(label, payload?)` | R | 跳转到其他插件 |
| `outPlugin(isKill?)` | R | 退出当前插件 |

### 事件

| 事件 | 说明 |
|------|------|
| `onPluginInit(callback)` | 插件初始化 |
| `onPluginAttach(callback)` | 插件附着 |
| `onPluginDetached(callback)` | 插件分离 |

---

## 14. 动态指令 (features)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getFeatures(codes?)` | B | 获取动态指令 |
| `setFeature(feature)` | B | 注册动态指令 |
| `removeFeature(code)` | B | 删除动态指令 |

**DynamicFeatureInput**: `code`, `explain`, `icon`, `platform`, `mode`, `route`, `cmds`  
**mode**: `'ui' | 'silent' | 'detached'`

---

## 15. 快捷键 (shortcut)

| 方法 | 环境 | 说明 |
|------|------|------|
| `register(accelerator)` | R/B | 注册全局快捷键 |
| `unregister(accelerator)` | R/B | 注销快捷键 |
| `unregisterAll()` | R/B | 注销所有快捷键 |
| `isRegistered(accelerator)` | R/B | 检查是否已注册 |
| `onTriggered(callback)` | R | 监听触发事件 |

**accelerator 格式**: `CommandOrControl+Shift+X`, `Alt+P`, `F12`

---

## 16. 权限 (permission)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getStatus(type)` | R/B | 获取权限状态 |
| `request(type)` | R/B | 请求权限 |
| `canRequest(type)` | R/B | 是否可请求 |
| `openSystemSettings(type)` | R/B | 打开系统设置 |
| `isAccessibilityTrusted()` | R/B | macOS 辅助功能权限 |

**type**: `'accessibility' | 'screen' | 'camera' | 'microphone' | 'geolocation' | 'notifications' | 'contacts' | 'calendar'`

---

## 17. 安全存储 (security)

| 方法 | 环境 | 说明 |
|------|------|------|
| `isEncryptionAvailable()` | R/B | 检查加密可用性 |
| `encryptString(plainText)` | R/B | 加密字符串 → `Buffer` |
| `decryptString(encrypted)` | R/B | 解密字符串 → `string` |

---

## 18. 托盘 (tray)

| 方法 | 环境 | 说明 |
|------|------|------|
| `create(options)` | R/B | 创建托盘图标 |
| `destroy()` | R/B | 销毁托盘 |
| `setIcon(icon)` | R/B | 更新图标 |
| `setTooltip(tooltip)` | R/B | 设置提示 |
| `setTitle(title)` | R/B | 设置标题（macOS） |
| `exists()` | R/B | 检查是否存在 |

**TrayOptions**: `icon`, `tooltip`, `title`

---

## 19. 菜单 (menu)

| 方法 | 环境 | 说明 |
|------|------|------|
| `showContextMenu(items)` | R | 显示右键菜单 → `id | null` |

**MenuItemOptions**: `label`, `type`, `checked`, `enabled`, `id`, `submenu`

---

## 20. 网络状态 (network)

| 方法 | 环境 | 说明 |
|------|------|------|
| `isOnline()` | R/B | 检查是否在线 |
| `onOnline(callback)` | R | 网络恢复事件 |
| `onOffline(callback)` | R | 网络断开事件 |

---

## 21. 电源 (power)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getSystemIdleTime()` | R/B | 获取空闲时间 |
| `getSystemIdleState(threshold)` | R/B | 获取空闲状态 |
| `isOnBatteryPower()` | R/B | 是否电池供电 |
| `getCurrentThermalState()` | R/B | 获取热状态（macOS） |
| `onSuspend / onResume` | R | 休眠/唤醒事件 |
| `onAC / onBattery` | R | 电源切换事件 |
| `onLockScreen / onUnlockScreen` | R | 锁屏事件 |

---

## 22. 媒体 (media)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getAccessStatus(type)` | R/B | 获取权限状态 |
| `askForAccess(type)` | R/B | 请求权限 |
| `hasCameraAccess()` | R/B | 检查摄像头权限 |
| `hasMicrophoneAccess()` | R/B | 检查麦克风权限 |

**type**: `'camera' | 'microphone'`

---

## 23. 地理位置 (geolocation)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getAccessStatus()` | R | 获取权限状态 |
| `requestAccess()` | R | 请求权限 |
| `canGetPosition()` | R | 是否可获取位置 |
| `openSettings()` | R | 打开系统设置 |
| `getCurrentPosition()` | R | 获取当前位置 → `GeolocationPosition` |

---

## 24. TTS 语音合成 (tts)

| 方法 | 环境 | 说明 |
|------|------|------|
| `speak(text, options?)` | R | 朗读文本 |
| `stop()` | R | 停止朗读 |
| `pause() / resume()` | R | 暂停/恢复 |
| `getVoices()` | R | 获取语音列表 |
| `isSpeaking()` | R | 是否正在朗读 |

**options**: `lang`, `rate`, `pitch`, `volume`

---

## 25. Host 调用 (host)

| 方法 | 环境 | 说明 |
|------|------|------|
| `invoke(pluginName, method, ...args)` | R | 调用插件后端方法 |
| `status(pluginName)` | R | 获取 Host 状态 |
| `restart(pluginName)` | R | 重启 Host 进程 |

---

## 26. Sharp 图像处理 (sharp)

| 方法 | 说明 |
|------|------|
| `sharp(input?, options?)` | 创建实例 |
| `.resize(w?, h?, opts?)` | 调整尺寸 |
| `.extract({ left, top, width, height })` | 裁剪区域 |
| `.rotate(angle?)` | 旋转 |
| `.flip() / .flop()` | 翻转 |
| `.blur(sigma?) / .sharpen()` | 模糊/锐化 |
| `.grayscale() / .negate()` | 灰度/反相 |
| `.modulate({ brightness, saturation, hue })` | 调整色彩 |
| `.composite(images)` | 合成 |
| `.png() / .jpeg() / .webp()` | 设置格式 |
| `.toBuffer()` | 输出 ArrayBuffer |
| `.toFile(path)` | 输出文件 |
| `.metadata()` | 获取元数据 |

---

## 27. FFmpeg 音视频 (ffmpeg)

| 方法 | 环境 | 说明 |
|------|------|------|
| `isAvailable()` | R | 检查是否已安装 |
| `getVersion()` | R | 获取版本 |
| `getPath()` | R | 获取可执行文件路径 |
| `download(onProgress?)` | R | 下载 FFmpeg |
| `run(args, onProgress?)` | R | 执行命令 → `{ promise, kill, quit }` |

---

## 28. InBrowser 自动化 (inbrowser)

| 方法 | 说明 |
|------|------|
| `.goto(url, headers?, timeout?)` | 导航 |
| `.click(selector) / .dblclick(selector)` | 点击 |
| `.input(selector, text) / .type(selector, text)` | 输入 |
| `.press(key, modifiers?)` | 按键 |
| `.hover(selector) / .focus(selector)` | 悬停/聚焦 |
| `.wait(ms) / .wait(selector)` | 等待 |
| `.evaluate(func, ...args)` | 执行脚本 |
| `.screenshot(target?, savePath?)` | 截图 |
| `.pdf(options?, savePath?)` | 导出 PDF |
| `.cookies(filter?)` | 获取 Cookie |
| `.setCookies(...) / .clearCookies()` | 设置/清除 Cookie |
| `.viewport(w, h)` | 设置视口 |
| `.show() / .hide() / .end()` | 窗口控制 |
| `.run(options?)` | 执行队列 |

---

## 环境标识说明

- **R** = 渲染进程可用 (`window.intools.xxx`)
- **B** = 插件后端可用 (`context.api.xxx`)
- **R/B** = 两者都可用
