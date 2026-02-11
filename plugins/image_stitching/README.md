# 长图拼接插件 (image_stitching)

一个功能强大的图片拼接插件，可以将多张图片任意纵向裁切后拼接成一张长图。

## 功能特性

- 🖼️ **多图片支持**：支持同时处理多张图片
- ✂️ **精确裁切**：每张图片可独立设置顶部和底部裁切比例
- 🔄 **灵活排序**：可调整图片的拼接顺序
- ⚙️ **自定义设置**：可设置输出宽度、图片间距和背景颜色
- 📋 **便捷导出**：支持复制到剪贴板和下载图片
- 🎨 **主题适配**：支持亮色和暗色主题

## 支持的图片格式

- PNG
- JPEG/JPG
- GIF
- WebP
- BMP

## 触发方式

- `图片拼接` - 打开图片拼接界面
- `image stitch` - Open image stitching interface
- 直接拖放图片文件到插件

## 开发

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 打包

```bash
npm run pack
```

## 项目结构

```
image_stitching/
├── manifest.json              # 插件配置
├── package.json
├── src/
│   ├── main.ts                # 后端入口
│   ├── ui/
│   │   ├── App.tsx            # 主应用
│   │   ├── main.tsx           # UI 入口
│   │   ├── index.html         # HTML 模板
│   │   ├── styles.css         # 全局样式
│   │   ├── hooks/
│   │   │   └── useMulby.ts  # Mulby API Hook
│   │   └── types/
│   │       └── mulby.d.ts   # 类型定义
├── dist/                      # 后端构建输出
├── ui/                        # UI 构建输出
└── icon.png                   # 插件图标
```

## 许可证

MIT License
