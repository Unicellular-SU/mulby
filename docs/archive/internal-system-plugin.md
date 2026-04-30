# 内置系统插件（Internal System Plugin）

## 设计概述

Mulby 引入了「无代码虚拟系统插件」机制，灵感来自 ZTools 的 `internal-plugins/system` 设计。

### 核心理念

- **系统命令以标准插件 feature 的方式出现在搜索结果中**，和普通插件共享同一 UI 和搜索体验
- **无需编写插件代码**（无 main.js/ts），仅需 `manifest.json` + 图标资源
- **执行时由主进程内建函数直接处理**，跳过 Host/Worker 进程创建，零延迟

### 目录结构

```
internal-plugins/
└── system/
    ├── manifest.json          ← 清单：定义 features、cmds、icons
    ├── icon.png               ← 插件主图标
    └── icons/
        ├── lock-screen.png    ← 各命令图标
        ├── sleep.png
        ├── reboot.png
        └── ...
```

### 执行流程

```
用户输入 → 搜索匹配插件 features → PluginManager.run()
                                         ↓
                              isSystemPlugin(id)?
                              ├── Yes → SystemCommandExecutor.execute()
                              └── No  → 正常 Host/Worker 插件流程
```

### 关键文件

| 文件 | 说明 |
|------|------|
| `src/main/plugin/internal-plugins.ts` | 内置插件管理（名称常量、路径解析、环境适配） |
| `src/main/plugin/system-command-executor.ts` | 系统命令执行器（20 个命令的分发和执行） |
| `internal-plugins/system/manifest.json` | 系统插件清单 |

### 添加新的系统命令

1. 在 `manifest.json` 的 `features` 数组中添加新 feature
2. 在 `system-command-executor.ts` 的 `execute()` 方法中添加对应的 `case`
3. 准备图标资源放入 `internal-plugins/system/icons/`

### 打包说明

`package.json` 的 `build.extraResources` 已配置将 `internal-plugins/` 打包到应用资源中，
生产环境通过 `process.resourcesPath/internal-plugins/system` 访问。
