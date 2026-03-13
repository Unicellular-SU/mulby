 我来帮你把这个网页内容转换成 Markdown 格式。  
# 可编程自动化浏览器

ubrowser（uTools browser）是基于 uTools 特性量身打造的 **可编程自动化浏览器**。它不仅能以自动化方式连接任意互联网服务，并与 uTools 深度集成，更重要的是它依然是 **一个可视的浏览器窗口**，，可以像普通浏览器一样打开网页供用户直接操作。

ubrowser 提供了优雅的 **链式调用方法**，只需几行类似自然语言的代码，即可完成一系列复杂操作。例如：

```js
utools.ubrowser.goto('https://www.baidu.com').input('uTools').press('enter').run({ width: 1200, height: 800 })
```

## 链式方法说明

### `ubrowser.goto(url[, headers][, timeout])`

打开一个 ubrowser 窗口，并跳转到指定网页

#### 类型定义

```ts
function goto(
  url: string,
  headers?: Record<string, string>,
  timeout?: number
): UBrowser;
```

- `url`: 要跳转的网页地址
- `headers`: 请求头
- `timeout`: 超时时间，单位毫秒

### `ubrowser.useragent(ua)`

设置用户代理（User-Agent）

#### 类型定义

```ts
function useragent(ua: string): UBrowser;
```

- `ua`: User-Agent 字符串

### `ubrowser.viewport(width, height)`

设置浏览器视窗大小

#### 类型定义

```ts
function viewport(width: number, height: number): UBrowser;
```

- `width`: 视窗宽度
- `height`: 视窗高度

### `ubrowser.hide()`

隐藏 ubrowser 窗口

#### 类型定义

```ts
function hide(): UBrowser;
```

### `ubrowser.show()`

显示 ubrowser 窗口

#### 类型定义

```ts
function show(): UBrowser;
```

### `ubrowser.css(css)`

添加自定义 CSS

#### 类型定义

```ts
function css(css: string): UBrowser;
```

- `css`: 自定义 CSS

### `ubrowser.evaluate(func[, params])`

在网页中执行自定义 JS 代码

#### 类型定义

```ts
function evaluate(func: Function, params?: any[]): UBrowser;
```

- `func`: 网页内执行的 JS 函数，函数若有返回值，则会在 `run` Promise 结果返回
- `params`: 传递给 `func` 的参数

### `ubrowser.press(key[, modifiers])`

模拟键盘按键

#### 类型定义

```ts
function press(key: string, ...modifiers: string[]): UBrowser;
```

- `key`: 要模拟的按键
- `modifiers`: 要模拟的修饰键，一般为 `shift`、`ctrl`、`alt`、`meta`

### `ubrowser.click(selector[, mouseButton])`

鼠标点击

#### 类型定义

```ts
// 点击元素
function click(selector: string, mouseButton?: 'left' | 'middle' | 'right'): UBrowser;
// 在坐标位置点击
function click(x: number, y: number, mouseButton?: 'left' | 'middle' | 'right'): UBrowser;
```

- `selector`: CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套
- `x`, `y`: 基于坐标的物理鼠标点击
- `mouseButton`:（可选）设置鼠标按钮，设置后将执行的是物理点击，`left` 左键，`middle` 中键，`right` 右键

### `ubrowser.mousedown(selector[, mouseButton])`

鼠标按下

#### 类型定义

```ts
// 元素上鼠标按下
function mousedown(selector: string, mouseButton?: 'left' | 'middle' | 'right'): UBrowser;
// 在坐标上鼠标按下
function mousedown(x: number, y: number, mouseButton?: 'left' | 'middle' | 'right'): UBrowser;
```

- `selector`: CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套
- `x`, `y`: 基于坐标的物理鼠标按下
- `mouseButton`: （可选）设置鼠标按钮，设置后将执行的是物理鼠标按下，`left` 左键，`middle` 中键，`right` 右键

### `ubrowser.mouseup(selector[, mouseButton])`

鼠标按键抬起

#### 类型定义

```ts
// 元素上鼠标按键抬起
function mouseup(selector: string, mouseButton?: 'left' | 'middle' | 'right'): UBrowser;
// 在坐标上鼠标按键抬起
function mouseup(x: number, y: number, mouseButton?: 'left' | 'middle' | 'right'): UBrowser;
```

- `selector`: CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套
- `x`, `y`: 基于坐标的物理鼠标按键抬起
- `mouseButton`: （可选）设置鼠标按钮，设置后将执行的是物理鼠标按键抬起，`left` 左键，`middle` 中键，`right` 右键

