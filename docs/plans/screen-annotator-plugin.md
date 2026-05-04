# 屏幕画板插件 — 实现方案

> 版本: v1.0
> 日期: 2026-05-04
> 状态: 设计稿（供插件开发者实现）

---

## 1. 产品概述

屏幕画板（Screen Annotator）让用户在任何应用上方直接涂鸦、标注、画箭头，无需截图即可在"真实桌面"上实时标注。适用于在线会议屏幕共享、远程教学、代码 review、Bug 反馈等场景。

### 核心能力

| 功能 | 说明 |
|------|------|
| 自由画笔 | 在屏幕上方自由绘制，支持颜色/粗细调节 |
| 形状工具 | 矩形、圆形、箭头、直线 |
| 文字标注 | 在屏幕上输入文字说明 |
| 高亮标记 | 半透明高亮笔，用于强调区域 |
| 序号标记 | 自动编号的圆圈标记（①②③），用于步骤说明 |
| 橡皮擦 | 擦除标注 |
| 全部清除 | 一键清除所有标注 |
| 截图保存 | 将带标注的屏幕截图保存或复制到剪贴板 |
| 画板开关 | 全局快捷键一键开启/关闭画板模式 |
| 撤销/重做 | Undo / Redo 操作历史 |
| 聚光灯模式 | 按住鼠标时只高亮光标周围圆形区域，其余区域变暗 |

---

## 2. manifest.json

```json
{
  "name": "screen-annotator",
  "version": "1.0.0",
  "displayName": "屏幕画板",
  "description": "在屏幕上方直接涂鸦、标注、画箭头，无需截图",
  "type": "productivity",
  "author": "Mulby Team",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "icon": "🖊️",
  "permissions": {},
  "features": [
    {
      "code": "annotate",
      "explain": "屏幕画板",
      "mode": "detached",
      "mainHide": true,
      "cmds": [
        { "type": "keyword", "value": "画板" },
        { "type": "keyword", "value": "annotate" },
        { "type": "keyword", "value": "draw" }
      ]
    }
  ],
  "window": {
    "type": "borderless",
    "titleBar": false,
    "transparent": true,
    "alwaysOnTop": true
  },
  "pluginSetting": {
    "single": true,
    "background": false,
    "idleTimeoutMs": 300000
  }
}
```

**说明**：
- `transparent: true` + `alwaysOnTop: true` — 全屏透明层覆盖在桌面上方
- `mainHide: true` — 触发后隐藏 Mulby 搜索框
- 不需要 `inputMonitor` 权限 — 画板窗口自身接收鼠标事件即可

---

## 3. 架构设计

```
┌─────────────────────────────────────────────────────┐
│              全屏透明画板窗口 (alwaysOnTop)            │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              Canvas 绘制层                     │  │
│  │  pointer-events: auto (画板模式)              │  │
│  │  pointer-events: none (穿透模式)              │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  ┌─────────────────────┐                           │
│  │    浮动工具栏         │  ← 可拖拽定位            │
│  │  🖊️ 🔲 ➡️ T ✏️ 🔦     │                           │
│  │  颜色 | 粗细 | 撤销  │                           │
│  └─────────────────────┘                           │
└─────────────────────────────────────────────────────┘
```

### 模式切换

画板有两种交互状态，通过浮动工具栏的「穿透/绘制」按钮或快捷键切换：

| 状态 | Canvas pointer-events | 用户操作 |
|------|----------------------|---------|
| **绘制模式** | `auto` — 捕获鼠标事件 | 在屏幕上绘制标注 |
| **穿透模式** | `none` — 事件穿透到下方 | 正常操作桌面，标注内容保持显示 |

穿透模式下工具栏仍然可交互（工具栏单独设置 `pointer-events: auto`）。

---

## 4. 数据模型

