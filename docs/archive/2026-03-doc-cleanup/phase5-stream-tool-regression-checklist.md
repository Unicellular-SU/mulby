# Phase 5 流式与工具调用回归清单

## 自动化回归

```bash
bash scripts/phase5-regression.sh
```

该脚本会执行：
- `npm run typecheck`
- `npm run test:unit`
- 输出手工验收步骤

## 手工验收

### 1) 多步工具调用（Multi-step tool）

- 页面：`plugins/ai-api-test`。
- 选择支持推理与工具调用的模型（建议 DeepSeek reasoner）。
- 点击“流式工具调用”。

预期：
- 流式面板能按顺序看到：
  - `[调用工具] sumNumbers`
  - `[工具结果] sumNumbers`
  - `[调用工具] getSystemInfo`
  - `[工具结果] getSystemInfo`
- 最终答案文本在结束前后正确显示一次，不重复拼接。

### 2) 思考与正文交错（Reasoning + Text Interleaving）

- 使用普通流式对话，提示模型先思考再回答。

预期：
- 思考区域与正文区域都应实时追加。
- 结束后不会出现“先空白、最后一次性补全文”的退化表现。

### 3) 异常中断（Error Interruption）

- 临时把 API Key 改为错误值后发起流式请求。

预期：
- UI 出现错误提示（`[错误] ...` 或通知）。
- 错误后不再追加后续 chunk。

### 4) 用户中止（Abort）

- 发起流式请求后立即点击“停止流式输出”。

预期：
- 流式快速停止。
- 停止后不再接收新的文本/工具事件。

## 关注日志（主进程）

- `capability:protocol`：确认能力门控来源（`profile/config/model`）。
- `stream part` / `tool-call detected` / `tool-result detected`：确认事件顺序。
- 错误场景检查是否出现统一 `chunkType=error` 对应的错误消息。

