# 编码小助手插件总结

## 项目概述
编码小助手 (encode_helper) 是一个功能全面的编码转换工具插件，集成了8大常用编码转换功能，为开发者和日常用户提供便捷的编码处理工具。

## 核心功能

### 1. 时间转换 (⏰)
- 时间戳 ↔ 日期时间相互转换
- 支持秒级和毫秒级时间戳
- 自动识别输入格式

### 2. Base64编解码 (🔢)
- Base64编码与解码
- 自动检测编码/解码方向
- 支持中文字符处理

### 3. URL编解码 (🔗)
- URL编码与解码
- 自动检测编码/解码方向
- 处理特殊字符和中文

### 4. 哈希加密 (🔐)
- 支持多种哈希算法：MD5、SHA1、SHA256、SHA512
- 使用Web Crypto API实现
- 实时计算哈希值

### 5. Unicode转换 (🔤)
- Unicode编码与解码
- 支持\uXXXX格式
- 自动检测编码/解码方向

### 6. UUID生成 (🆔)
- 生成标准UUID v4
- 一键生成并复制
- 符合RFC 4122标准

### 7. 进制转换 (🔢)
- 二进制、八进制、十进制、十六进制相互转换
- 灵活选择源进制和目标进制
- 自动识别输入格式

### 8. HTML转义 (📄)
- HTML实体编码与解码
- 支持所有HTML实体
- 自动检测编码/解码方向

## 技术特点

### 智能识别
- 自动检测输入内容类型
- 智能选择编码或解码方向
- 实时转换和反馈

### 用户体验
- 直观的标签页界面
- 一键复制结果
- 支持亮色/暗色主题
- 响应式设计

### 性能优化
- 使用React构建高效UI
- 异步哈希计算
- 内存友好的处理方式

## 文件结构
```
encode_helper/
├── dist/main.js                    # 构建后的主程序
├── ui/                            # 构建后的UI文件
├── src/                           # 源代码
│   ├── main.ts                    # 插件主逻辑
│   └── ui/                        # 用户界面
│       ├── App.tsx                # 主组件
│       ├── styles.css             # 样式文件
│       ├── main.tsx               # UI入口
│       └── hooks/useMulby.ts    # Mulby API封装
├── manifest.json                  # 插件清单
├── plugin.json                    # 插件配置
├── package.json                   # 项目配置
├── README.md                      # 使用说明
├── INSTALL.md                     # 安装指南
└── SUMMARY.md                     # 项目总结
```

## 使用方法

### 关键词触发
在Mulby主界面输入功能关键词即可触发对应功能：
- `时间转换` / `timestamp`
- `base64` / `base64编码` / `base64解码`
- `url编码` / `url解码`
- `哈希` / `md5` / `sha1` / `sha256`
- `unicode` / `unicode编码` / `unicode解码`
- `uuid` / `生成uuid`
- `进制转换` / `二进制` / `十六进制`
- `html转义` / `html编码` / `html解码`

### 界面操作
1. 通过顶部标签页切换功能
2. 在输入框输入内容
3. 点击"转换"按钮
4. 结果自动复制到剪贴板

## 开发说明

### 技术栈
- **前端**: React 18 + TypeScript
- **构建工具**: Vite + esbuild
- **样式**: CSS变量 + 响应式设计
- **API**: Mulby插件API

### 构建命令
```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建插件
npm run build

# 打包插件
npm run pack
```

### 扩展功能
如需添加新功能：
1. 在`src/main.ts`中注册新功能
2. 在`src/ui/App.tsx`中添加处理逻辑
3. 更新UI界面和样式
4. 更新配置文件

## 兼容性
- **Mulby版本**: 最新版本
- **操作系统**: Windows 10+, macOS 10.15+, Linux
- **浏览器**: 现代浏览器（Chrome 90+, Firefox 88+, Safari 14+）

## 许可证
MIT License - 可自由使用、修改和分发

## 贡献指南
欢迎提交Issue和Pull Request来改进插件功能。