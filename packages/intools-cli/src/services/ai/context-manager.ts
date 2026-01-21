import { AIMessage } from '../../types/ai';
import { encodingForModel } from 'js-tiktoken';

export class ContextManager {
    // Fallback: 4 characters per token as a rough heuristic
    private static readonly CHARS_PER_TOKEN = 4;
    private static encoder: ReturnType<typeof encodingForModel> | null = null;

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
     * Compresses the conversation history using dynamic token-based retention.
     * @param messages - The conversation history
     * @param targetTokens - Target token count after compression (default: 8000)
     * @param summarizer - Function to generate summary of compressed messages
     */
    public static async compressHistory(
        messages: AIMessage[],
        targetTokens: number = 8000,
        summarizer: (textToSummarize: string) => Promise<string>
    ): Promise<AIMessage[]> {
        const totalTokens = this.estimateTokenCount(messages);

        // No compression needed
        if (totalTokens <= targetTokens) {
            return messages;
        }

        const systemMessage = messages[0].role === 'system' ? messages[0] : null;
        const startIndex = systemMessage ? 1 : 0;

        // Reserve 30% of budget for summary, use 70% for retained messages
        const keepBudget = Math.floor(targetTokens * 0.7);
        let kept: AIMessage[] = [];
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

        // Messages to compress
        const toCompress = messages.slice(startIndex, messages.length - kept.length);

        if (toCompress.length === 0) {
            return systemMessage ? [systemMessage, ...kept] : kept;
        }

        console.log(`Compressing ${toCompress.length} messages (keeping ${kept.length})...`);

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
}
