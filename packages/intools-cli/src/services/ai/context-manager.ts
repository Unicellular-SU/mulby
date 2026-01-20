import { AIMessage } from '../../types/ai';

export class ContextManager {
    // Estimating 4 characters per token as a rough heuristic for English text.
    // For code or Chinese, it might vary, but this is a standard approximation.
    private static readonly CHARS_PER_TOKEN = 4;

    /**
     * Estimates the token count of the conversation history.
     */
    public static estimateTokenCount(messages: AIMessage[]): number {
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
     * Compresses the conversation history by summarizing the middle part.
     * Keeps the system prompt (first message) and the last N messages.
     * Uses the provided summarizer function (which calls the AI) to summarize the middle.
     */
    public static async compressHistory(
        messages: AIMessage[],
        keepLastN: number = 6,
        summarizer: (textToSummarize: string) => Promise<string>
    ): Promise<AIMessage[]> {
        if (messages.length <= keepLastN + 2) {
            return messages; // Nothing to compress
        }

        const systemMessage = messages[0].role === 'system' ? messages[0] : null;
        const startIndex = systemMessage ? 1 : 0;
        let endIndex = messages.length - keepLastN;
        if (endIndex < startIndex) endIndex = startIndex;

        // Ensure we doesn't cut in the middle of a tool chain.
        // If the starting message of the retained segment is a 'tool' message,
        // we must shift the boundary back to include the Assistant message that triggered it.
        while (endIndex > startIndex && messages[endIndex].role === 'tool') {
            endIndex--;
        }

        const messagesToSummarize = messages.slice(startIndex, endIndex);
        const retainedMessages = messages.slice(endIndex);

        console.log(`Compressing ${messagesToSummarize.length} messages...`);

        // Prune large tool outputs from the body (Read-and-Forget)
        const prunedMessages = this.pruneOldToolOutputs(messagesToSummarize);

        // Convert messages to a text format for the AI to summarize
        const textToSummarize = prunedMessages.map(m => {
            return `${m.role.toUpperCase()}: ${m.content || '(Tool Operations)'}`;
        }).join('\n\n');

        try {
            const summary = await summarizer(textToSummarize);

            const summaryMessage: AIMessage = {
                role: 'system',
                content: `[Previous Context Summary]: ${summary}`
            };

            const newHistory: AIMessage[] = [];
            if (systemMessage) newHistory.push(systemMessage);
            newHistory.push(summaryMessage);
            newHistory.push(...retainedMessages);

            return newHistory;
        } catch (error) {
            console.error('Failed to compress history:', error);
            return messages; // Return original on failure
        }
    }
    /**
     * Prunes large tool outputs from historical messages.
     * This implements the "Read-and-Forget" strategy.
     */
    private static pruneOldToolOutputs(messages: AIMessage[]): AIMessage[] {
        return messages.map(msg => {
            if (msg.role === 'tool' && msg.content && msg.content.length > 1000) {
                return {
                    ...msg,
                    content: `[Tool output pruned: ${msg.content.length} chars. See summary for context.]`
                };
            }
            return msg;
        });
    }
}
