# 权限管理器实现进度

> **更新时间**: 2026-01-11
> **状态**: ✅ 已完成

## 完成内容

### 核心模块
- [x] `src/main/plugin/permission-manager.ts` (310 行)
  - 跨平台权限管理器
  - macOS: `node-mac-permissions` 集成
  - Windows/Linux: `session.setPermissionRequestHandler`

### 地理位置模块
- [x] `src/main/plugin/geolocation.ts` - 重构使用权限管理器
- [x] `src/main/ipc/geolocation.ts` - 新增 IPC 端点
- [x] `src/preload/index.ts` - 暴露新 API

### 类型定义
- [x] `src/shared/types/electron.d.ts` - 更新 geolocation 类型

### 构建配置
- [x] `package.json` - 添加 `node-mac-permissions`，electron-builder 配置
- [x] `resources/Info.plist` - macOS 权限描述

### 插件集成
- [x] `plugins/intools-showcase/src/types/intools.d.ts`
- [x] `plugins/intools-showcase/src/ui/hooks/useIntools.ts`
- [x] `plugins/intools-showcase/src/ui/modules/SystemInfo/index.tsx`

### 文档
- [x] `docs/api-reference.md` - 更新 Geolocation API 文档

## 新增 API

```typescript
geolocation.getAccessStatus()   // 获取权限状态
geolocation.requestAccess()     // 请求权限
geolocation.canGetPosition()    // 能否获取位置
geolocation.openSettings()      // 打开系统设置
geolocation.getCurrentPosition() // 获取当前位置
```

## 测试方法

1. 运行 `npm run electron:dev`
2. 打开 intools-showcase 插件
3. 进入"系统信息"模块
4. 点击"获取位置"按钮
5. 观察终端日志和系统权限弹窗

## 依赖项

- `node-mac-permissions@^2.5.0` (macOS 权限检查)

---

# 系统文件搜索支持进度

> **更新时间**: 2026-01-18
> **状态**: ✅ 已完成

## 完成内容

### 核心模块
- [x] `src/main/plugin/desktop.ts`
  - 跨平台文件搜索实现
  - macOS: `mdfind`
  - Windows: `es` (Everything CLI)
  - Linux: `locate`

### IPC 通信
- [x] `src/main/ipc/desktop.ts` - 注册搜索处理程序
- [x] `src/main/ipc/index.ts` - 整合 Desktop 模块

### 预加载脚本
- [x] `src/preload/index.ts` - 暴露 `intools.desktop.searchFiles`

## API 说明

```typescript
// 搜索系统文件
// query: 关键词
// limit: 限制返回数量 (默认 100)
intools.desktop.searchFiles(query: string, limit?: number): Promise<FileSearchResult[]>

interface FileSearchResult {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}
```

## 注意事项
- Windows 平台强依赖 "Everything" 及其命令行工具 `es.exe`。
- Linux 平台依赖 `locate` 命令（需确保 `updatedb` 定期运行）。
- macOS 使用原生 Spotlight 索引，无需额外配置。

---

# 搜索 Worker 修复进度

> **更新时间**: 2026-01-18
> **状态**: ✅ 已完成

## 完成内容

### 搜索 Worker 模块
- [x] Fix `filesystem.writeFile` to support `ArrayBuffer` input (resolves JSPDF output issue)
- [x] Enhance `ArrayBuffer` support for other modules:
  - `security.decryptString`: Accept `ArrayBuffer`
  - `input.hideMainWindowPasteImage`: Accept `ArrayBuffer`
  - `http.post` / `http.put`: Accept `ArrayBuffer` as body
- [x] Update documentation in `docs/apis/`
- [ ] Fix Search Worker Errors (In Progress)
- [x] `src/main/plugin/search-worker-manager.ts`
  - 修复 `UtilityProcess` API 使用错误（移除 `.killed` 和 `error` 事件监听）
  - 修正消息 Payload 类型推断
- [x] `src/main/plugin/search-worker.ts`
  - 修正消息 Payload 类型推断
  - 标准化消息解包逻辑

### 验证
- [x] 通过 `typecheck` 检查，相关文件无报错

# 插件列表 UI 优化进度

> **更新时间**: 2026-01-18
> **状态**: ✅ 已完成

## 完成内容

### UI 优化
- [x] 重构 `components/PluginList.tsx`
  - 优化 DOM 结构，便于样式控制
  - 动态计算列数以修复导航逻辑
- [x] 更新 `styles/index.css`
  - 恢复 **垂直布局**（图标在上，文字在下），但通过减小内边距和间距保持高空间利用率
  - 调整 Grid 断点，在小屏幕 (<760px) 下显示 4 列（原为 3 列）
  - 增大插件图标尺寸 (32px -> 44px)，提升视觉识别度
  - 优化 **暗色模式** 样式：
    - 图标容器背景在暗色下设为透明，去除"脏"感
    - 调整边框颜色和 Hover 状态，提升精致度
    - **智能修复黑色 SVG 图标**：应用反色滤镜 (`invert + hue-rotate`)，将黑色图标翻转为白色，同时保留彩色图标色相
  - 微调内边距 (padding) 和间隙 (gap) 适配大图标

