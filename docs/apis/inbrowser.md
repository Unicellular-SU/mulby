# InBrowser API (inbrowser)
本文档描述 InBrowser API (inbrowser) 的使用方法与接口。

> 入口：`window.mulby.inbrowser`

InBrowser 是可编程自动化浏览器 API，支持链式调用。所有链式方法返回同一个 Builder，最终通过 `run()` 执行。

### 基础用法

```javascript
const result = await window.mulby.inbrowser
  .goto('https://example.com')
  .click('#login')
  .input('#username', 'user')
  .input('#password', 'pass')
  .press('Enter')
  .wait(2000)
  .screenshot()
  .run();
```

### 方法签名与返回

> 以下所有链式方法返回 `InBrowser`（同一 Builder）。

### goto(url, headers?, timeout?)
[Renderer]
- `url: string`
- `headers?: Record<string, string>` - 可传 `Referer`、`User-Agent`
- `timeout?: number` - 超时毫秒

### useragent(ua)
[Renderer]
- `ua: string`

### device(options | name)
[Renderer]
- `options: { userAgent: string; size: { width: number; height: number } }`
- `name: string` - 内置设备名（如 `iPhone X`, `iPad`）

### click(selectorOrX, mouseButtonOrY?, mouseButton?)
[Renderer]
- `selectorOrX: string | number`
- `mouseButtonOrY?: 'left' | 'middle' | 'right' | number`
- `mouseButton?: 'left' | 'middle' | 'right'`

### mousedown(selectorOrX, mouseButtonOrY?, mouseButton?)
[Renderer]
同 `click`。

### mouseup(selectorOrX, mouseButtonOrY?, mouseButton?)
[Renderer]
同 `click`。

### dblclick(selectorOrX, mouseButtonOrY?, mouseButton?)
[Renderer]
同 `click`。

### hover(selectorOrX, y?)
[Renderer]
- `selectorOrX: string | number`
- `y?: number`

### type(selector, text)
[Renderer]
- `selector: string`
- `text: string`

### input(selectorOrText, text?)
[Renderer]
- `input(text: string)` - 向当前焦点输入
- `input(selector: string, text: string)` - 向指定选择器输入

### press(key, modifiers?)
[Renderer]
- `key: string`
- `modifiers?: string[]`

### show() / hide()
[Renderer]
显示或隐藏窗口。

### viewport(width, height)
[Renderer]
- `width: number`
- `height: number`

### css(cssText)
[Renderer]
- `cssText: string`

### when(selectorOrFunc, ...params)
[Renderer]
- `selectorOrFunc: string | Function`
- `...params: any[]`

### wait(msOrSelectorOrFunc, ...params)
[Renderer]
- `msOrSelectorOrFunc: number | string | Function`
- `...params: any[]`

### cookies(nameOrFilter?)
[Renderer]
- `nameOrFilter?: string | CookieFilter`

### setCookies(nameOrCookies, value?)
[Renderer]
- `nameOrCookies: string | { name: string; value: string }[]`
- `value?: string`

### removeCookies(name)
[Renderer]
- `name: string`

### clearCookies(url?)
[Renderer]
- `url?: string`

### value(selector, val)
[Renderer]
- `selector: string`
- `val: string`

### check(selector, checked)
[Renderer]
- `selector: string`
- `checked: boolean`

### scroll(selectorOrYOrX, optionalOrY?)
[Renderer]
- `scroll(y: number)`
- `scroll(x: number, y: number)`
- `scroll(selector: string, options?: boolean | ScrollIntoViewOptions)`

### devTools(mode?)
[Renderer]
- `mode?: 'right' | 'bottom' | 'undocked' | 'detach'`

### focus(selector)
[Renderer]
- `selector: string`

### paste(text)
[Renderer]
- `text: string`

### end()
[Renderer]
结束并销毁窗口实例。

### pdf(options?, savePath?)
[Renderer]
- `options?: Electron.PrintToPDFOptions`
- `savePath?: string`

### screenshot(target?, savePath?)
[Renderer]
- `target?: string | { x: number; y: number; width: number; height: number }`
- `savePath?: string`

### markdown(selector?)
[Renderer]
- `selector?: string`

#### download(urlOrFunc, savePath?, ...params)
[Renderer]
- `urlOrFunc: string | Function`
- `savePath?: string | null`
- `...params: any[]`

#### evaluate(funcOrString, ...params)
[Renderer]
- `funcOrString: Function | string`
- `...params: any[]`

### file(selector, payload)
[Renderer]
- `selector: string`
- `payload: string | string[] | Buffer`

### drop(selectorOrX, optionalYOrPayload, payload?)
[Renderer]
- `drop(selector: string, payload: string | string[] | Buffer)`
- `drop(x: number, y: number, payload: string | string[] | Buffer)`

### run(idOrOptions?, options?)
[Renderer]
执行队列。

```typescript
interface InBrowserOptions {
  show?: boolean;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  center?: boolean;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  resizable?: boolean;
  movable?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  fullscreenable?: boolean;
  enableLargerThanScreen?: boolean;
  opacity?: number;
  frame?: boolean;
  closable?: boolean;
  focusable?: boolean;
  skipTaskbar?: boolean;
  backgroundColor?: string;
  hasShadow?: boolean;
  transparent?: boolean;
  titleBarStyle?: 'default' | 'hidden' | 'hiddenInset' | 'customButtonsOnHover';
  thickFrame?: boolean;
  webPreferences?: Electron.WebPreferences;
}
```

**返回值**: `Promise<any[]>` - 按调用顺序返回结果（如 `evaluate`, `screenshot`, `pdf`, `cookies`, `markdown` 会产出结果）。

### 完整示例

### download(urlOrFunc, savePath?, ...params)
[Renderer]

```javascript
// 直接下载
await window.mulby.inbrowser
  .download('https://example.com/file.zip', '/tmp/file.zip')
  .run();

// 通过函数动态获取下载 URL
await window.mulby.inbrowser
  .download(() => document.querySelector('#download')?.href)
  .run();
```

### evaluate(funcOrString, ...params)
[Renderer]

```javascript
const [title] = await window.mulby.inbrowser
  .goto('https://example.com')
  .evaluate(() => document.title)
  .run();
```

#### wait(msOrSelectorOrFunc, ...params)
[Renderer]

```javascript
// 等待 1s
await window.mulby.inbrowser.wait(1000).run();

// 等待元素出现（内部默认超时 15s）
await window.mulby.inbrowser.wait('#login').run();

// 等待自定义条件
await window.mulby.inbrowser
  .wait(() => document.querySelectorAll('li').length > 10)
  .run();
```

#### drop(selectorOrX, optionalYOrPayload, payload?)
[Renderer]

```javascript
// 按选择器拖放文件
await window.mulby.inbrowser
  .drop('#dropzone', ['/path/a.txt', '/path/b.txt'])
  .run();

// 按坐标拖放 data URL
await window.mulby.inbrowser
  .drop(200, 300, 'data:image/png;base64,...')
  .run();
```

### 管理方法

### getIdleInBrowsers()
[Renderer]
获取空闲的 InBrowser 实例。

### setInBrowserProxy(config)
[Renderer]
设置代理。

### clearInBrowserCache()
[Renderer]
清理缓存。
