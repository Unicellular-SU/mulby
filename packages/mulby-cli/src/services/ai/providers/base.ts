
import { AIMessage, AIProviderConfig, getModelContextWindow } from '../../../types/ai';

export interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    tools?: any[];
    toolChoice?: any;
    stream?: boolean;
    enableThinking?: boolean;
}

export interface AIChatResponse {
    content: string | null;
    reasoning_content?: string;
    toolCalls?: any[];
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export abstract class BaseAIProvider {
    constructor(protected config: AIProviderConfig) { }

    abstract chat(messages: AIMessage[], options?: ChatOptions): Promise<AIChatResponse>;
    abstract chatStream(messages: AIMessage[], onChunk: (chunk: string) => void, options?: ChatOptions): Promise<AIChatResponse>;

    /**
     * Get the context window size for the current model
     * @returns Context window size in tokens
     */
    getContextWindow(): number {
        // 1. Use user-configured contextWindow if available
        if (this.config.contextWindow) {
            return this.config.contextWindow;
        }

        // 2. Infer from model name
        const modelName = this.config.model || '';
        const modelInfo = getModelContextWindow(modelName, this.config.provider);
        return modelInfo.contextWindow;
    }

    /**
     * Get the recommended max output tokens for the current model
     * @returns Max output tokens
     */
    getMaxOutputTokens(): number {
        // 1. Use user-configured maxTokens if available
        if (this.config.maxTokens) {
            return this.config.maxTokens;
        }

        // 2. Infer from model name
        const modelName = this.config.model || '';
        const modelInfo = getModelContextWindow(modelName, this.config.provider);
        return modelInfo.maxOutput || 4096;
    }
}