---

# PDF 水印预览优化

> **更新时间**: 2026-01-19
> **状态**: ✅ 已完成

## 完成内容

### UI 优化
- [x] `plugins/pdf-tools/src/ui/pages/Watermark.tsx`
  - 优化预览区域样式
  - 移除预览图片的尺寸限制 (90% -> 100%)，使其填满预览容器
  - 移除图片阴影，减少视觉干扰
  - 修复预览模式下的图片拉伸问题 (`object-fit: contain`)
  - 修正预览水印旋转方向，与后端坐标系对齐
  - 重构前端平铺预览逻辑：废弃 Flex 布局，改用与后端完全一致的“旋转网格 + 绝对定位”算法
  - 修复 `getDisplaySize` 返回类型逻辑，确保预览容器使用精确的像素值，解决偏移问题

### 后端修复
- [x] `plugins/pdf-tools/preload.cjs`
  - 将文本宽度计算从粗略估算改为精确测量 (`widthOfTextAtSize`)，解决居中偏移问题
  - 实现旋转几何校正算法：将 pdf-lib 默认的左下角旋转锚点转换为中心旋转，确保水印在旋转后依然准确居中
  - 重构平铺（Tile）算法：采用“旋转网格”逻辑，以页面中心为原点生成旋转后的坐标系，确保与前端预览视觉一致
  - 修复参数类型转换问题，防止 `NaN` 错误

---

# PDF 图片提取 UI 重构

> **更新时间**: 2026-01-20
> **状态**: ✅ 已完成

## 完成内容

### UI 重构
- [x] 重构 `plugins/pdf-tools/src/ui/pages/ExtractImages.tsx`
  - 弃用旧版单文件预览模式，支持**批量文件处理**
  - 采用与 `MergePDF` 一致的文件列表视图，提升交互体验的一致性
  - 使用 `SharedPDFComponents` (`PDFHeader`, `PDFUploadArea`) 保持设计规范
  - 实现每个文件的页码异步加载与预览缩略图显示

### 功能增强
- [x] 批量处理逻辑
  - 支持多文件选择 (`multiSelections`)
  - 顺序执行图片提取任务，避免并发过高
  - 优化结果通知，统计成功处理的文件数量
  - 修复图片提取逻辑：增加全局去重，解决由页面资源复用导致的重复提取问题 (8页提取64张 -> 8页提取8张)
  - 修复预览白屏问题：增强 `getPDFImagePreview`，支持 FlateDecode 编码的 PNG 图片预览提取

---

# PDF 转图片 UI 重构

> **更新时间**: 2026-01-20
> **状态**: ✅ 已完成

## 完成内容

### UI 重构
- [x] 重构 `plugins/pdf-tools/src/ui/pages/PDFToImage.tsx`
  - 接入 `SharedPDFComponents`，保持设计一致性
  - 支持**多文件上传**与批量转换
  - 对齐 `ExtractImages` 的列表式 UI 设计，提供更清晰的文件管理体验
  - 优化导出逻辑：导出时根据原 PDF 文件名自动创建独立文件夹 (`{filename}_pages`)，避免文件混淆

### 逻辑修复
- [x] 修正 PDF 转换与提取的概念混淆
  - 核心问题：原 `pdfToImage` 方法在存在后端 API 时错误地优先调用了 `extractPDFImages`，导致“转图片”功能变成了“提取图片”。
  - 重构 `PDFService`：拆分为 `convertPDFToImages` (渲染页面) 和 `extractImages` (提取资源) 两个独立方法。
  - `PDFToImage` 页面现明确调用渲染逻辑，确保将每一页完整转换为图片。
  - `ExtractImages` 页面现明确调用提取逻辑，仅获取内嵌资源。

### 渲染修复
- [x] 修复水印和标注不显示的问题
  - 原因：`pdfjs-dist` 默认渲染模式可能未开启注解层 (Annotation Layer) 或忽略了某些可选内容组。
  - 修复：在 `convertPDFToImages` 中显式设置 `annotationMode: 1` (ENABLE) 并添加错误捕获，确保水印、图章等覆盖层元素能正确渲染到输出图片中。
- [x] 修复 `Found invalid object in transferList` 错误
  - 原因：`pdfjs-dist` v5.x 在 Electron 环境下处理 `ImageBitmap` 传输时存在兼容性问题，导致部分图像无法解码。
  - 修复：降级 `pdfjs-dist` 至稳定版本 `4.4.168`，从根本上解决传输列表对象无效问题，恢复图片 PDF 的正常渲染。

---

# 搜索框多行输入修复

> **更新时间**: 2026-01-20
> **状态**: ✅ 已完成

## 修复内容

