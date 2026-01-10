# 进展文档

## 2026-01-11: 创建 intools-cli README 文档

### 完成内容

创建了完整的 `/packages/intools-cli/README.md` 文档，结合以下参考文档：
- `docs/api-reference.md` - API 接口参考
- `docs/manifest-v2.md` - Manifest 规范
- `docs/plugin-spec.md` - 插件开发规范
- `docs/plugin-packaging.md` - 打包说明

### README 包含章节

1. **安装** - 全局安装和项目依赖安装方式
2. **快速开始** - 5 分钟创建第一个插件的步骤
3. **命令参考**
   - `intools create <name>` - 创建插件项目
   - `intools dev` - 开发模式
   - `intools build` - 构建插件
   - `intools pack` - 打包发布
4. **插件开发指南**
   - 项目结构（React 和 Basic 模板）
   - manifest.json 配置详解
   - features 和 cmds 配置
   - 图标配置
   - 开发模式使用
   - 第三方库使用方法
5. **插件 API**
   - 剪贴板 API
   - 通知 API
   - 存储 API
   - 网络 API
   - 窗口 API
   - 文件系统 API
6. **插件 UI**
   - UI 中访问 API
   - 主题适配
7. **生命周期钩子** - onLoad/onUnload/onEnable/onDisable
8. **构建与打包** - 构建流程和打包格式说明
9. **完整示例**
   - JSON 格式化插件（无 UI）
   - 翻译插件（带 UI）
10. **常见问题** - FAQ
11. **相关文档** - 链接到其他参考文档
