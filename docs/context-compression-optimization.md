# AI 上下文压缩优化方案

## 概述

本文档描述了 `packages/intools-cli` 中 AI 开发插件上下文压缩算法的优化方案。目标是提升上下文管理的效率、降低 token 成本、提高压缩质量。

## 当前实现分析

### 核心文件
- **压缩实现**：`packages/intools-cli/src/services/ai/context-manager.ts`
- **压缩集成**：`packages/intools-cli/src/services/ai-generator.ts`

### 当前策略
1. **Token 估算**：4 字符 ≈ 1 token（启发式规则）
2. **压缩策略**：保留系统提示 + 最后 6 条消息 + AI 摘要中间部分
3. **触发条件**：
   - 自动压缩：> 10,000 tokens
   - 错误恢复：JSON 解析错误
   - 手动触发：`/compress` 命令
4. **工具输出处理**：超过 1000 字符替换为占位符

### 存在的问题
1. Token 估算不精确（对中文误差大）
2. 固定保留 6 条消息不够灵活
3. 工具输出处理过于简单（一刀切）
4. 缺少语义重要性评分
5. 未利用 Claude 的 Prompt Caching
6. 压缩时机不够智能
7. 摘要质量无法保证
8. 缺少增量压缩机制

---

## 优化方案

### 优先级 1：高优先级（立即见效）

#### 1.1 集成 tiktoken 进行精确 Token 计算

**问题**：
```typescript
CHARS_PER_TOKEN = 4  // 对中文文本误差很大
```

**解决方案**：
- 集成 `js-tiktoken` 库
- 针对不同模型使用对应的编码器
- 考虑工具调用的 JSON 结构 token 开销

**实现**：
```typescript
import { encodingForModel } from 'js-tiktoken';

export class ContextManager {
    private static encoder = encodingForModel('gpt-4');

    public static estimateTokenCount(messages: AIMessage[]): number {
        const text = JSON.stringify(messages);
        return this.encoder.encode(text).length;
    }
}
```

**预期效果**：
- Token 估算误差从 ±30% 降低到 ±5%
- 更准确的压缩时机判断
- 避免因估算不准导致的 API 错误

---

#### 1.2 改进工具输出处理策略

**问题**：
```typescript
if (msg.content.length > 1000) {
    return '[Tool output pruned...]'  // 丢失所有信息
}
```

**解决方案**：
- 分类处理不同类型的工具输出
- 智能截断保留结构完整性
- 提取关键信息（文件路径、错误类型等）

**实现**：
```typescript
private static pruneToolOutput(msg: AIMessage): AIMessage {
    if (msg.role !== 'tool' || !msg.content) return msg;

    const content = msg.content;
    const length = content.length;

    // 短内容直接保留
    if (length <= 1000) return msg;

    // 错误信息完整保留
    if (content.includes('Error:') || content.includes('错误')) {
        return msg;
    }

    // 文件读取：保留前后各 200 字符 + 中间摘要
    if (msg.tool_call_id?.includes('read')) {
        const head = content.slice(0, 200);
        const tail = content.slice(-200);
        return {
            ...msg,
            content: `${head}\n\n[... ${length - 400} chars omitted ...]\n\n${tail}`
        };
    }

    // 搜索结果：保留匹配行
    if (msg.tool_call_id?.includes('search') || msg.tool_call_id?.includes('grep')) {
        const lines = content.split('\n');
        const matchLines = lines.filter(line =>
            line.includes(':') || line.includes('match')
        ).slice(0, 20);
        return {
            ...msg,
            content: matchLines.join('\n') + `\n[Total: ${lines.length} lines]`
        };
    }

    // 默认：保留前 500 字符
    return {
        ...msg,
        content: `${content.slice(0, 500)}\n[Tool output truncated: ${length} chars total]`
    };
}
```

**预期效果**：
- 保留关键信息，避免丢失重要上下文
- 减少因信息丢失导致的重复工具调用
- 提升 AI 理解历史操作的能力

---

#### 1.3 实现动态保留策略（基于 Token 预算）

**问题**：
```typescript
keepLastN = 6  // 固定保留 6 条，可能不够或浪费
```

**解决方案**：
- 基于 token 预算动态保留消息
- 确保不在工具调用链中间切断
- 保留完整的对话轮次

