# Mulby MCP Server

Mulby 可作为 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 服务器运行，将已安装插件的 AI 工具能力暴露给外部 AI 工具。

---

## 支持的客户端

| 客户端 | 传输方式 | 状态 |
|:--|:--|:--|
| Claude Desktop | Streamable HTTP / stdio | ✅ |
| Cursor | Streamable HTTP | ✅ |
| Windsurf | Streamable HTTP | ✅ |
| Cline (VS Code) | Streamable HTTP | ✅ |
| 任何 MCP 兼容工具 | Streamable HTTP | ✅ |

---

## 快速开始

### 1. 开启 MCP Server

在 **设置 → AI 工具 → MCP Server** 中：

1. 打开 **启用 MCP Server** 开关
2. 系统会自动生成认证 Token
3. 记下端口号（默认 `18790`）和 Token

### 2. 配置客户端

#### Claude Desktop

编辑 `claude_desktop_config.json`：

**方式一：Streamable HTTP（推荐）**

```json
{
  "mcpServers": {
    "mulby": {
      "transport": "streamable-http",
      "url": "http://127.0.0.1:18790/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

**方式二：stdio bridge**

```json
{
  "mcpServers": {
    "mulby": {
      "command": "node",
      "args": ["/Applications/Mulby.app/Contents/Resources/mcp-stdio-bridge.cjs"],
      "env": {
        "MULBY_MCP_URL": "http://127.0.0.1:18790/mcp",
        "MULBY_MCP_TOKEN": "<your-token>"
      }
    }
  }
}
```

> 开发模式下，stdio bridge 路径为：
> `<mulby-project>/src/main/ai/mcp-server/stdio-bridge.cjs`

#### Cursor

在 Cursor Settings → MCP 中添加：

```json
{
  "mcpServers": {
    "mulby": {
      "url": "http://127.0.0.1:18790/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

#### Cline (VS Code)

在 Cline MCP 设置中添加 Server，使用 Streamable HTTP 连接：

- **URL**: `http://127.0.0.1:18790/mcp`
- **Headers**: `Authorization: Bearer <your-token>`

---

## 暴露的工具

MCP Server 会自动暴露所有已安装、已启用插件注册的 AI 工具。

### 工具命名格式

```
mulby__{pluginId}__{toolName}
```

例如，插件 `qrcode-helper` 注册了 `generate_qrcode` 工具，外部 AI 看到的工具名为：

```
mulby__qrcode_helper__generate_qrcode
```

### 动态更新

当插件安装/卸载/启用/禁用时，MCP Server 会自动更新暴露的工具列表。支持 MCP 的 `tools/list_changed` 通知，客户端会自动感知变化。

---

## 安全策略

| 安全措施 | 说明 |
|:--|:--|
| **默认关闭** | MCP Server 默认不启动，需手动开启 |
| **仅本机访问** | HTTP Server 监听 `127.0.0.1`，仅允许本机连接 |
| **Token 认证** | 强制 Bearer Token 认证，防止未授权访问 |
| **工具禁用联动** | AI 工具设置中禁用的插件工具同样不会暴露给 MCP |
| **插件沙盒** | 工具执行仍在 Mulby 插件沙盒内，遵循现有权限体系 |

> ⚠️ Token 泄露风险：请妥善保管 Bearer Token，不要将其提交到版本控制系统。

---

## 端点说明

| 端点 | 方法 | 说明 |
|:--|:--|:--|
| `/mcp` | POST | MCP Streamable HTTP 端点（JSON-RPC） |
| `/health` | GET | 健康检查（无需认证） |

### 健康检查

```bash
curl http://127.0.0.1:18790/health
# {"status":"ok","service":"mulby-mcp-server"}
```

### 手动调用（调试用）

```bash
# 列出可用工具
curl -X POST http://127.0.0.1:18790/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## 与 OpenClaw 的关系

| | MCP Server | OpenClaw Node |
|:--|:--|:--|
| **协议** | MCP (JSON-RPC over HTTP) | OpenClaw WebSocket v3 |
| **面向场景** | 本机 AI 工具（Claude Desktop、Cursor） | 远程 AI Agent（OpenClaw Gateway） |
| **暴露内容** | 插件 AI Tools | 系统命令 + 搜索 + 插件 |
| **认证方式** | Bearer Token | Ed25519 签名 + 设备配对 |
| **传输安全** | 仅本机（127.0.0.1） | TLS 可选 |

两者互补，共享底层的插件工具注册表（`PluginToolRegistry`）。

---

## 常见问题

### MCP Server 启动失败

- **端口被占用**：检查 `18790` 端口是否被其他程序占用，可在设置中修改端口
- **权限问题**：确保 Mulby 有权限监听网络端口

### 客户端连接不上

1. 确认 MCP Server 已启动（设置页面显示「运行中」）
2. 确认 Token 正确（注意前后空格）
3. 确认使用 `127.0.0.1` 而非 `localhost`
4. 尝试健康检查：`curl http://127.0.0.1:18790/health`

### 看不到插件工具

1. 确认有已安装且已启用的插件
2. 确认插件在 `manifest.json` 中声明了 `tools`
3. 确认插件后端已注册 tool handler（`api.tools.register`）
4. 确认该工具未在 AI 设置中被禁用

---

## 架构参考

```
外部 AI 工具 (Claude Desktop / Cursor / Cline / ...)
        │
        │ MCP Protocol (Streamable HTTP)
        ▼
  ┌──────────────────────────────┐
  │   Mulby MCP Server           │
  │   (http://127.0.0.1:18790)   │
  ├──────────────────────────────┤
  │ Bearer Token 认证             │
  │ PluginToolRegistry → Tools   │
  │ PluginManager → 执行调度      │
  └──────────────────────────────┘
```
