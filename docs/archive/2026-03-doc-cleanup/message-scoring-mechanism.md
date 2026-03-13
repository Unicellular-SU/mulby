# 上下文压缩消息打分机制设计方案

## 概述

本文档描述了基于业界最佳实践设计的消息打分机制，用于智能化的上下文压缩。该机制通过多维度评分，在压缩时优先保留重要消息，而不是简单地按时间顺序保留。

## 研究背景

基于对最新研究和业界实践的调研，我们发现以下关键洞察：

### 1. 多维度评分策略
- [SimpleMem](https://www.tekta.ai/ai-research-papers/simplemem-llm-agent-memory-2026) 提出三阶段压缩：过滤低价值内容 → 合并相关事实 → 自适应检索深度
- [Semantic Proximity](https://openreview.net/forum?id=lvtiRJ2nwU) 使用语义相似度检测冗余，结合时间新近度
- [Token Retention](https://arxiv.org/abs/2512.03324) 使用衰减分数反映长期效用

### 2. Token 预算分配原则
根据 [Athenic](https://getathenic.com/blog/building-conversational-ai-agents-context-management) 和 [Operion](https://www.operion.io/learn/component/token-budgeting) 的建议：
- **系统提示**: 固定预算（10-15%）
- **工具/RAG 上下文**: 可变预算（30-40%）
- **对话历史**: 动态管理（30-40%）
- **响应空间**: 预留（15-20%）

### 3. 分层记忆架构
[Particula](https://particula.tech/blog/ai-agent-memory-context-management) 提出四层记忆：
- **工作记忆**: 当前对话（context window）
- **会话记忆**: 近期历史（Redis/缓存）
- **情节记忆**: 语义检索（向量数据库）
- **语义记忆**: 长期知识（知识图谱）

### 4. 注意力权重不够用
[Attention Score研究](https://arxiv.org/html/2406.12335v1) 发现：仅用注意力分数不足以判断 token 重要性，需要结合多种信号。

---

## 设计方案：混合评分机制（Hybrid Scoring）

### 核心理念

**"时间新近度 + 语义重要性 + 角色权重 + 上下文依赖 + 长度惩罚"** 的多维度评分体系

### 评分维度（5 个维度）

#### 1. 角色权重（Role Weight）- 基础分 0-10

```typescript
const ROLE_WEIGHTS = {
    user: 10,      // 用户需求最重要
    assistant: 5,  // AI 响应次之
    tool: 3,       // 工具输出可压缩
    system: 15     // 系统提示不可压缩（但通常不参与评分）
};
```

**理由**: 用户的原始需求和问题是对话的核心驱动力，必须优先保留。

---

#### 2. 语义重要性（Semantic Importance）- 0-20 分

基于内容特征的启发式评分：

| 特征 | 分数 | 理由 |
|------|------|------|
| **错误/异常** | +15 | 错误上下文对调试至关重要 |
| **决策关键词** | +10 | "决定"、"选择"、"采用"等表示决策点 |
| **文件操作** | +8 | "创建"、"修改"、"删除"文件是关键操作 |
| **代码块** | +7 | 包含 ``` 的消息通常是实现细节 |
| **文件路径** | +5 | 文件路径是上下文锚点 |
| **问题/疑问** | +6 | 包含 "?" 或 "如何"、"为什么" |
| **确认/总结** | +4 | "完成"、"总结"、"确认" |
| **工具调用** | +5 | 包含 tool_calls 的消息 |

关键词定义：
```typescript
const CRITICAL_KEYWORDS = {
    errors: ['error', 'exception', 'failed', '错误', '失败', '异常'],
    decisions: ['决定', '选择', '采用', 'decide', 'choose', 'use'],
    fileOps: ['创建', '修改', '删除', 'create', 'modify', 'delete', 'update'],
    questions: ['如何', '为什么', '怎么', 'how', 'why', 'what', '?', '？'],
    confirmations: ['完成', '总结', '确认', 'done', 'complete', 'summary']
};
```

---

#### 3. 时间衰减（Temporal Decay）- 衰减系数 0.3-1.0

使用**指数衰减**而非线性衰减：

```typescript
// 越新的消息，衰减系数越接近 1.0
const decayFactor = Math.exp(-0.1 * ageInTurns);
// ageInTurns = 当前位置距离最新消息的轮次数

// 示例：
// 最新消息 (age=0): decay = 1.0
// 5轮前 (age=5): decay = 0.606
// 10轮前 (age=10): decay = 0.368
// 20轮前 (age=20): decay = 0.135
```

**理由**: 根据 [GoDaddy](https://www.godaddy.com/resources/news/how-godaddy-builds-context-for-agentic-ai) 的实践，滑动窗口摘要保持低延迟的同时维持连贯性。

---

#### 4. 上下文依赖（Context Dependency）- 0-15 分

检测消息之间的依赖关系：

| 依赖类型 | 分数 | 检测方法 |
|---------|------|---------|
| **工具链完整性** | +15 | assistant (tool_calls) → tool → assistant 必须完整 |
| **引用关系** | +10 | 包含 "上面"、"刚才"、"之前提到" |
| **对话连续性** | +8 | user → assistant 配对 |
| **错误修复链** | +12 | 错误 → 修复 → 验证 |

工具链检测逻辑：
```typescript
// 工具链检测
if (msg.role === 'assistant' && msg.tool_calls) {
    score += 15; // 工具调用的发起者
}
if (msg.role === 'tool') {
    // 检查前一条是否是 assistant 的 tool_calls
    if (previousMsg?.tool_calls?.some(tc => tc.id === msg.tool_call_id)) {
        score += 15; // 工具链的一部分
    }
}
```

---

#### 5. 内容长度惩罚（Length Penalty）- 负分

过长的消息可能包含冗余信息：

```typescript
const lengthPenalty = Math.min(0, -Math.log10(tokenCount / 100));
// 100 tokens: penalty = 0
// 1000 tokens: penalty = -1
// 10000 tokens: penalty = -2
```

**理由**: [AI Compaction Strategies](https://blockchain.news/ainews/ai-compaction-strategies-how-intelligent-context-compression-boosts-conversational-agent-performance) 指出，丢弃冗余输出是关键策略。

---

### 综合评分公式

```typescript
finalScore = (
    roleWeight +
    semanticImportance +
    contextDependency +
    lengthPenalty
) * temporalDecayFactor;
```

---

## 压缩策略：分层保留（Tiered Retention）

### 策略 1: 强制保留区（Always Keep）
- **系统提示**（第一条）
- **最后 N 轮对话**（N = 3-5，确保连贯性）
- **未完成的工具链**（避免破坏上下文）

### 策略 2: 高分保留区（High Score Keep）
- 评分 > 阈值（如 30 分）的消息
- 即使较早，也优先保留

### 策略 3: 时间窗口保留（Recent Window）
- 最近 K 条消息（K = 10-15）
- 即使分数较低，也保留一定数量

### 策略 4: Token 预算分配（Token Budget）
```typescript
const budget = {
    system: targetTokens * 0.15,      // 15% 系统提示
    forced: targetTokens * 0.25,      // 25% 强制保留区
    highScore: targetTokens * 0.35,   // 35% 高分消息
    recent: targetTokens * 0.25       // 25% 时间窗口
};
```

---

## 实现算法

### 核心流程

```typescript
function selectMessagesToKeep(
    messages: AIMessage[],
    targetTokens: number
): AIMessage[] {
    // 1. 计算每条消息的分数
    const scored = messages.map((msg, idx) => ({
        message: msg,
        score: calculateScore(msg, idx, messages),
        tokens: estimateTokens(msg),
        index: idx
    }));

    // 2. 强制保留区
    const systemMsg = scored[0];
    const lastN = scored.slice(-5); // 最后 5 条
    const toolChains = detectIncompleteToolChains(scored);

    const forced = [systemMsg, ...lastN, ...toolChains];
    const forcedTokens = sum(forced.map(s => s.tokens));

    // 3. 剩余预算
    const remainingBudget = targetTokens * 0.7 - forcedTokens;
    const candidates = scored.filter(s => !forced.includes(s));

    // 4. 按分数排序
    candidates.sort((a, b) => b.score - a.score);

    // 5. 贪心选择（背包问题）
    const selected = [];
    let usedTokens = 0;

    for (const candidate of candidates) {
        if (usedTokens + candidate.tokens <= remainingBudget) {
            selected.push(candidate);
            usedTokens += candidate.tokens;
        }
    }

    // 6. 按原始顺序重排
    const final = [...forced, ...selected].sort((a, b) => a.index - b.index);

    return final.map(s => s.message);
}
```

### 评分计算

```typescript
function calculateScore(
    msg: AIMessage,
    index: number,
    allMessages: AIMessage[]
): number {
    let score = 0;

    // 1. 角色权重
    score += ROLE_WEIGHTS[msg.role] || 0;

    // 2. 语义重要性
    score += calculateSemanticImportance(msg);

    // 3. 上下文依赖
    score += calculateContextDependency(msg, index, allMessages);

    // 4. 长度惩罚
    const tokens = estimateTokens(msg);
    score += Math.min(0, -Math.log10(tokens / 100));

    // 5. 时间衰减
    const age = allMessages.length - 1 - index;
    const decayFactor = Math.exp(-0.1 * age);

    return score * decayFactor;
}
```

---

## 优化技巧

### 1. 语义去重（Semantic Deduplication）
根据 [Semantic Proximity](https://openreview.net/forum?id=lvtiRJ2nwU) 的研究：
- 使用 embedding 相似度检测冗余消息
- 相似度 > 0.9 的消息只保留分数更高的一条

**注**: 当前实现暂不包含 embedding 计算，可作为未来优化方向。

### 2. 聚类摘要（Cluster Summarization）
- 将低分但相关的消息聚类
- 用一条摘要消息替代整个聚类

**注**: 当前实现暂不包含聚类功能，可作为未来优化方向。

### 3. 自适应阈值（Adaptive Threshold）
```typescript
// 根据对话长度动态调整分数阈值
const threshold = 20 + Math.log(messages.length) * 5;
// 短对话: 阈值 20
// 50 条消息: 阈值 ~40
// 200 条消息: 阈值 ~47
```

---

## 性能指标

### 评估维度
1. **信息保留率**: 关键信息是否被保留
2. **压缩比**: 压缩后 tokens / 原始 tokens
3. **任务成功率**: 压缩后 AI 能否完成任务
4. **延迟**: 评分计算的时间开销

### 目标
- 信息保留率 > 85%
- 压缩比 < 0.4（压缩到 40% 以下）
- 任务成功率 > 90%
- 评分延迟 < 50ms

---

## 与现有实现的集成

### 修改点

#### 1. ContextManager.compressHistory()
- 添加 `scoreMessage()` 方法
- 添加 `selectMessagesByScore()` 方法
- 修改保留逻辑从"时间窗口"改为"分数+时间混合"

#### 2. 分级压缩策略
- **轻度压缩**：只修剪工具输出（不变）
- **中度压缩**：使用打分机制 + 8k 目标
- **重度压缩**：使用打分机制 + 5k 目标 + 更高阈值

#### 3. 配置化
```typescript
interface ScoringConfig {
    roleWeights: Record<string, number>;
    semanticKeywords: Record<string, string[]>;
    decayRate: number;
    lengthPenaltyEnabled: boolean;
    minScoreThreshold: number;
    forcedKeepLastN: number;
}
```

---

## 配置参数

### 默认配置
```typescript
const DEFAULT_SCORING_CONFIG: ScoringConfig = {
    roleWeights: {
        user: 10,
        assistant: 5,
        tool: 3,
        system: 15
    },
    semanticKeywords: {
        errors: ['error', 'exception', 'failed', '错误', '失败', '异常'],
        decisions: ['决定', '选择', '采用', 'decide', 'choose', 'use'],
        fileOps: ['创建', '修改', '删除', 'create', 'modify', 'delete', 'update'],
        questions: ['如何', '为什么', '怎么', 'how', 'why', 'what', '?', '？'],
        confirmations: ['完成', '总结', '确认', 'done', 'complete', 'summary']
    },
    decayRate: 0.1,
    lengthPenaltyEnabled: true,
    minScoreThreshold: 15,
    forcedKeepLastN: 5
};
```

---

## 实施计划

### 阶段 1: 核心评分实现（第 1 天）
1. ✅ 实现 `scoreMessage()` 方法
2. ✅ 实现 `calculateSemanticImportance()` 方法
3. ✅ 实现 `calculateContextDependency()` 方法
4. ✅ 实现时间衰减逻辑

### 阶段 2: 选择算法实现（第 1 天）
5. ✅ 实现 `selectMessagesByScore()` 方法
6. ✅ 实现强制保留区逻辑
7. ✅ 实现工具链完整性检测

### 阶段 3: 集成与测试（第 2 天）
8. ✅ 集成到 `compressHistory()` 方法
9. ✅ 更新分级压缩策略
10. ✅ 编写单元测试
11. ✅ 性能测试和调优

---

## 参考文献

- [SimpleMem: 30x More Efficient Memory for LLM Agents](https://www.tekta.ai/ai-research-papers/simplemem-llm-agent-memory-2026)
- [Semantic Proximity for Redundancy-Aware Context Compression](https://openreview.net/forum?id=lvtiRJ2nwU)
- [Token Retention for Memory-Bounded KV Cache](https://arxiv.org/abs/2512.03324)
- [Context Management for Multi-Turn Dialogues](https://getathenic.com/blog/building-conversational-ai-agents-context-management)
- [Token Budgeting Best Practices](https://www.operion.io/learn/component/token-budgeting)
- [How to Make AI Agents Remember Context](https://particula.tech/blog/ai-agent-memory-context-management)
- [AI Compaction Strategies](https://blockchain.news/ainews/ai-compaction-strategies-how-intelligent-context-compression-boosts-conversational-agent-performance)
- [Attention Score is not All You Need](https://arxiv.org/html/2406.12335v1)
- [GoDaddy: Building Context for Agentic AI](https://www.godaddy.com/resources/news/how-godaddy-builds-context-for-agentic-ai)
- [Context Window Management Guide](https://eval.16x.engineer/blog/llm-context-management-guide)

---

## 更新日志

- **2026-01-21**: 初始版本，定义打分机制和实施计划