### `ubrowser.dblclick(selector[, mouseButton])`

鼠标双击

#### 类型定义

```ts
// 双击元素
function dblclick(selector: string, mouseButton?: 'left' | 'middle' | 'right'): UBrowser;
// 在坐标位置双击
function dblclick(x: number, y: number, mouseButton?: 'left' | 'middle' | 'right'): UBrowser;
```

- `selector`: CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套
- `x`, `y`: 基于坐标的物理鼠标双击
- `mouseButton`:（可选） 设置鼠标按钮，设置后将执行的是物理鼠标双击，`left` 左键，`middle` 中键，`right` 右键

### `ubrowser.hover(selector)`

鼠标移动到元素或坐标位置悬停

#### 类型定义

```ts
// 在元素上悬停
function hover(selector: string): UBrowser;
// 在坐标位置悬停
function hover(x: number, y: number): UBrowser;
```

- `selector`: CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套
- `x`, `y`: 基于坐标的鼠标悬停

### `ubrowser.file(selector, payload)`

上传文件

#### 类型定义

```ts
function file(selector: string, payload: string | string[] | Buffer): UBrowser;
```

- `selector`: CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套，元素必须是 `input[type=file]`
- `payload`: 图片 base64、文件路径、文件路径集合、文件 Buffer

### `ubrowser.drop(selector, payload)`

拖放文件

#### 类型定义

```ts
// 拖放文件到元素上
function drop(selector: string, payload: string | string[] | Buffer, ): UBrowser;
// 拖放文件到指定坐标位置
function drop(x: number, y: number, payload: string | string[] | Buffer, ): UBrowser;
```

- `selector`: CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套
- `x`, `y`: 基于窗口的坐标位置
- `payload`: 图片 base64、文件路径、文件路径集合、文件 Buffer

### `ubrowser.input([selector?, ]payload)`

输入文本，模拟输入法输入，不触发键盘按键事件

#### 类型定义

```ts
// 输入文本
function input(text: string): UBrowser;
// 元素获得焦点，再输入文本
function input(selector: string, text: string): UBrowser;
```

- `text`：输入的文本
- `selector`：使用 CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套（元素将在输入前将获得焦点）

### `ubrowser.value(selector, payload)`

对 `input`、`textarea`、`select` 元素赋值

#### 类型定义

```ts
function value(selector: string, value: string): UBrowser;
```

- `selector`: 使用 CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套
- `value`: 字符串

### `ubrowser.check(selector, checked)`

对 `checkbox`、`radio` 元素勾选和取消勾选

#### 类型定义

```ts
function check(selector: string, checked: boolean): UBrowser;
```

- `selector`: 使用 CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套
- `checked`: 为 `true` 时，勾选，否则取消勾选

### `ubrowser.focus(selector)`

执行聚焦操作

#### 类型定义

```ts
function focus(selector: string): UBrowser;
```

- `selector`: CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套

### `ubrowser.scroll(selector)`

执行滚动操作

#### 类型定义

```ts
// 元素滚动到可见位置
function scroll(selector: string, optional?: boolean | {
  behavior?: 'auto' | 'smooth';
  block?: 'start' | 'center' | 'end' | 'nearest';
  inline?: 'start' | 'center' | 'end' | 'nearest';
}): UBrowser;
// 滚动 y 轴到指定位置
function scroll(y: number): UBrowser;
// 滚动 x 轴和 y 轴到指定位置
function scroll(x: number, y: number): UBrowser;
```

- `selector`: 滚动到指定元素，使用 CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套
- `optional`: 控制元素滚动行为的可选配置
  - `boolean`：`true` 相当于 `{ block: 'start' }`，`false` 相当于 `{ block: 'nearest' }`
  - `ScrollIntoViewOptions`：与浏览器原生 `scrollIntoView()` 一致
    - `behavior`: `'auto' | 'smooth'` — 滚动动画方式
    - `block`: `'start' | 'center' | 'end' | 'nearest'` — 垂直对齐方式
    - `inline`: `'start' | 'center' | 'end' | 'nearest'` — 水平对齐方式
- `x`: 滚动 x 轴到指定位置
- `y`: 滚动 y 轴到指定位置

### `ubrowser.download(url[, savePath])`

执行下载操作

#### 类型定义