### 搜索框 (SearchInput)
- [x] `src/renderer/components/SearchInput.tsx`
  - 将 `<input>` 替换为 `<textarea>`，以支持多行文本输入（如粘贴 YAML/JSON 配置）
  - 维持单行外观 (`rows={1}`)，但允许存储和传递包含换行符的原始文本
  - 拦截 `Enter` 键：
    - `Enter` (无 Shift): 阻止默认换行，维持“输入框”体验
    - `Shift + Enter`: 允许输入换行符
- [x] `src/renderer/styles/index.css`
  - 为 `.search-input` 添加 `textarea` 专属样式 (`resize: none`, `white-space: pre-wrap`)
  - 确保垂直对齐和高度与原输入框一致

### 解决问题
- 修复了用户在宿主搜索框粘贴多行内容（如 YAML）后，插件接收到的文本被展平为单行的问题。

---

# AI 插件生成增强

> **更新时间**: 2026-01-20
> **状态**: ✅ 已完成

## 完成内容

### 核心模块
- [x] **Scaffold-First Workflow** (`src/commands/create/ai-create.ts`)
  - 重构生成流程为"先脚手架，后 AI"模式
  - 在 AI 介入前确定性生成核心文件 (`package.json`, `manifest.json`, `src/ui/App.tsx` 等)
  - 显著降低 AI 生成错误 boilerplate 的概率

### 交互体验增强
- [x] **交互式完成 (Interactive Finish)** (`src/services/ai-generator.ts`)
  - AI 任务完成后不强制退出，用户可选择 "Exit" 或 "Continue"
  - 支持在当前上下文中继续追加修改需求
- [x] **智能会话恢复 (Smart Resume)** (`src/commands/create/ai-create.ts`)
  - `intools create --ai --resume` 自动识别并激活 `completed` 状态的会话
  - 自动重置状态并引导用户输入新指令，实现无缝断点续传

### 可视化与监控
- [x] **思考过程可视化** (`src/services/ai/providers/openai.ts`)
  - 支持展示 DeepSeek R1 等模型的 `reasoning_content` (通过 `<think>` 标签)
- [x] **性能监控** (`src/services/ai-generator.ts`)
  - 实时显示每轮对话的思考耗时与 Token 使用量 (e.g., `Thinking... (Turn 1) - 2.5s, 150 tokens`)

---

# AI CLI 体验优化

> **更新时间**: 2026-01-20
> **状态**: ✅ 已完成

## 完成内容

### 交互与上下文
- [x] **Slash Commands** (`src/services/ai-generator.ts`)
  - 支持 `/exit`, `/clear`, `/tokens`, `/compress`, `/help` 命令
  - 清晰的 `›` 命令行提示符，优化输入体验
- [x] **上下文自动压缩** (`src/services/ai/context-manager.ts`)
  - 实现 Token 估算与历史记录摘要压缩
  - 恢复会话时自动检测并压缩超长上下文
  - **[Fix]** 修复了压缩时切断 Tool Call 链导致 400 错误 ("role 'tool' must be a response to a preceding message") 的问题

### 上下文优化
- [x] **Smart Pruning (Read-and-Forget)** (`src/services/ai/context-manager.ts`)
  - 实现了基于混合记忆架构的 "Smart Pruning" 策略
  - 自动检测并剪枝历史记录中的大段 Tool 输出（>1000 字符），仅保留占位符
  - 显著降低 Token 消耗，同时保留最近会话的完整细节 (Tail Memory)
- [x] **Dynamic File Map (Hybrid Memory Head)** (`src/services/ai/prompts.ts`, `ai-generator.ts`)
  - 实现了动态文件树注入机制
  - **Head 更新**: 每次对话前自动扫描项目目录，生成最新文件树并注入 System Prompt
  - 消除 AI 对文件结构的幻觉，确保始终知晓新建文件的位置

### 脚手架统一
- [x] **Unified Scaffolding** (`src/commands/create/ai-create.ts`)
  - AI 创建流程复用标准 `createReactProject` 逻辑，确保文件结构一致性
  - 移除冗余的模板生成代码

### Prompt 优化
- [x] **No UI Tests** (`src/services/ai/prompts.ts`)
  - 明确禁止 AI 生成依赖浏览器的 UI 测试文件
  - 引导 AI 专注于逻辑单元测试与手动验证
```

---

# AI 文档与提示词整合

> **更新时间**: 2026-01-20
> **状态**: ✅ 已完成

## 完成内容

- [x] **文档合并与优化** (`packages/intools-cli/src/services/ai/`)
  - 将 `PLUGIN_API.md` 的完整 API 规范合并入 `PLUGIN_DEVELOP_PROMPT.md`
  - 移除了冗余的 `PLUGIN_API.md` 文件（AI 服务专用副本）
  - 优化了提示词结构：Role -> Workflow -> Detailed API Reference
- [x] **代码引用更新**
  - 更新 `knowledge.ts` 以移除对旧 API 文件的读取
  - 更新 `prompts.ts` 以适配新的单一上下文源
  - 确保合并后的提示词能提供完整的 Manifest 规范和 API 参考，提升 AI 生成准确性
