
export interface AIConfig {
    // 服务商配置
    provider: 'openai' | 'claude' | 'deepseek' | 'custom';

    // API 配置
    apiKey: string;
    apiEndpoint?: string;    // 自定义端点
    model?: string;          // 模型选择

    // 高级配置
    maxRetries?: number;     // 最大重试次数，默认 3
    timeout?: number;        // 超时时间（秒），默认 60
    maxTokens?: number;      // 最大输出 token 数
    streaming?: boolean;     // 是否流式输出，默认 true
}

export interface GlobalConfig {
    ai?: AIConfig;
    [key: string]: any;
}

export const DEFAULT_AI_CONFIG: Partial<AIConfig> = {
    provider: 'openai',
    maxRetries: 3,
    timeout: 60,
    streaming: true
};

export interface AIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
}