```ts
function download(url: string, savePath?: string): UBrowser;
function download(
  func: (...params: any[]) => string,
  savePath: string | null,
  ...params: any[]
): UBrowser;
```

- `url` 待下载的资源 URL
- `savePath` 指定下载路径，不传则下载到默认路径
- `func` 网页内执行的 JS 函数，函数可返回资源 URL，再根据返回 URL 下载资源
- `params` 传递给 `func` 的参数

### `ubrowser.paste(text)`

先复制再执行粘贴操作

#### 类型定义

```ts
function paste(text: string): UBrowser;
```

- `text`: 要粘贴的内容，支持普通文本跟图像 Base64 Data URL

### `ubrowser.screenshot(target[, savePath])`

对网页进行截图并保持到指定路径，将会保存成为 png 格式

#### 类型定义

```ts
function screenshot(target?: string | Rect, savePath?: string): UBrowser;
```

- 没有参数时，整个网页窗口截图
- 当 `target` 为 `string` 时，`target` 为选择器。可以传入一个 `Rect` 对象，表示截取指定区域。
- `savePath` 保存路径，没有传递 `savePath` 的时，默认存储在临时目录。

`Rect` 类型定义

```ts
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

### `ubrowser.markdown([selector])`

将当前网页内容转换为 markdown

#### 类型定义

```ts
function markdown(selector?: string): UBrowser;
```

- `selector`: （可选）指定要转换的元素，使用 CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套，不传递则转换整个网页内容

### `ubrowser.pdf(options[, savePath])`

将网页保存为 PDF

#### 类型定义

```ts
function pdf(options: PdfOptions, savePath?: string): UBrowser;
```

- `PdfOptions` 参考 [Electron `PrintToPDFOptions`](https://www.electronjs.org/docs/latest/api/web-contents#contentsprinttopdfoptions)
- `savePath` 保存路径，没有传递 `savePath` 的时，默认存储在临时目录。

### `ubrowser.device(options)`

模拟移动设备

#### 类型定义

```ts
function device(options: DeviceOptions): UBrowser;
```

- `options` 模拟设备信息

`DeviceOptions` 类型定义

```ts
interface DeviceOptions {
  userAgent: string;
  size: {
    width: number;
    height: number;
  };
}
```

### `ubrowser.wait(ms)`

执行等待操作

#### 类型定义

```ts
// 等待时间
function wait(ms: number): this;
// 等待元素
function wait(selector: string, result?: boolean): this;
// 等待元素
function wait(selector: string, timeout?: number): this;
// 等待元素
function wait(selector: string, option?: { timeout?: number, interval?: number, result?: boolean }): this;
// 等待函数执行结果返回 true
function wait(func: (...params: any[]) => boolean, timeout?: number, ...params: any[]): this;
// 等待函数执行结果返回 true
function wait(func: (...params: any[]) => boolean, option?: { timeout?: number, interval?: number }, ...params: any[]): this;
```

- `ms`: 等待指定毫秒数
- `selector`: 等待元素出现，使用 CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套
- `result`: 默认为 `true`，设为 `false` 时表示元素不存在时等待结束
- `timeout`: 等待超时时间，默认为 60000ms (60 秒)
- `interval`: 检查间隔，默认为 500ms
- `func`: 网页内执行的 JS 函数，返回 `true` 等待结束
- `params`: 传递给 `func` 的参数

### `ubrowser.when(selector[, result])`

条件判断

#### 类型定义

```ts
// 判断元素是否存在
function when(selector: string, result?: boolean): UBrowser;
// 判断函数返回的结果为 true 时
function when(func: (...params: any[]) => boolean, ...params: any[]): UBrowser;
```

- `selector` 判断是否存在元素，使用 CSS 或 XPath 选择器，支持使用 `>>` 进行 iframe 嵌套
- `result` 默认为 `true`，设为 `false` 表示当元素不存在时满足条件
- `func` 网页内执行的 JS 函数，判断函数返回的结果
- `params` 传递给 `func` 的参数

### `ubrowser.end()`

结束上一个 `when`

#### 类型定义

```ts
function end(): UBrowser;
```

### `ubrowser.devTools([mode])`

打开 ubrowser 开发者工具。

#### 类型定义

```ts
function devTools(mode?: string): void;
```

- `mode`: 可选值 'right' | 'bottom' | 'undocked' | 'detach'，默认 'detach'

### `ubrowser.cookies([name])`

获取 ubrowser cookie

#### 类型定义

```ts
// 在当前 url 根据名称获取 cookie，为空获取当前 url 全部 cookie
function cookies(name?: string): UBrowser;
// 根据条件获取 Cookie
function cookies(filter: CookieFilter): UBrowser;
```

- `name` cookie 名称
- `filter` 过滤对象

`CookieFilter` 类型定义

```ts
interface CookieFilter {
  url?: string;
  name?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  session?: boolean;
  httpOnly?: boolean;
}
```

- `url` 检索与 url 相关的 cookie。空意味着检索所有 URL 的 cookie。
- `name` 按名称筛选 cookie。
- `domain` 检索与域名或者 domain 子域名匹配的 cookie。
- `path` 检索路径与 path 匹配的 cookie。
- `secure` 通过其 Secure 属性筛选 cookie。
- `session` 筛选出 session 内可用或持久性 cookie。
- `httpOnly` 通过其 httpOnly 属性筛选 cookie。

### `ubrowser.setCookies`

设置 ubrowser 的 cookie

#### 类型定义

```ts
function setCookies(name: string, value: string): UBrowser;
function setCookies(cookies: { name: string; value: string }[]): UBrowser;
```

- `name` cookie 名称
- `value` cookie 值
- `cookies` cookie 名称和值对象的集合

### `ubrowser.removeCookies(name)`

删除 ubrowser 的 cookie

#### 类型定义

```ts
function removeCookies(name: string): UBrowser;
```

- `name` cookie 名称

### `ubrowser.clearCookies([url])`

清空 ubrowser 的 cookie 信息。

#### 类型定义

```ts
function clearCookies(url?: string): UBrowser;
```

- `url`: 根据 url 清除 cookie，`clearCookies` 在 `goto` 函数之前调用时 `url` 不能为空。在 `goto` 之后调用则清空当前 url 的 cookie

### `ubrowser.run()`

开始运行 ubrowser 实例，并返回执行结果

#### 类型定义

```ts
function run(
  ubrowserId?: number,
  options?: UBrowserOptions
): Promise<[...any, UBrowserInstance]>;
```

- `ubrowserId` 一般以下两种形式获取：
  - `ubrowser.run` 返回的 `UBrowserInstance` 的 `id` 属性（ubrowser 窗口仍在显示时）。
  - `utools.getIdleUBrowser` 返回的 `UBrowserInstance` 的 `id` 属性。
- `run` 返回将会返回一个包含数组的 Promise 对象，数组的最后一个元素是当前未关闭窗口的 UBrowser 实例，其余的元素则是运行过程中，其他 ubrowser 方法的返回值，比如 `evaluate`、`cookies` 等。

`UBrowserOptions` 类型定义

```ts
interface UBrowserOptions {
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
  titleBarStyle?: string;
  thickFrame?: boolean;
}
```

- `show`: 是否显示浏览器窗口
- `width`: 浏览器窗口宽度，默认 `800`
- `height`: 浏览器窗口高度，默认 `600`
- `x`: 浏览器窗口位置 x 坐标
- `y`: 浏览器窗口位置 y 坐标
- `center`: 浏览器窗口是否居中
- `minWidth`: 浏览器窗口最小宽度，默认 `0`
- `minHeight`: 浏览器窗口最小高度，默认 `0`
- `maxWidth`: 浏览器窗口最大宽度，默认无限制
- `maxHeight`: 浏览器窗口最大高度，默认无限制
- `resizable`: 浏览器窗口是否可缩放，默认 `true`
- `movable`: 浏览器窗口是否可移动，默认 `true`
- `minimizable`: 浏览器窗口是否可最小化，默认 `true`
- `maximizable`: 浏览器窗口是否可最大化，默认 `true`
- `alwaysOnTop`: 浏览器窗口是否置顶，默认 `false`
- `fullscreen`: 浏览器窗口是否全屏，默认 `false`
- `fullscreenable`: 浏览器窗口是否可全屏，默认 `true`
- `enableLargerThanScreen`: 浏览器窗口是否可超出屏幕，默认 `false`，仅在 macOS 下生效
- `opacity`: 浏览器窗口透明度，默认 `1`，支持 `0`-`1` 之间的值，仅在 macOS 跟 Windows 下生效
- `frame`: 浏览器窗口是否有边框，默认 `true`
- `closable`: 浏览器窗口是否可关闭，默认 `true`
- `focusable`: 浏览器窗口是否可聚焦，默认 `true`
- `skipTaskbar`: 浏览器窗口是否跳过任务栏，默认 `false`
- `backgroundColor`: 浏览器窗口背景颜色，默认 `#ffffff`
- `hasShadow`: 浏览器窗口是否有阴影，默认 `false`
- `transparent`: 浏览器窗口是否透明，默认 `false`
- `titleBarStyle`: 浏览器窗口标题栏样式，默认 `default`，可选值 `hidden`、`hiddenInset`、`customButtonsOnHover`
- `thickFrame`: 浏览器窗口边框是否加粗，默认 `false`