**实现**：
```typescript
public static async compressHistory(
    messages: AIMessage[],
    targetTokens: number = 8000,  // 目标压缩到 8k tokens
    summarizer: (text: string) => Promise<string>
): Promise<AIMessage[]> {
    const totalTokens = this.estimateTokenCount(messages);

    // 不需要压缩
    if (totalTokens <= targetTokens) {
        return messages;
    }

    const systemMsg = messages[0];
    let kept: AIMessage[] = [];
    let currentTokens = 0;

    // 从后往前保留，直到达到预算的 70%（留 30% 给摘要）
    const keepBudget = targetTokens * 0.7;

    for (let i = messages.length - 1; i > 0; i--) {
        const msg = messages[i];
        const msgTokens = this.estimateTokenCount([msg]);

        if (currentTokens + msgTokens < keepBudget) {
            kept.unshift(msg);
            currentTokens += msgTokens;
        } else {
            break;
        }
    }

    // 确保不在工具调用链中间切断
    kept = this.ensureCompleteToolChains(kept);

    // 压缩剩余部分
    const toCompress = messages.slice(1, messages.length - kept.length);
    if (toCompress.length === 0) {
        return [systemMsg, ...kept];
    }

    // 修剪工具输出
    const prunedToCompress = toCompress.map(msg => this.pruneToolOutput(msg));

    // 生成摘要
    const summaryText = this.messagesToText(prunedToCompress);
    const summary = await summarizer(summaryText);

    const summaryMsg: AIMessage = {
        role: 'user',
        content: `[Previous Context Summary]\n${summary}`
    };

    return [systemMsg, summaryMsg, ...kept];
}

private static ensureCompleteToolChains(messages: AIMessage[]): AIMessage[] {
    // 如果第一条消息是 tool 响应，需要包含对应的 assistant 调用
    while (messages.length > 0 && messages[0].role === 'tool') {
        messages.shift();
    }

    // 如果最后一条消息是 assistant 的工具调用，需要等待 tool 响应
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg.tool_calls?.length) {
        messages.pop();
    }

    return messages;
}
```

**预期效果**：
- 根据实际 token 使用动态调整保留数量
- 避免切断工具调用链导致的上下文不完整
- 更高效地利用 token 预算

---

#### 1.4 添加 Prompt Caching 支持

**问题**：每次请求都重新发送完整历史，浪费 token

**解决方案**：
- 利用 Claude 的 Prompt Caching 功能
- 标记摘要部分为可缓存
- 可节省 90% 的 token 成本（缓存命中时）

**实现**：

1. 更新 AIMessage 类型定义：
```typescript
// packages/intools-cli/src/types/ai.ts
export interface AIMessageContent {
    type: 'text' | 'image';
    text?: string;
    source?: {
        type: 'base64';
        media_type: string;
        data: string;
    };
    cache_control?: {
        type: 'ephemeral';
    };
}

export interface AIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | AIMessageContent[];
    // ... 其他字段
}
```

2. 在压缩时添加缓存标记：
```typescript
public static async compressHistory(
    messages: AIMessage[],
    targetTokens: number = 8000,
    summarizer: (text: string) => Promise<string>
): Promise<AIMessage[]> {
    // ... 压缩逻辑

    const summaryMsg: AIMessage = {
        role: 'user',
        content: [
            {
                type: 'text',
                text: `[Previous Context Summary]\n${summary}`,
                cache_control: { type: 'ephemeral' }  // 标记为可缓存
            }
        ]
    };

    return [systemMsg, summaryMsg, ...kept];
}
```

3. 更新 Claude Provider 支持缓存：
```typescript
// packages/intools-cli/src/services/ai/providers/claude.ts
public async chat(
    messages: AIMessage[],
    options?: ChatOptions
): Promise<AIResponse> {
    const anthropicMessages = messages.map(msg => {
        if (typeof msg.content === 'string') {
            return { role: msg.role, content: msg.content };
        }
        // 支持 content 数组格式（包含 cache_control）
        return { role: msg.role, content: msg.content };
    });

    const response = await this.client.messages.create({
        model: this.model,
        messages: anthropicMessages,
        // ... 其他参数
    });

    return this.parseResponse(response);
}
```

