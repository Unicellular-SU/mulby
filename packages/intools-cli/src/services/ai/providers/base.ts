
import { AIMessage, AIProviderConfig } from '../../../types/ai';

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
}