`UBrowserInstance` 类型定义

```ts
interface UBrowserInstance {
  id: string;
  url: string;
  title: string;
  width: number;
  height: number;
  x: number;
  y: number;
}
```

## 示例代码

```js
const address = "福州烟台山";
// 在地图上显示地址位置
utools.ubrowser
  // 打开百度地图站点
  .goto("https://map.baidu.com")
  // 地址搜索框输入地址
  .input("#sole-input", address)
  // 等待 300 毫秒
  .wait(300)
  // 按下回车
  .press("enter")
  .run({ width: 1200, height: 800 });
```

```js
const expressNo = "YT8933937901850";
// 快递 100 查询快递单号
utools.ubrowser
  // 打开快递 100
  .goto("https://www.kuaidi100.com/")
  // 滚动到合适位置
  .scroll(0, 450)
  // 输入快递单号
  .input("#input", expressNo)
  // 点击查询
  .click("#query")
  .run({ width: 1200, height: 800 });
```

```js
const filePath = `/path/to/test.zip`;
// 发送文件到微信文件传输助手
utools.ubrowser
  .goto("https://filehelper.weixin.qq.com")
  // 等待扫码登录
  .wait("textarea")
  // 上传文件，自动发送
  .file("#btnFile", filePath)
  .run({ width: 720, Height: 680 });
```