**预期效果**：
- 缓存命中时节省 90% 的输入 token 成本
- 减少 API 延迟（缓存内容不需要重新处理）
- 特别适合长时间开发会话

---

### 优先级 2：中优先级（显著改善）

#### 2.1 实现结构化摘要

**问题**：直接用 AI 生成摘要，格式不统一，难以验证

**解决方案**：
- 使用结构化提示生成 JSON 格式摘要
- 包含关键决策、当前状态、涉及文件等
- 更容易验证和使用

**实现**：
```typescript
private async compressContext() {
    const summarizer = async (text: string) => {
        const prompt = `Please summarize the following technical conversation history into a structured JSON format:

{
    "objective": "用户的核心目标（1-2 句话）",
    "key_decisions": ["关键决策1", "关键决策2"],
    "current_state": "当前进度和状态",
    "files_modified": ["涉及的文件路径"],
    "errors_resolved": ["已解决的错误"],
    "pending_tasks": ["待完成的任务"]
}

Conversation history:
${text}

Return ONLY the JSON object, no additional text.`;

        const result = await this.aiService.chat([
            { role: 'system', content: 'You are a helpful assistant that generates structured summaries.' },
            { role: 'user', content: prompt }
        ], { toolChoice: 'none' });

        try {
            const summary = JSON.parse(result.content || '{}');
            return this.formatStructuredSummary(summary);
        } catch (e) {
            // 降级到普通摘要
            return result.content || 'No summary generated.';
        }
    };

    this.session.conversationHistory = await ContextManager.compressHistory(
        this.session.conversationHistory,
        8000,  // 目标 8k tokens
        summarizer
    );

    this.sessionManager.saveSession(this.session);
    tui.log(chalk.green('✅ Context compressed.'));
}

private formatStructuredSummary(summary: any): string {
    return `
## 对话摘要

**目标**: ${summary.objective || 'N/A'}

**关键决策**:
${summary.key_decisions?.map((d: string) => `- ${d}`).join('\n') || '- 无'}

**当前状态**: ${summary.current_state || 'N/A'}

**修改的文件**:
${summary.files_modified?.map((f: string) => `- ${f}`).join('\n') || '- 无'}

**已解决的错误**:
${summary.errors_resolved?.map((e: string) => `- ${e}`).join('\n') || '- 无'}

**待完成任务**:
${summary.pending_tasks?.map((t: string) => `- ${t}`).join('\n') || '- 无'}
`.trim();
}
```

**预期效果**：
- 摘要格式统一，易于阅读
- 包含关键信息，便于 AI 快速理解历史
- 可以验证摘要质量

---

#### 2.2 添加分级压缩阈值

**问题**：
```typescript
if (count > 10000) {  // 接近限制才压缩
    await this.compressContext();
}
```

**解决方案**：
- 实现分级压缩策略
- 根据 token 使用量采用不同强度的压缩

**实现**：
```typescript
// packages/intools-cli/src/services/ai-generator.ts

private async checkAndCompressContext() {
    const tokens = ContextManager.estimateTokenCount(this.session.conversationHistory);

    // 分级阈值
    const LIGHT_THRESHOLD = 5000;   // 轻度压缩
    const MEDIUM_THRESHOLD = 10000; // 中度压缩
    const HEAVY_THRESHOLD = 15000;  // 重度压缩

    if (tokens < LIGHT_THRESHOLD) {
        return; // 无需压缩
    }

    if (tokens < MEDIUM_THRESHOLD) {
        // 轻度压缩：只修剪工具输出
        tui.log(chalk.yellow(`⚠️ Context at ${tokens} tokens. Applying light compression...`));
        await this.lightCompress();
    } else if (tokens < HEAVY_THRESHOLD) {
        // 中度压缩：摘要部分历史
        tui.log(chalk.yellow(`⚠️ Context at ${tokens} tokens. Applying medium compression...`));
        await this.mediumCompress();
    } else {
        // 重度压缩：只保留最近 3 轮
        tui.log(chalk.red(`⚠️ Context at ${tokens} tokens. Applying heavy compression...`));
        await this.heavyCompress();
    }
}

private async lightCompress() {
    // 只修剪工具输出，不生成摘要
    this.session.conversationHistory = this.session.conversationHistory.map(msg =>
        ContextManager.pruneToolOutput(msg)
    );
    this.sessionManager.saveSession(this.session);
    tui.log(chalk.green('✅ Light compression applied.'));
}

private async mediumCompress() {
    // 标准压缩：目标 8k tokens
    await this.compressContext(8000);
}

private async heavyCompress() {
    // 重度压缩：目标 5k tokens
    await this.compressContext(5000);
}

private async compressContext(targetTokens: number = 8000) {
    const summarizer = async (text: string) => {
        // ... 摘要逻辑
    };

    this.session.conversationHistory = await ContextManager.compressHistory(
        this.session.conversationHistory,
        targetTokens,
        summarizer
    );

    this.sessionManager.saveSession(this.session);
    tui.log(chalk.green(`✅ Context compressed to ~${targetTokens} tokens.`));
}
```