```typescript
// 绘制元素基类
interface AnnotationElement {
  id: string
  type: 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'highlight' | 'number' | 'spotlight'
  color: string
  opacity: number
  timestamp: number
}

interface FreehandElement extends AnnotationElement {
  type: 'freehand'
  points: Point[]       // 路径点序列
  lineWidth: number
  smoothing: boolean    // 是否平滑曲线
}

interface LineElement extends AnnotationElement {
  type: 'line'
  start: Point
  end: Point
  lineWidth: number
}

interface ArrowElement extends AnnotationElement {
  type: 'arrow'
  start: Point
  end: Point
  lineWidth: number
  headSize: number
}

interface RectElement extends AnnotationElement {
  type: 'rect'
  x: number
  y: number
  width: number
  height: number
  lineWidth: number
  filled: boolean
}

interface EllipseElement extends AnnotationElement {
  type: 'ellipse'
  cx: number
  cy: number
  rx: number
  ry: number
  lineWidth: number
  filled: boolean
}

interface TextElement extends AnnotationElement {
  type: 'text'
  x: number
  y: number
  content: string
  fontSize: number
  fontFamily: string
  bold: boolean
}

interface HighlightElement extends AnnotationElement {
  type: 'highlight'
  points: Point[]
  lineWidth: number     // 较粗，如 20-40px
  // opacity 固定为 0.3-0.4
}

interface NumberElement extends AnnotationElement {
  type: 'number'
  x: number
  y: number
  number: number        // 自动递增
  radius: number        // 圆圈半径
}

type Point = { x: number; y: number }
```

### 操作历史

```typescript
interface HistoryManager {
  undoStack: AnnotationElement[][]   // 每次操作前的快照
  redoStack: AnnotationElement[][]
  maxHistory: number                 // 默认 50

  push(elements: AnnotationElement[]): void
  undo(): AnnotationElement[] | null
  redo(): AnnotationElement[] | null
  canUndo(): boolean
  canRedo(): boolean
}
```

---

## 5. 工具栏设计

### 5.1 布局

浮动工具栏为水平条状，可拖拽到屏幕任意位置：

```
┌──────────────────────────────────────────────────────────────────────┐
│ ✏️  ─  →  □  ○  T  🖍  ①  🔦 │ ⬤ 🎨 │ ━━ │ ↩️ ↪️ │ 📷 🗑️ │ ✕  ◉ │
│画笔 线 箭头 矩形 圆 文字 高亮 序号 聚光  颜色  粗细   撤销    截图 清除  关闭 穿透│
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 工具状态

```typescript
interface ToolState {
  activeTool: ToolType
  color: string           // 当前颜色
  lineWidth: number       // 当前粗细
  fontSize: number        // 文字大小
  filled: boolean         // 形状是否填充
  isDrawMode: boolean     // true=绘制模式 false=穿透模式
  nextNumber: number      // 下一个序号标记的数字
}

type ToolType = 'freehand' | 'line' | 'arrow' | 'rect' | 'ellipse'
              | 'text' | 'highlight' | 'number' | 'spotlight' | 'eraser'
