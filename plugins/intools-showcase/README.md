# InTools Showcase

**综合展示 InTools 所有 API 能力的示例插件**

![InTools Showcase](./icon.png)

## 功能特性

这个插件是 InTools 平台的完整功能展示，涵盖了所有 20+ 个 API 模块：

| 模块 | 涵盖的 API | 功能描述 |
|------|-----------|---------|
| 📊 **系统信息** | system, power, geolocation, network | 系统/应用信息、电源状态、位置信息、网络状态 |
| 📋 **剪贴板** | clipboard, notification | 剪贴板读写、格式检测、图片和文件支持 |
| 📁 **文件管理** | filesystem, dialog, shell | 文件操作、对话框、系统打开、Finder 定位 |
| 🌐 **网络与HTTP** | http, network | HTTP 请求测试、网络状态监控 |
| 🖥️ **屏幕与捕获** | screen, media | 显示器信息、截图、权限管理 |
| 🔊 **媒体与音频** | tts, shell | 语音合成、系统提示音 |
| ⚙️ **高级设置** | theme, window, shortcut, tray, menu | 主题切换、窗口控制、快捷键、托盘、菜单 |
| 🔐 **安全与存储** | security, storage | 加密存储、数据持久化 |

## 触发方式

插件支持多种触发关键词：

- `showcase` / `demo` / `示例` - 打开功能展示面板
- `sysinfo` / `系统信息` - 直接进入系统信息模块
- `cb` / `剪贴板` - 直接进入剪贴板管理
- `files` / `文件` - 直接进入文件管理
- `http` / `网络` - 直接进入网络测试
- `screenshot` / `截图` / `screen` - 直接进入截图功能
- `tts` / `语音` / `朗读` - 直接进入语音合成
- `settings` / `设置` - 直接进入高级设置

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
intools-showcase/
├── manifest.json              # 插件配置
├── package.json
├── src/
│   ├── main.ts                # 后端入口
│   └── ui/
│       ├── App.tsx            # 主应用
│       ├── styles.css         # 全局样式
│       ├── components/        # 通用组件
│       │   ├── Sidebar.tsx
│       │   ├── PageHeader.tsx
│       │   ├── Card.tsx
│       │   ├── Button.tsx
│       │   ├── StatusBadge.tsx
│       │   └── CodeBlock.tsx
│       ├── hooks/             # 自定义 Hooks
│       │   ├── useTheme.ts
│       │   ├── useNotification.ts
│       │   └── useIntools.ts
│       └── modules/           # 功能模块
│           ├── SystemInfo/
│           ├── Clipboard/
│           ├── FileManager/
│           ├── Network/
│           ├── Screen/
│           ├── Media/
│           ├── Settings/
│           └── Security/
├── dist/                      # 后端构建输出
└── ui/                        # UI 构建输出
```

## API 覆盖

此插件完整展示了 InTools 的以下 API：

### 基础 API
- ✅ `clipboard` - 剪贴板操作
- ✅ `notification` - 系统通知
- ✅ `storage` - 数据存储
- ✅ `window` - 窗口控制
- ✅ `http` - HTTP 请求
- ✅ `filesystem` - 文件系统

### 系统 API
- ✅ `theme` - 主题管理
- ✅ `screen` - 屏幕信息与截图
- ✅ `shell` - 系统操作
- ✅ `dialog` - 对话框
- ✅ `system` - 系统信息
- ✅ `power` - 电源状态

### 高级 API
- ✅ `shortcut` - 全局快捷键
- ✅ `security` - 加密存储
- ✅ `media` - 媒体权限
- ✅ `tray` - 系统托盘
- ✅ `network` - 网络状态
- ✅ `menu` - 右键菜单
- ✅ `geolocation` - 地理位置
- ✅ `tts` - 语音合成

## 许可证

MIT License