**预期效果**：
- 避免压缩抖动（压缩后立即又需要压缩）
- 根据紧急程度采用不同策略
- 更平滑的 token 使用曲线

---

### 优先级 3：低优先级（锦上添花）

#### 3.1 语义重要性评分

**目标**：保留重要消息而不是简单的最后 N 条

**实现思路**：
```typescript
private static scoreMessage(msg: AIMessage): number {
    let score = 0;
    const content = typeof msg.content === 'string' ? msg.content : '';

    // 用户需求更重要
    if (msg.role === 'user') score += 5;

    // 错误信息很重要
    if (content.includes('error') || content.includes('错误') || content.includes('Error')) {
        score += 10;
    }

    // 工具调用决策重要
    if (msg.tool_calls?.length) score += 3;

    // 关键操作
    const keywords = ['创建', '删除', '修改', '部署', 'create', 'delete', 'modify', 'deploy'];
    if (keywords.some(kw => content.includes(kw))) {
        score += 5;
    }

    // 文件路径信息
    if (content.match(/\.(ts|js|tsx|jsx|py|java|go)/)) {
        score += 2;
    }

    return score;
}
```

#### 3.2 增量压缩机制

**目标**：避免重复压缩已压缩的部分

**实现思路**：
```typescript
interface CompressedSegment {
    summary: string;
    originalRange: [number, number];
    compressedAt: number;
    tokenCount: number;
}

// 只压缩新增的消息
```

#### 3.3 用户可配置参数

**目标**：允许用户自定义压缩策略

**实现思路**：
```typescript
// config.json
{
    "contextCompression": {
        "enabled": true,
        "targetTokens": 8000,
        "lightThreshold": 5000,
        "mediumThreshold": 10000,
        "heavyThreshold": 15000,
        "toolOutputLimit": 1000,
        "enablePromptCaching": true
    }
}
```

---

## 实施计划

### 阶段 1：基础优化（第 1-2 天）
1. ✅ 集成 tiktoken 进行精确 token 计算
2. ✅ 改进工具输出处理策略
3. ✅ 实现动态保留策略

### 阶段 2：高级功能（第 3-4 天）
4. ✅ 添加 Prompt Caching 支持
5. ✅ 实现结构化摘要
6. ✅ 添加分级压缩阈值

### 阶段 3：测试与优化（第 5 天）
7. ✅ 全面测试所有功能
8. ✅ 性能测试和调优
9. ✅ 文档更新

---

## 预期效果

### 性能提升
- **Token 估算精度**：从 ±30% 提升到 ±5%
- **Token 成本**：通过 Prompt Caching 降低 70-90%
- **压缩质量**：保留更多关键信息，减少重复工具调用

### 用户体验
- 更长的有效对话轮次
- 更少的上下文丢失问题
- 更智能的压缩时机

### 可维护性
- 结构化摘要便于调试
- 分级压缩策略更灵活
- 代码模块化，易于扩展

---

## 参考资料

- [Claude API - Prompt Caching](https://docs.anthropic.com/claude/docs/prompt-caching)
- [tiktoken - OpenAI's tokenizer](https://github.com/openai/tiktoken)
- [js-tiktoken - JavaScript port](https://github.com/dqbd/tiktoken)
- [Context Window Management Best Practices](https://www.anthropic.com/index/claude-2-1-prompting)

---

## 更新日志

- **2026-01-21**：初始版本，定义优化方案和实施计划