```js
const text = `https://pan.baidu.com/s/1ekPm-ooS0uvVA_J7ZqVGDQ 提取码: kvr5`;
const matchs = text.match(/(https?:\/\/[a-z0-9-._~:/?=#]+)\s*(?:\(|\()??:提取密?码?|访问密?码|密码)\s*(?::|：)?\s*([a-z0-9]{4,6})/i);
// 网盘自动提取
utools.ubrowser
  // 清除 cookie
  .clearCookies(matchs[1])
  // 打开网盘地址
  .goto(matchs[1])
  // 等待页面加载完成出现 input 元素
  .wait("input")
  // 让提取码输入框获得焦点
  .focus("//input[contains(@placeholder, '提取码') or contains(@placeholder, '访问码')]")
  // 输入提取码
  .input(matchs[2])
  // 回车
  .press("enter")
  .run({ width: 1200, height: 800 });
```

```js
utools.ubrowser.goto('https://container.iframe.test.web')
  // 等待 iframe 内存在 button
  .wait("iframe#outer >> iframe#inner >> button.login")
  // 点击 iframe 内的 button
  .click("iframe#outer >> iframe#inner >> button.login")
  .run({ width: 1200, height: 800 });
```

## ubrowser 管理

用于管理 ubrowser 的实例对象，以及设置 ubrowser 的代理对象等。

### `utools.getIdleUBrowsers()`

获取所有空闲的 ubrowser 实例对象。

#### 类型定义

```ts
function getIdleUBrowsers(): UBrowserInstance[];
```

- `UBrowserInstance` 参考 [`UBrowserInstance` 类型定义](#ubrowserinstance-类型定义)

#### 示例代码

```js
const idleUBrowsers = utools.getIdleUBrowsers();
console.log(idleUBrowsers);
if (idleUBrowsers.length > 0) {
  utools.ubrowser.goto('https://www.u-tools.cn').run(idleUBrowsers[0].id)
}
```

### `utools.setUBrowserProxy(config)`

设置 ubrowser 的代理。

#### 类型定义

```ts
function setUBrowserProxy(config: ProxyConfig): boolean;
```

- `config` 参考 [Electron `ProxyConfig` 类型定义](https://www.electronjs.org/docs/latest/api/structures/proxy-config)

#### 示例代码

```js
utools.setUBrowserProxy({
  proxyRules: "http://127.0.0.1:1080",
});
```

### `utools.clearUBrowserCache()`

清除 ubrowser 的缓存。

#### 类型定义

```ts
function clearUBrowserCache(): boolean;
```

#### 示例代码

```js
utools.clearUBrowserCache();
```