```

### 5.3 颜色面板

预设 8 个常用颜色 + 自定义颜色选择：

```typescript
const PRESET_COLORS = [
  '#ef4444', // 红
  '#f97316', // 橙
  '#eab308', // 黄
  '#22c55e', // 绿
  '#3b82f6', // 蓝
  '#8b5cf6', // 紫
  '#ffffff', // 白
  '#000000', // 黑
]
```

### 5.4 粗细选择

```typescript
const LINE_WIDTHS = [
  { label: '细', value: 2 },
  { label: '中', value: 4 },
  { label: '粗', value: 8 },
  { label: '超粗', value: 16 },
]
```

---

## 6. 绘制引擎

### 6.1 Canvas 渲染

使用双 Canvas 层：
- **底层**：已完成的元素（静态渲染）
- **顶层**：正在绘制中的元素（实时预览）

```typescript
function AnnotationCanvas({ elements, currentElement, tool }: Props) {
  const staticCanvasRef = useRef<HTMLCanvasElement>(null)
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)

  // 静态层：仅在 elements 变化时重绘
  useEffect(() => {
    const ctx = staticCanvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    elements.forEach(el => renderElement(ctx, el))
  }, [elements])

  // 实时层：绘制中的元素
  useEffect(() => {
    const ctx = liveCanvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    if (currentElement) renderElement(ctx, currentElement)
  }, [currentElement])

  return (
    <>
      <canvas ref={staticCanvasRef} className="annotation-layer static" />
      <canvas ref={liveCanvasRef} className="annotation-layer live" />
    </>
  )
}
```

### 6.2 自由画笔平滑

使用贝塞尔曲线平滑手绘路径：

```typescript
function renderFreehand(ctx: CanvasRenderingContext2D, el: FreehandElement) {
  if (el.points.length < 2) return

  ctx.strokeStyle = el.color
  ctx.lineWidth = el.lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = el.opacity

  ctx.beginPath()
  ctx.moveTo(el.points[0].x, el.points[0].y)

  if (el.smoothing && el.points.length > 2) {
    // 二次贝塞尔曲线平滑
    for (let i = 1; i < el.points.length - 1; i++) {
      const midX = (el.points[i].x + el.points[i + 1].x) / 2
      const midY = (el.points[i].y + el.points[i + 1].y) / 2
      ctx.quadraticCurveTo(el.points[i].x, el.points[i].y, midX, midY)
    }
    const last = el.points[el.points.length - 1]
    ctx.lineTo(last.x, last.y)
  } else {
    el.points.forEach(p => ctx.lineTo(p.x, p.y))
  }

  ctx.stroke()
  ctx.globalAlpha = 1
}
```

### 6.3 箭头渲染

```typescript
function renderArrow(ctx: CanvasRenderingContext2D, el: ArrowElement) {
  const angle = Math.atan2(el.end.y - el.start.y, el.end.x - el.start.x)
  const headLen = el.headSize || 15

  ctx.strokeStyle = el.color
  ctx.fillStyle = el.color
  ctx.lineWidth = el.lineWidth
  ctx.lineCap = 'round'

  // 线段
  ctx.beginPath()
  ctx.moveTo(el.start.x, el.start.y)
  ctx.lineTo(el.end.x, el.end.y)
  ctx.stroke()

  // 箭头头部
  ctx.beginPath()
  ctx.moveTo(el.end.x, el.end.y)
  ctx.lineTo(
    el.end.x - headLen * Math.cos(angle - Math.PI / 6),
    el.end.y - headLen * Math.sin(angle - Math.PI / 6)
  )
  ctx.lineTo(
    el.end.x - headLen * Math.cos(angle + Math.PI / 6),
    el.end.y - headLen * Math.sin(angle + Math.PI / 6)
  )
  ctx.closePath()
  ctx.fill()
}
```

### 6.4 序号标记渲染

```typescript
function renderNumber(ctx: CanvasRenderingContext2D, el: NumberElement) {
  const r = el.radius || 16

  // 圆圈背景
  ctx.fillStyle = el.color
  ctx.beginPath()
  ctx.arc(el.x, el.y, r, 0, Math.PI * 2)
  ctx.fill()

  // 数字（白色）
  ctx.fillStyle = '#ffffff'
  ctx.font = `bold ${r * 1.2}px -apple-system, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(el.number), el.x, el.y)
}
```

### 6.5 聚光灯模式

```typescript
function renderSpotlight(ctx: CanvasRenderingContext2D, cursorPos: Point, radius: number) {
  const { width, height } = ctx.canvas

  // 全屏半透明黑色遮罩
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillRect(0, 0, width, height)

  // 在光标位置"擦除"一个圆形区域
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(cursorPos.x, cursorPos.y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // 圆形边缘发光效果
  const gradient = ctx.createRadialGradient(
    cursorPos.x, cursorPos.y, radius - 5,
    cursorPos.x, cursorPos.y, radius + 10
  )
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.1)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(cursorPos.x, cursorPos.y, radius + 10, 0, Math.PI * 2)
  ctx.fill()
}
```

---

## 7. 交互逻辑

### 7.1 绘制流程

```typescript
function useDrawing(tool: ToolState) {
  const [elements, setElements] = useState<AnnotationElement[]>([])
  const [current, setCurrent] = useState<AnnotationElement | null>(null)
  const history = useRef(new HistoryManager(50))
  const isDrawing = useRef(false)

  function handlePointerDown(e: React.PointerEvent) {
    isDrawing.current = true
    const point = { x: e.clientX, y: e.clientY }

    switch (tool.activeTool) {
      case 'freehand':
      case 'highlight':
        setCurrent({
          id: genId(), type: tool.activeTool,
          points: [point],
          color: tool.activeTool === 'highlight' ? tool.color : tool.color,
          opacity: tool.activeTool === 'highlight' ? 0.35 : 1,
          lineWidth: tool.activeTool === 'highlight' ? 24 : tool.lineWidth,
          smoothing: true, timestamp: Date.now()
        })
        break

      case 'line':
      case 'arrow':
        setCurrent({
          id: genId(), type: tool.activeTool,
          start: point, end: point,
          color: tool.color, lineWidth: tool.lineWidth,
          opacity: 1, headSize: 15, timestamp: Date.now()
        })
        break

      case 'rect':
      case 'ellipse':
        setCurrent({
          id: genId(), type: tool.activeTool,
          ...shapeFromPoints(point, point),
          color: tool.color, lineWidth: tool.lineWidth,
          filled: tool.filled, opacity: 1, timestamp: Date.now()
        })
        break

      case 'number':
        const el: NumberElement = {
          id: genId(), type: 'number',
          x: point.x, y: point.y,
          number: tool.nextNumber,
          radius: 16, color: tool.color, opacity: 1, timestamp: Date.now()
        }
        history.current.push([...elements])
        setElements(prev => [...prev, el])
        // nextNumber 自增
        break

      case 'text':
        // 弹出文字输入框
        showTextInput(point)
        break

      case 'eraser':
        eraseAtPoint(point)
        break
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!isDrawing.current || !current) return
    const point = { x: e.clientX, y: e.clientY }

    switch (current.type) {
      case 'freehand':
      case 'highlight':
        setCurrent(prev => ({
          ...prev!,
          points: [...(prev as FreehandElement).points, point]
        }))
        break
      case 'line':
      case 'arrow':
        setCurrent(prev => ({ ...prev!, end: point }))
        break
      case 'rect':
      case 'ellipse':
        setCurrent(prev => ({
          ...prev!,
          ...shapeFromPoints((prev as any).start ?? { x: prev!.x, y: prev!.y }, point)
        }))
        break
    }
  }

  function handlePointerUp() {
    if (!isDrawing.current) return
    isDrawing.current = false

    if (current) {
      history.current.push([...elements])
      setElements(prev => [...prev, current])
      setCurrent(null)
    }
  }

  return { elements, current, handlePointerDown, handlePointerMove, handlePointerUp, history }
}
```

### 7.2 橡皮擦

通过碰撞检测判断鼠标位置是否接近某个元素的路径：

```typescript
function eraseAtPoint(point: Point, elements: AnnotationElement[]): AnnotationElement[] {
  const THRESHOLD = 10 // 像素容差

  return elements.filter(el => {
    switch (el.type) {
      case 'freehand':
      case 'highlight':
        return !(el as FreehandElement).points.some(
          p => distance(p, point) < THRESHOLD + el.lineWidth / 2
        )
      case 'line':
      case 'arrow':
        return distanceToLine((el as LineElement).start, (el as LineElement).end, point) > THRESHOLD
      case 'rect':
        return !isNearRect(el as RectElement, point, THRESHOLD)
      case 'number':
        return distance({ x: (el as NumberElement).x, y: (el as NumberElement).y }, point) > (el as NumberElement).radius + THRESHOLD
      default:
        return true
    }
  })
}
```

### 7.3 截图保存

将标注层与屏幕截图合并：

```typescript
async function captureWithAnnotations(elements: AnnotationElement[]) {
  // 1. 截取当前屏幕（不含 Overlay）
  // 需要临时隐藏 Overlay 窗口
  await mulby.window.hide()
  await sleep(100) // 等待窗口隐藏

  const screenshot = await mulby.screen.capture({ format: 'png' })

  await mulby.window.show()

  // 2. 用 sharp 将标注层合成到截图上
  // 或者：将标注 Canvas 导出为 PNG，再用 sharp 叠加
  const annotationCanvas = document.querySelector('.annotation-layer.static') as HTMLCanvasElement
  const annotationBlob = await new Promise<Blob>(resolve =>
    annotationCanvas.toBlob(b => resolve(b!), 'image/png')
  )
  const annotationBuffer = new Uint8Array(await annotationBlob.arrayBuffer())

  // 3. 合成
  const composited = await mulby.sharp.composite(screenshot, annotationBuffer)

  // 4. 复制到剪贴板 + 可选保存
  mulby.clipboard.writeImage(composited)
  mulby.notification.show('截图已复制到剪贴板')
}
```

---

## 8. 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Esc` | 退出画板 / 取消当前绘制 |
| `Tab` | 切换绘制模式 ↔ 穿透模式 |
| `⌘+Z` / `Ctrl+Z` | 撤销 |
| `⌘+⇧+Z` / `Ctrl+Y` | 重做 |
| `⌘+S` / `Ctrl+S` | 截图保存 |
| `⌘+A` / `Ctrl+A` | 全选 |
| `Delete` / `Backspace` | 删除选中元素 |
| `1` - `9` | 快速选择工具（1=画笔 2=线 3=箭头 4=矩形 5=圆 6=文字 7=高亮 8=序号 9=聚光灯） |
| `[` / `]` | 减小/增大画笔粗细 |
| `C` | 打开颜色面板 |

---

## 9. 窗口初始化

```typescript
// App.tsx
function App() {
  useEffect(() => {
    async function init() {
      // 全屏覆盖
      const display = await mulby.screen.getPrimaryDisplay()
      await mulby.window.setBounds({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      })
      // 确保置顶
      await mulby.window.setAlwaysOnTop(true)
    }
    init()
  }, [])

  return (
    <div className="annotator-root">
      <AnnotationCanvas />
      <FloatingToolbar />
    </div>
  )
}
```

**CSS 关键样式**：

```css
html, body, .annotator-root {
  margin: 0;
  padding: 0;
  width: 100vw;
  height: 100vh;
  background: transparent;
  overflow: hidden;
  cursor: crosshair;
}

.annotation-layer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.floating-toolbar {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: auto;  /* 工具栏始终可交互 */
  z-index: 999;
}

/* 穿透模式下画布不接收事件 */
.annotator-root.passthrough .annotation-layer {
  pointer-events: none;
}
```

---

## 10. 开发步骤

### Phase 1: 基础画板

1. 搭建项目骨架，全屏透明窗口
2. 实现 Canvas 绘制层
3. 实现自由画笔工具（含贝塞尔平滑）
4. 实现浮动工具栏（可拖拽）
5. 实现颜色和粗细选择

### Phase 2: 形状工具

6. 实现直线工具
7. 实现箭头工具
8. 实现矩形工具
9. 实现圆形工具
10. 实现实时预览（绘制中的形状跟随鼠标）

### Phase 3: 高级标注

11. 实现文字标注（点击后弹出输入框）
12. 实现高亮笔
13. 实现序号标记（自动递增）
14. 实现橡皮擦
15. 实现撤销/重做

### Phase 4: 聚光灯 & 截图

16. 实现聚光灯模式
17. 实现截图保存（隐藏 Overlay → 截屏 → 合成 → 复制）
18. 实现穿透模式切换

### Phase 5: 打磨

19. 快捷键绑定
20. 工具栏动画和过渡效果
21. 多屏幕支持
22. 性能优化（大量元素时的重绘策略）

---

## 11. 性能注意

| 环节 | 建议 |
|------|------|
| Canvas 重绘 | 双层 Canvas 分离静态/动态内容，减少全量重绘 |
| 自由画笔点采样 | 对 pointermove 事件做距离过滤（< 2px 忽略），减少路径点 |
| 大量元素 | 超过 100 个元素时，将旧元素"烘焙"成一张位图底层 |
| 窗口大小 | 全屏 Canvas 在 4K/5K 屏幕上像素量巨大，考虑用 `devicePixelRatio` 适配但限制最大分辨率 |
