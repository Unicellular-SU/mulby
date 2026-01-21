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
                totalChars += msg.content.length;
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

        let kept: AIMessage[];

        if (useScoring) {
            // Use score-based selection
            const messagesToScore = messages.slice(startIndex);
            kept = this.selectMessagesByScore(messagesToScore, targetTokens * 0.7);
        } else {
            // Fallback: time-based retention (old behavior)
            const keepBudget = Math.floor(targetTokens * 0.7);
            kept = [];
            let currentTokens = 0;

            // Retain messages from the end, up to the budget
            for (let i = messages.length - 1; i >= startIndex; i--) {
                const msg = messages[i];
                const msgTokens = this.estimateTokenCount([msg]);

                if (currentTokens + msgTokens < keepBudget) {
                    kept.unshift(msg);
                    currentTokens += msgTokens;
                } else {
                    break;
                }
            }

            // Ensure we don't cut in the middle of a tool chain
            kept = this.ensureCompleteToolChains(kept);
        }

        // Messages to compress
        const toCompress = messages.slice(startIndex, messages.length - kept.length);

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
     * Ensures that retained messages don't start/end in the middle of a tool chain.
     */
    private static ensureCompleteToolChains(messages: AIMessage[]): AIMessage[] {
        if (messages.length === 0) return messages;

        // Remove leading tool messages (orphaned responses)
        while (messages.length > 0 && messages[0].role === 'tool') {
            messages.shift();
        }

        // Remove trailing assistant messages with tool calls (incomplete chains)
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === 'assistant' && lastMsg.tool_calls?.length) {
            messages.pop();
        }

        return messages;
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
     */
    private static scoreMessage(
        msg: AIMessage,
        index: number,
        allMessages: AIMessage[],
        config: ScoringConfig = this.DEFAULT_SCORING_CONFIG
    ): number {
        let score = 0;

        // 1. Role weight
        score += config.roleWeights[msg.role] || 0;

        // 2. Semantic importance
        score += this.calculateSemanticImportance(msg, config);

        // 3. Context dependency
        score += this.calculateContextDependency(msg, index, allMessages);

        // 4. Length penalty
        if (config.lengthPenaltyEnabled) {
            const tokens = this.estimateTokenCount([msg]);
            const lengthPenalty = Math.min(0, -Math.log10(tokens / 100));
            score += lengthPenalty;
        }

        // 5. Temporal decay
        const age = allMessages.length - 1 - index;
        const decayFactor = Math.exp(-config.decayRate * age);

        return score * decayFactor;
    }

    /**
     * Detect incomplete tool chains that must be kept together
     */
    private static detectIncompleteToolChains(scored: ScoredMessage[]): ScoredMessage[] {
        const toolChains: ScoredMessage[] = [];

        for (let i = 0; i < scored.length; i++) {
            const current = scored[i];

            // If assistant message has tool_calls, check if all responses are present
            if (current.message.role === 'assistant' && current.message.tool_calls) {
                const toolCallIds = current.message.tool_calls.map(tc => tc.id);

                // Find corresponding tool responses
                for (let j = i + 1; j < scored.length; j++) {
                    const next = scored[j];
                    if (next.message.role === 'tool' &&
                        toolCallIds.includes(next.message.tool_call_id || '')) {
                        toolChains.push(current);
                        toolChains.push(next);
                    }
                }
            }
        }

        return toolChains;
    }

    /**
     * Select messages to keep based on scores and token budget
     */
    private static selectMessagesByScore(
        messages: AIMessage[],
        targetTokens: number,
        config: ScoringConfig = this.DEFAULT_SCORING_CONFIG
    ): AIMessage[] {
        if (messages.length === 0) return [];

        // 1. Calculate scores for all messages
        const scored: ScoredMessage[] = messages.map((msg, idx) => ({
            message: msg,
            score: this.scoreMessage(msg, idx, messages, config),
            tokens: this.estimateTokenCount([msg]),
            index: idx
        }));

        // 2. Forced keep zone
        const forcedKeep: ScoredMessage[] = [];

        // System message (first)
        if (scored[0]?.message.role === 'system') {
            forcedKeep.push(scored[0]);
        }

        // Last N messages
        const lastN = scored.slice(-config.forcedKeepLastN);
        forcedKeep.push(...lastN);

        // Incomplete tool chains
        const toolChains = this.detectIncompleteToolChains(scored);
        forcedKeep.push(...toolChains);

        // Remove duplicates
        const forcedSet = new Set(forcedKeep.map(s => s.index));
        const forcedUnique = scored.filter(s => forcedSet.has(s.index));
        const forcedTokens = forcedUnique.reduce((sum, s) => sum + s.tokens, 0);

        // 3. Remaining budget (70% of target, minus forced)
        const remainingBudget = targetTokens * 0.7 - forcedTokens;
        if (remainingBudget <= 0) {
            // Budget exhausted, return only forced messages
            return forcedUnique.sort((a, b) => a.index - b.index).map(s => s.message);
        }

        // 4. Candidates (exclude forced messages)
        const candidates = scored.filter(s => !forcedSet.has(s.index));

        // 5. Sort by score (descending)
        candidates.sort((a, b) => b.score - a.score);

        // 6. Greedy selection (knapsack problem)
        const selected: ScoredMessage[] = [];
        let usedTokens = 0;

        for (const candidate of candidates) {
            // Only select if score meets threshold
            if (candidate.score < config.minScoreThreshold) {
                continue;
            }

            if (usedTokens + candidate.tokens <= remainingBudget) {
                selected.push(candidate);
                usedTokens += candidate.tokens;
            }
        }

        // 7. Combine and sort by original index
        const final = [...forcedUnique, ...selected].sort((a, b) => a.index - b.index);

        // Remove duplicates again
        const seen = new Set<number>();
        const unique = final.filter(s => {
            if (seen.has(s.index)) return false;
            seen.add(s.index);
            return true;
        });

        return unique.map(s => s.message);
    }
}
