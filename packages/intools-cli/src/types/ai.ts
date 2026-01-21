// 支持的 AI 供应商类型
export type AIProviderType = 'openai' | 'claude' | 'deepseek' | 'gemini' | 'glm' | 'custom';

// 单个供应商配置
export interface AIProviderConfig {
    provider: AIProviderType;
    apiKey: string;
    apiEndpoint?: string;    // 自定义端点
    model?: string;          // 模型选择

    // 高级配置
    maxRetries?: number;     // 最大重试次数，默认 3
    timeout?: number;        // 超时时间（秒），默认 60
    maxTokens?: number;      // 最大输出 token 数
    streaming?: boolean;     // 是否流式输出，默认 true
    enableThinking?: boolean; // 是否启用思考/推理能力 (如 GLM-4.7, DeepSeek R1)
}

// 多供应商配置结构
export interface AIConfig {
    default?: string;        // 默认使用的配置名称
    providers: {
        [name: string]: AIProviderConfig;
    };
}

export interface GlobalConfig {
    ai?: AIConfig;
    [key: string]: any;
}

export const DEFAULT_PROVIDER_CONFIG: Partial<AIProviderConfig> = {
    maxRetries: 3,
    timeout: 60,
    streaming: true
};

// 预设的供应商模型
export const PROVIDER_MODELS: Record<AIProviderType, string[]> = {
    openai: ['gpt-5.1', 'gpt-5.2'],
    claude: ['claude-4-5-sonnet'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    gemini: ['gemini-3-pro-preview'],
    glm: ['glm-4.7'],
    custom: []
};

// 供应商默认端点
export const PROVIDER_ENDPOINTS: Record<AIProviderType, string | undefined> = {
    openai: 'https://api.openai.com/v1',
    claude: undefined,  // 使用 SDK 默认
    deepseek: 'https://api.deepseek.com',
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
    glm: 'https://open.bigmodel.cn/api/paas/v4',
    custom: undefined
};

export interface AIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    reasoning_content?: string;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
}
