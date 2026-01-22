import { AIMessage } from '../../types/ai';
import { encodingForModel } from 'js-tiktoken';

/**
 * Scoring configuration for message importance evaluation
 */
interface ScoringConfig {
    roleWeights: Record<string, number>;
    semanticKeywords: Record<string, string[]>;
    decayRate: number;
    lengthPenaltyEnabled: boolean;
    minScoreThreshold: number;
    forcedKeepLastN: number;
}

/**
 * Scored message with metadata
 */
interface ScoredMessage {
    message: AIMessage;
    score: number;
    tokens: number;
    index: number;
}

/**
 * Message group - either a single message or a tool chain (assistant + tool responses)
 */
interface MessageGroup {
    messages: ScoredMessage[];
    totalScore: number;
    totalTokens: number;
    startIndex: number;  // First message index in the group
}

export class ContextManager {
    // Fallback: 4 characters per token as a rough heuristic
    private static readonly CHARS_PER_TOKEN = 4;
    private static encoder: ReturnType<typeof encodingForModel> | null = null;

    /**
     * Default scoring configuration
     */
    private static readonly DEFAULT_SCORING_CONFIG: ScoringConfig = {
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
            confirmations: ['完成', '总结', '确认', 'done', 'complete', 'summary'],
            codeBlocks: ['```'],
            filePaths: ['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.go', '.rs']
        },
        decayRate: 0.1,
        lengthPenaltyEnabled: true,
        minScoreThreshold: 15,
        forcedKeepLastN: 5
    };

    /**
     * Initialize the tiktoken encoder (lazy loading)
     */
    private static getEncoder() {
        if (!this.encoder) {
            try {
                // Use cl100k_base encoding (used by GPT-4, Claude, etc.)
                this.encoder = encodingForModel('gpt-4');
            } catch (error) {
                console.warn('Failed to initialize tiktoken encoder, falling back to heuristic:', error);
            }
        }
        return this.encoder;
    }

    /**
     * Estimates the token count of the conversation history using tiktoken.
     * Falls back to character-based estimation if tiktoken fails.
     */
    public static estimateTokenCount(messages: AIMessage[]): number {
        const encoder = this.getEncoder();

        if (encoder) {
            try {
                // Convert messages to JSON string for accurate token counting
                const text = JSON.stringify(messages);
                const tokens = encoder.encode(text);
                return tokens.length;
            } catch (error) {
                console.warn('Tiktoken encoding failed, using fallback:', error);
            }
        }

        // Fallback to character-based estimation
        let totalChars = 0;
        for (const msg of messages) {
            if (msg.content) {
                if (typeof msg.content === 'string') {
                    totalChars += msg.content.length;
                } else if (Array.isArray(msg.content)) {
                    // Handle content blocks array
                    for (const block of msg.content) {
                        if (block.type === 'text' && block.text) {
                            totalChars += block.text.length;
                        } else {
                            totalChars += JSON.stringify(block).length;
                        }
                    }
                }
            }
            if (msg.tool_calls) {
                for (const call of msg.tool_calls) {
                    totalChars += JSON.stringify(call).length;
                }
            }
        }
        return Math.ceil(totalChars / this.CHARS_PER_TOKEN);
    }

    /**
     * Compresses the conversation history using score-based intelligent retention.
     * @param messages - The conversation history
     * @param targetTokens - Target token count after compression (default: 8000)
     * @param summarizer - Function to generate summary of compressed messages
     * @param useScoring - Whether to use scoring mechanism (default: true)
     */
    public static async compressHistory(
        messages: AIMessage[],
        targetTokens: number = 8000,
        summarizer: (textToSummarize: string) => Promise<string>,
        useScoring: boolean = true
    ): Promise<AIMessage[]> {
        const totalTokens = this.estimateTokenCount(messages);

        // No compression needed
        if (totalTokens <= targetTokens) {
            return messages;
        }

        const systemMessage = messages[0].role === 'system' ? messages[0] : null;
        const startIndex = systemMessage ? 1 : 0;

        // Get indices of messages to keep (relative to full messages array)
        let keptIndices: Set<number>;

        if (useScoring) {
            // Use score-based selection - returns indices relative to messagesToScore
            const messagesToScore = messages.slice(startIndex);
            const relativeIndices = this.selectMessageIndicesByScore(messagesToScore, targetTokens * 0.7);
            // Convert to absolute indices
            keptIndices = new Set([...relativeIndices].map(i => i + startIndex));
        } else {
            // Fallback: time-based retention (old behavior)
            const keepBudget = Math.floor(targetTokens * 0.7);
            keptIndices = new Set<number>();
            let currentTokens = 0;

            // Retain messages from the end, up to the budget
            for (let i = messages.length - 1; i >= startIndex; i--) {
                const msg = messages[i];
                const msgTokens = this.estimateTokenCount([msg]);

                if (currentTokens + msgTokens < keepBudget) {
                    keptIndices.add(i);
                    currentTokens += msgTokens;
                } else {
                    break;
                }
            }
        }

        // Build kept and toCompress arrays based on indices
        let kept: AIMessage[] = [];
        let toCompress: AIMessage[] = [];

        for (let i = startIndex; i < messages.length; i++) {
            if (keptIndices.has(i)) {
                kept.push(messages[i]);
            } else {
                toCompress.push(messages[i]);
            }
        }

        // Ensure we don't cut in the middle of a tool chain (applies to both strategies)
        kept = this.ensureCompleteToolChains(kept);

        if (toCompress.length === 0) {
            return systemMessage ? [systemMessage, ...kept] : kept;
        }

        console.log(`Compressing ${toCompress.length} messages (keeping ${kept.length} with ${useScoring ? 'scoring' : 'time-based'} strategy)...`);

        // Prune large tool outputs before summarizing
        const prunedMessages = toCompress.map(msg => this.pruneToolOutput(msg));

        // Convert to text for summarization
        const textToSummarize = this.messagesToText(prunedMessages);

        try {
            const summary = await summarizer(textToSummarize);

            // Use content blocks with cache_control for Prompt Caching
            const summaryMessage: AIMessage = {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `[Previous Context Summary]\n${summary}`,
                        cache_control: { type: 'ephemeral' }
                    }
                ]
            };

            const newHistory: AIMessage[] = [];
            if (systemMessage) newHistory.push(systemMessage);
            newHistory.push(summaryMessage);
            newHistory.push(...kept);

            return newHistory;
        } catch (error) {
            console.error('Failed to compress history:', error);
            return messages; // Return original on failure
        }
    }

    /**
     * Ensures that retained messages don't have broken tool chains.
     * - Removes orphaned tool messages (no corresponding assistant)
     * - Removes assistant messages with tool_calls that have no responses
     * - Handles both leading/trailing and middle incomplete chains
     */
    private static ensureCompleteToolChains(messages: AIMessage[]): AIMessage[] {
        if (messages.length === 0) return messages;

        // 1. Build a set of all tool_call IDs that have responses
        const respondedToolCallIds = new Set<string>();
        for (const msg of messages) {
            if (msg.role === 'tool' && msg.tool_call_id) {
                respondedToolCallIds.add(msg.tool_call_id);
            }
        }

        // 2. Build a set of all valid tool_call IDs from assistant messages
        //    that have ALL their tool_calls responded to
        const validToolCallIds = new Set<string>();
        const assistantIndicesToRemove = new Set<number>();

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                // Check if ALL tool_calls have responses
                const allResponded = msg.tool_calls.every(
                    call => call.id && respondedToolCallIds.has(call.id)
                );

                if (allResponded) {
                    // All tool_calls have responses - mark them as valid
                    for (const call of msg.tool_calls) {
                        if (call.id) {
                            validToolCallIds.add(call.id);
                        }
                    }
                } else {
                    // Some tool_calls don't have responses - remove this assistant message
                    assistantIndicesToRemove.add(i);
                }
            }
        }

        // 3. Filter messages
        const filtered = messages.filter((msg, index) => {
            // Remove assistant messages with incomplete tool chains
            if (assistantIndicesToRemove.has(index)) {
                return false;
            }

            // Remove orphaned tool messages
            if (msg.role === 'tool') {
                const toolCallId = msg.tool_call_id;
                if (!toolCallId || !validToolCallIds.has(toolCallId)) {
                    return false;
                }
            }

            return true;
        });

        // 4. Remove leading tool messages (in case any slipped through)
        while (filtered.length > 0 && filtered[0].role === 'tool') {
            filtered.shift();
        }

        // 5. Remove trailing assistant messages with tool calls (incomplete chains)
        while (filtered.length > 0) {
            const lastMsg = filtered[filtered.length - 1];
            if (lastMsg?.role === 'assistant' && lastMsg.tool_calls?.length) {
                filtered.pop();
            } else {
                break;
            }
        }

        return filtered;
    }

    /**
     * Converts messages to text format for summarization.
     */
    private static messagesToText(messages: AIMessage[]): string {
        return messages.map(m => {
            let content = '';
            if (typeof m.content === 'string') {
                content = m.content;
            } else if (Array.isArray(m.content)) {
                // Extract text from content blocks
                content = m.content
                    .filter(block => block.type === 'text' && block.text)
                    .map(block => block.text)
                    .join(' ');
            }

            if (m.tool_calls?.length) {
                content += ` [Tool calls: ${m.tool_calls.length}]`;
            }
            return `${m.role.toUpperCase()}: ${content}`;
        }).join('\n\n');
    }
    /**
     * Intelligently prunes tool outputs based on content type.
     * Implements smart "Read-and-Forget" strategy.
     */
    private static pruneToolOutput(msg: AIMessage): AIMessage {
        if (msg.role !== 'tool' || !msg.content) {
            return msg;
        }

        // Only handle string content for now
        if (typeof msg.content !== 'string') {
            return msg;
        }

        const content = msg.content;
        const length = content.length;

        // Short content - keep as is
        if (length <= 1000) {
            return msg;
        }

        // Error messages - always keep complete
        if (content.includes('Error:') || content.includes('错误') ||
            content.includes('Exception') || content.includes('Failed')) {
            return msg;
        }

        const toolName = msg.name || msg.tool_call_id || '';

        // File read operations - keep head and tail
        if (toolName.includes('read') || toolName.includes('Read') ||
            content.includes('```') || /^\s*\d+\s*→/.test(content)) {
            const head = content.slice(0, 300);
            const tail = content.slice(-300);
            return {
                ...msg,
                content: `${head}\n\n[... ${length - 600} chars omitted ...]\n\n${tail}`
            };
        }

        // Search/grep results - keep match lines
        if (toolName.includes('search') || toolName.includes('grep') ||
            toolName.includes('Grep') || toolName.includes('find')) {
            const lines = content.split('\n');
            const matchLines = lines
                .filter((line: string) => line.includes(':') || line.includes('match') || line.includes('→'))
                .slice(0, 30);

            if (matchLines.length > 0) {
                return {
                    ...msg,
                    content: `${matchLines.join('\n')}\n[Total: ${lines.length} lines, showing first 30 matches]`
                };
            }
        }

        // List operations - keep summary
        if (toolName.includes('list') || toolName.includes('ls') ||
            content.match(/^[\w\-\.]+\s+[\w\-\.]+\s+\d+/m)) {
            const lines = content.split('\n').slice(0, 20);
            return {
                ...msg,
                content: `${lines.join('\n')}\n[... ${content.split('\n').length - 20} more items]`
            };
        }

        // Default: keep first 500 chars with context
        return {
            ...msg,
            content: `${content.slice(0, 500)}\n\n[Tool output truncated: ${length} chars total]`
        };
    }

    /**
     * Light compression: only prune tool outputs without summarization.
     */
    public static lightCompress(messages: AIMessage[]): AIMessage[] {
        return messages.map(msg => this.pruneToolOutput(msg));
    }

    // ==================== Message Scoring System ====================

    /**
     * Calculate semantic importance score based on content features
     */
    private static calculateSemanticImportance(
        msg: AIMessage,
        config: ScoringConfig = this.DEFAULT_SCORING_CONFIG
    ): number {
        let score = 0;

        // Extract text content
        let content = '';
        if (typeof msg.content === 'string') {
            content = msg.content;
        } else if (Array.isArray(msg.content)) {
            content = msg.content
                .filter(block => block.type === 'text' && block.text)
                .map(block => block.text)
                .join(' ');
        }

        if (!content) return 0;

        const lowerContent = content.toLowerCase();

        // Check for errors/exceptions (+15)
        if (config.semanticKeywords.errors.some(kw => lowerContent.includes(kw.toLowerCase()))) {
            score += 15;
        }

        // Check for decision keywords (+10)
        if (config.semanticKeywords.decisions.some(kw => lowerContent.includes(kw.toLowerCase()))) {
            score += 10;
        }

        // Check for file operations (+8)
        if (config.semanticKeywords.fileOps.some(kw => lowerContent.includes(kw.toLowerCase()))) {
            score += 8;
        }

        // Check for code blocks (+7)
        if (config.semanticKeywords.codeBlocks.some(kw => content.includes(kw))) {
            score += 7;
        }

        // Check for questions (+6)
        if (config.semanticKeywords.questions.some(kw => lowerContent.includes(kw.toLowerCase()))) {
            score += 6;
        }

        // Check for file paths (+5)
        if (config.semanticKeywords.filePaths.some(ext => content.includes(ext))) {
            score += 5;
        }

        // Check for tool calls (+5)
        if (msg.tool_calls && msg.tool_calls.length > 0) {
            score += 5;
        }

        // Check for confirmations/summaries (+4)
        if (config.semanticKeywords.confirmations.some(kw => lowerContent.includes(kw.toLowerCase()))) {
            score += 4;
        }

        return score;
    }

    /**
     * Calculate context dependency score based on message relationships
     */
    private static calculateContextDependency(
        msg: AIMessage,
        index: number,
        allMessages: AIMessage[]
    ): number {
        let score = 0;

        // Tool chain integrity
        if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            score += 15; // Tool call initiator
        }

        if (msg.role === 'tool') {
            // Check if this is part of a tool chain
            const prevMsg = index > 0 ? allMessages[index - 1] : null;
            if (prevMsg?.role === 'assistant' && prevMsg.tool_calls) {
                const isPartOfChain = prevMsg.tool_calls.some(
                    tc => tc.id === msg.tool_call_id
                );
                if (isPartOfChain) {
                    score += 15; // Part of tool chain
                }
            }
        }

        // Reference relationships
        let content = '';
        if (typeof msg.content === 'string') {
            content = msg.content;
        } else if (Array.isArray(msg.content)) {
            content = msg.content
                .filter(block => block.type === 'text' && block.text)
                .map(block => block.text)
                .join(' ');
        }

        const lowerContent = content.toLowerCase();
        const referenceKeywords = ['上面', '刚才', '之前提到', 'above', 'earlier', 'previously mentioned'];
        if (referenceKeywords.some(kw => lowerContent.includes(kw))) {
            score += 10; // Contains references
        }

        // User-Assistant pairing
        if (msg.role === 'user') {
            const nextMsg = index < allMessages.length - 1 ? allMessages[index + 1] : null;
            if (nextMsg?.role === 'assistant') {
                score += 8; // Part of Q&A pair
            }
        }

        // Error-fix chain detection
        if (lowerContent.includes('error') || lowerContent.includes('错误')) {
            // Check if followed by fix attempts
            for (let i = index + 1; i < Math.min(index + 3, allMessages.length); i++) {
                const futureMsg = allMessages[i];
                const futureContent = typeof futureMsg.content === 'string' ? futureMsg.content : '';
                if (futureContent.toLowerCase().includes('fix') ||
                    futureContent.toLowerCase().includes('修复') ||
                    futureContent.toLowerCase().includes('解决')) {
                    score += 12; // Part of error-fix chain
                    break;
                }
            }
        }

        return score;
    }

    /**
     * Calculate comprehensive score for a message
     * @param precomputedTokens - Pre-computed token count to avoid redundant calculation
     */
    private static scoreMessage(
        msg: AIMessage,
        index: number,
        allMessages: AIMessage[],
        precomputedTokens: number,
        config: ScoringConfig = this.DEFAULT_SCORING_CONFIG
    ): number {
        let score = 0;

        // 1. Role weight
        score += config.roleWeights[msg.role] || 0;

        // 2. Semantic importance
        score += this.calculateSemanticImportance(msg, config);

        // 3. Context dependency
        score += this.calculateContextDependency(msg, index, allMessages);

        // 4. Length penalty (use pre-computed tokens)
        if (config.lengthPenaltyEnabled && precomputedTokens > 0) {
            const lengthPenalty = Math.min(0, -Math.log10(precomputedTokens / 100));
            score += lengthPenalty;
        }

        // 5. Temporal decay
        const age = allMessages.length - 1 - index;
        const decayFactor = Math.exp(-config.decayRate * age);

        return score * decayFactor;
    }

    /**
     * Group messages into tool chains and standalone messages.
     * Tool chains (assistant with tool_calls + corresponding tool responses) are grouped together
     * so they can be selected or discarded as a unit.
     */
    private static groupMessagesWithToolChains(scored: ScoredMessage[]): MessageGroup[] {
        const groups: MessageGroup[] = [];
        const usedIndices = new Set<number>();

        // First pass: identify tool chains
        for (let i = 0; i < scored.length; i++) {
            const current = scored[i];

            if (current.message.role === 'assistant' && current.message.tool_calls?.length) {
                const toolCallIds = new Set(current.message.tool_calls.map(tc => tc.id));
                const chainMessages: ScoredMessage[] = [current];

                // Find all corresponding tool responses
                for (let j = i + 1; j < scored.length; j++) {
                    const next = scored[j];
                    if (next.message.role === 'tool' &&
                        next.message.tool_call_id &&
                        toolCallIds.has(next.message.tool_call_id)) {
                        chainMessages.push(next);
                    }
                    // Stop if we hit another assistant message (new potential chain)
                    if (next.message.role === 'assistant') {
                        break;
                    }
                }

                // Mark all indices as used
                for (const msg of chainMessages) {
                    usedIndices.add(msg.index);
                }

                // Calculate group totals
                const totalScore = chainMessages.reduce((sum, m) => sum + m.score, 0);
                const totalTokens = chainMessages.reduce((sum, m) => sum + m.tokens, 0);

                groups.push({
                    messages: chainMessages,
                    totalScore,
                    totalTokens,
                    startIndex: current.index
                });
            }
        }

        // Second pass: add standalone messages (not part of any tool chain)
        for (const msg of scored) {
            if (!usedIndices.has(msg.index)) {
                groups.push({
                    messages: [msg],
                    totalScore: msg.score,
                    totalTokens: msg.tokens,
                    startIndex: msg.index
                });
            }
        }

        // Sort groups by their start index to maintain order
        groups.sort((a, b) => a.startIndex - b.startIndex);

        return groups;
    }

    /**
     * Select message indices to keep based on scores and token budget.
     * Tool chains are treated as atomic units - they are either kept entirely or discarded entirely.
     * @returns Set of message indices to keep
     */
    private static selectMessageIndicesByScore(
        messages: AIMessage[],
        targetTokens: number,
        config: ScoringConfig = this.DEFAULT_SCORING_CONFIG
    ): Set<number> {
        if (messages.length === 0) return new Set();

        // 1. Pre-compute tokens for all messages (done once)
        const tokenCounts = messages.map(msg => this.estimateTokenCount([msg]));

        // 2. Calculate scores for all messages (using pre-computed tokens)
        const scored: ScoredMessage[] = messages.map((msg, idx) => ({
            message: msg,
            score: this.scoreMessage(msg, idx, messages, tokenCounts[idx], config),
            tokens: tokenCounts[idx],
            index: idx
        }));

        // 3. Group messages (tool chains are grouped together)
        const groups = this.groupMessagesWithToolChains(scored);

        // 4. Identify forced keep groups (last N messages)
        const forcedKeepGroupIndices = new Set<number>();
        const lastNIndices = new Set<number>();
        for (let i = Math.max(0, scored.length - config.forcedKeepLastN); i < scored.length; i++) {
            lastNIndices.add(i);
        }

        for (let gi = 0; gi < groups.length; gi++) {
            const group = groups[gi];
            // If any message in this group is in lastN, keep the whole group
            if (group.messages.some(m => lastNIndices.has(m.index))) {
                forcedKeepGroupIndices.add(gi);
            }
        }

        // 5. Calculate forced tokens
        let forcedTokens = 0;
        for (const gi of forcedKeepGroupIndices) {
            forcedTokens += groups[gi].totalTokens;
        }

        // 6. Remaining budget
        const remainingBudget = targetTokens - forcedTokens;

        // 7. If budget exhausted, return only forced indices
        if (remainingBudget <= 0) {
            const result = new Set<number>();
            for (const gi of forcedKeepGroupIndices) {
                for (const m of groups[gi].messages) {
                    result.add(m.index);
                }
            }
            return result;
        }

        // 8. Candidate groups (not forced)
        const candidateGroups: { group: MessageGroup; index: number }[] = [];
        for (let gi = 0; gi < groups.length; gi++) {
            if (!forcedKeepGroupIndices.has(gi)) {
                candidateGroups.push({ group: groups[gi], index: gi });
            }
        }

        // 9. Sort candidates by score density (score per token) for better efficiency
        candidateGroups.sort((a, b) => {
            const densityA = a.group.totalScore / a.group.totalTokens;
            const densityB = b.group.totalScore / b.group.totalTokens;
            return densityB - densityA;  // Higher density first
        });

        // 10. Greedy selection
        const selectedGroupIndices = new Set<number>(forcedKeepGroupIndices);
        let usedTokens = 0;

        for (const { group, index } of candidateGroups) {
            // Calculate average score per message for threshold check
            const avgScore = group.totalScore / group.messages.length;

            // Skip low-value groups
            if (avgScore < config.minScoreThreshold) {
                continue;
            }

            if (usedTokens + group.totalTokens <= remainingBudget) {
                selectedGroupIndices.add(index);
                usedTokens += group.totalTokens;
            }
        }

        // 11. Collect all selected message indices
        const result = new Set<number>();
        for (const gi of selectedGroupIndices) {
            for (const m of groups[gi].messages) {
                result.add(m.index);
            }
        }

        return result;
    }
}
