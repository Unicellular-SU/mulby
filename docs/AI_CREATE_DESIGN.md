# InTools CLI AI 插件生成功能设计方案

> `intools create --ai` 详细技术设计文档

---

## 目标

在 `intools-cli` 中集成 AI 能力，让用户通过自然语言描述需求，自动生成完整的插件代码。

## 核心特性

| 特性 | 说明 |
|------|------|
| 多服务商支持 | OpenAI / Claude / DeepSeek / 自定义 API |
| 用户可配置 | API 地址、Key、模型选择 |
| 分批生成 | 每个文件独立生成，避免 token 限制 |
| 会话持久化 | 保存进度，支持断点续传 |
| 流式输出 | 实时显示生成进度，适当压缩显示，防止控制台有大量代码 |
| 错误处理 | 自动重试、优雅降级 |
| Tool Use | 使用 Function Calling 实现文件操作 |

---

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                     intools create --ai                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │   Config   │  │  Session   │  │     AI     │  │    File    │ │
│  │  Manager   │  │  Manager   │  │   Service  │  │   Writer   │ │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘ │
│        │               │               │               │        │
│        ▼               ▼               ▼               ▼        │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ ~/.intools │  │ ~/.intools │  │  OpenAI/   │  │  plugins/  │ │
│  │ /config    │  │ /sessions  │  │  Claude/   │  │  {name}/   │ │
│  │ .json      │  │ /*.json    │  │  DeepSeek  │  │  *.ts/css  │ │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 模块设计

### 1. 配置管理 (ConfigManager)

#### 配置文件位置
```
~/.intools/config.json
```

#### 配置结构
```typescript
interface AIConfig {
  // 服务商配置
  provider: 'openai' | 'claude' | 'deepseek' | 'custom';
  
  // API 配置
  apiKey: string;          // 加密存储
  apiEndpoint?: string;    // 自定义端点
  model?: string;          // 模型选择
  
  // 高级配置
  maxRetries?: number;     // 最大重试次数，默认 3
  timeout?: number;        // 超时时间（秒），默认 60
  streaming?: boolean;     // 是否流式输出，默认 true
}

interface GlobalConfig {
  ai?: AIConfig;
  // 其他全局配置...
}
```

#### 预设服务商
```typescript
const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    defaultModel: 'gpt-4o'
  },
  claude: {
    name: 'Claude (Anthropic)',
    endpoint: 'https://api.anthropic.com/v1/messages',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
    defaultModel: 'claude-3-5-sonnet-20241022'
  },
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    models: ['deepseek-chat', 'deepseek-coder'],
    defaultModel: 'deepseek-chat'
  },
  custom: {
    name: '自定义',
    endpoint: '',  // 用户配置
    models: [],
    defaultModel: ''
  }
};
```

#
### 2.1 核心架构调整：从 "Plan -> Batch" 到 "Scaffold -> ReAct Loop"

为了解决全量生成的不稳定性、上下文限制以及难以交互纠错的问题，我们将架构调整为 **"脚手架 + 交互式智能体 (Agent)"** 模式。

#### 新流程图

```mermaid
graph TD
    A[User Input: intools create my-plugin --ai] --> B{Project Exists?}
    B -- No --> C[Scaffold: Deterministic Templates]
    B -- Yes --> D[Read Existing Context]
    C --> D
    D --> E[Init AI Session (Persistent)]
    E --> F[Start Interactive Agent (ReAct Loop)]

    subgraph ReAct_Loop [Interactive Generation Loop]
        F --> G{AI Thinking...}
        G --> H[AI Decides Action (Call Tool)]

        H -- read_file --> I[Read Content]
        H -- write_file --> J[Write/Modify File]
        H -- run_command --> K[Run Shell Cmd]
        H -- ask_user --> L[Ask for Info]
        H -- finish --> O[Task Completed]

        I --> M[Return Result to AI]
        J --> M
        K --> M
        L --> N{User Feedback}
        N -- Answer/Approve --> M
        
        O --> P{User Action}
        P -- Exit --> Q[End Session]
        P -- Continue --> R[Input New Requirement]
        R --> M
        
        M --> G
    end
```

### 2.2 核心模块重构

#### 2. `AIAgent` (重构成 `AIAgent`)
不再是一次性规划所有文件，而是作为一个**有状态的智能体**。

*   **状态机**: `Idle` -> `Thinking` -> `Executing` -> `WaitingForUser` -> `Completed`
*   **上下文管理**: 动态维护 `ConversationHistory`。不再一次性加载所有文件，而是按需 `read_file`，或者由用户通过指令提供。
*   **工具箱 (Tools)**:
    *   `read_file(path)`: 读取文件内容。
    *   `write_file(path, content)`: 创建或全量覆盖文件。
    *   `run_command(cmd)`: 执行 shell 命令 (需用户确认，如 `npm install`)。
    *   `ask_user(question)`: 主动询问用户更多信息。
    *   `finish(summary)`: 任务完成。

#### 3. `SessionManager` (会话持久化)
确保用户可以随时中断、恢复、回溯。

*   **存储路径**: `~/.intools/sessions/<session_id>.json`
*   **存储内容**:
    *   `history`: 完整的对话历史 (User, Assistant, Tool Outputs)。
    *   `variables`: 提取出的关键信息 (如插件名、主要功能描述)。
    *   `status`: 当前状态 (`generating`, `completed`, `failed`)。
*   **新增命令**:
    *   `intools ai-session list`: 列出历史会话。
    *   `intools ai-session resume <id>`: 恢复某个会话。
    *   `intools create --continue`: 尝试恢复当前目录下的最近会话。

### 3. 系统提示词 (System Prompt) 优化

**Role**: InTools 插件开发专家 (Interactive Agent)

**核心指令**:
1.  **脚手架优先**: 你是在一个**已初始化**的 React 项目中工作。我们已经为你生成了核心文件（`package.json`, `manifest.json`, `vite.config.ts`, `src/ui/App.tsx` 等）。
2.  **增量行动**: 这是一个 ReAct 循环。不要一次性输出所有代码。每次只专注解决一个子问题。
3.  **主动探索**: 如果你不确定某个文件的内容，先调用 `read_file` 查看，不要瞎猜。
4.  **模块化**: 始终将代码拆分为小的组件或模块，放在 `src/ui/components` 或 `src/lib` 下。

---

## 3. 详细实现方案

### 3.1 命令行交互 (CLI UX)

用户体验将更像是一个聊天界面，而不仅仅是进度条。

```bash
$ intools create encode_helper --ai

🚀 [System] 初始化 React 脚手架... 完成。
🤖 [AI]    你好！我已经准备好开发环境了。你希望这个 "encode_helper" 具体包含哪些功能？
You: 支持 Base64, URL 编码，还有时间戳转换。

🤖 [AI]    收到。我建议我们将这些功能拆分为 tabs。
          1. Base64 转换器
          2. URL 编解码
          3. 时间戳转换
          
          我将先安装 UI 组件库 (antd 或其他)，然后逐个实现。可以吗？
You: 好的，用原生 CSS 就行，不要太大。

🤖 [AI]    好的，使用原生 CSS。
          [Action] 创建 src/ui/components/Base64Encoder.tsx
          ...
          [Action] 修改 src/ui/App.tsx 引入组件
          ...
          
          ✨ 基础功能已生成。你可以运行 `npm run dev` 查看。还需要添加其他功能吗？
You: (Ctrl+C 退出)
```

### 3.2 错误处理与纠正 (Human-in-the-loop)

*   **工具执行错误**: 如果 `write_file` 失败（如权限问题），将错误信息回传给 AI，AI 可以选择重试或询问用户。
*   **生成内容错误**: 用户在 CLI 中看到 AI 的计划或生成结果后，可以直接输入自然语言进行修正。
    *   *用户*: "刚才的 Base64 组件导入路径错了。"
    *   *AI*: "抱歉，我将读取文件并修正导入路径。" -> `read_file` -> `write_file`。

### 3.3 上下文压缩 (Context Compaction)
为了避免长对话导致的 Token 溢出：
*   **定期摘要**: 每进行 N 轮对话，触发一次后台的 "Summary" 任务，将之前的细节压缩为一段摘要。
*   **滑动窗口**: 只保留最近 K 条消息的详细内容，更早的消息使用摘要替代。

---

## 4. 验证与测试步骤

1.  **基础脚手架验证**: 运行 `intools create test --ai`，确认是否先生成了标准 React 模板。
2.  **ReAct 循环验证**:
    *   输入需求。
    *   观察 AI 是否分步调用 `write_file`。
    *   观察 AI 是否在修改前正确读取了 `package.json` 等文件。
3.  **中断恢复验证**:
    *   在生成过程中 Ctrl+C。
    *   运行 `intools create --continue` 或 `intools ai-session resume`。
    *   确认上下文是否接续。
4.  **错误纠正验证**:
    *   人为造成生成错误（或指出错误）。
    *   指令 AI 修正。
    *   确认 AI 是否生成了 Patch 或重新写入正确文件。

### 3. AI 服务 (AIService)

#### 接口抽象
```typescript
interface AIService {
  // 基础对话
  chat(messages: Message[], options?: ChatOptions): Promise<string>;
  
  // 流式对话
  chatStream(
    messages: Message[], 
    onChunk: (chunk: string) => void,
    options?: ChatOptions
  ): Promise<string>;
  
  // Tool Use（Function Calling）
  chatWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    onToolCall: (tool: ToolCall) => Promise<ToolResult>
  ): Promise<string>;
}

interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}
```

#### 工具定义（Function Calling）
```typescript
const PLUGIN_GENERATION_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'plan_files',
      description: '规划需要生成的文件列表',
      parameters: {
        type: 'object',
        properties: {
          pluginName: { type: 'string', description: '插件名称（英文）' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'number' }
              }
            }
          },
          dependencies: { type: 'array', items: { type: 'string' } },
          devDependencies: { type: 'array', items: { type: 'string' } }
        },
        required: ['pluginName', 'files']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '创建或写入文件',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件相对路径' },
          content: { type: 'string', description: '文件内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: '向用户提问以获取更多信息',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '问题内容' },
          options: { 
            type: 'array', 
            items: { type: 'string' },
            description: '可选项（如果是选择题）'
          }
        },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete',
      description: '标记生成完成',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '生成总结' }
        },
        required: ['summary']
      }
    }
  }
];
```

---

### 4. 文件写入器 (FileWriter)

#### 核心功能
```typescript
interface FileWriter {
  // 写入单个文件
  writeFile(basePath: string, relativePath: string, content: string): Promise<void>;
  
  // 批量写入
  writeFiles(basePath: string, files: { path: string; content: string }[]): Promise<void>;
  
  // 原子写入（先写临时文件，成功后移动）
  atomicWrite(path: string, content: string): Promise<void>;
  
  // 回滚（删除已创建的文件）
  rollback(basePath: string, createdFiles: string[]): Promise<void>;
}
```

#### 安全检查
```typescript
function validateFilePath(basePath: string, relativePath: string): boolean {
  const fullPath = path.resolve(basePath, relativePath);
  
  // 防止路径遍历攻击
  if (!fullPath.startsWith(path.resolve(basePath))) {
    throw new Error(`非法路径: ${relativePath}`);
  }
  
  // 只允许特定文件类型
  const ext = path.extname(relativePath);
  const allowedExtensions = [
    '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs',
    '.json', '.css', '.scss', '.html', '.md', '.txt',
    '.png', '.jpg', '.svg', '.ico'
  ];
  
  if (!allowedExtensions.includes(ext) && !relativePath.includes('.')) {
    throw new Error(`不支持的文件类型: ${ext}`);
  }
  
  return true;
}
```

---

### 5. 分批生成策略

#### 生成顺序
```typescript
const FILE_GENERATION_ORDER = [
  // 第一批：核心配置
  { priority: 1, files: ['manifest.json', 'package.json'] },
  
  // 第二批：类型定义
  { priority: 2, files: ['src/types/*.d.ts', 'src/types/*.ts'] },
  
  // 第三批：后端
  { priority: 3, files: ['src/main.ts'] },
  
  // 第四批：UI 主体
  { priority: 4, files: ['src/ui/App.tsx', 'src/ui/main.tsx'] },
  
  // 第五批：样式和组件
  { priority: 5, files: ['src/ui/styles.css', 'src/ui/components/*.tsx'] },
  
  // 第六批：Hooks 和工具
  { priority: 6, files: ['src/ui/hooks/*.ts', 'src/ui/utils/*.ts'] },
  
  // 第七批：Preload（如需要）
  { priority: 7, files: ['preload.cjs'] },
  
  // 最后：文档
  { priority: 8, files: ['README.md'] }
];
```

#### 上下文传递
```typescript
async function generateFilesInBatches(session: GenerationSession) {
  const { plan, targetDir, conversationHistory } = session;
  
  // 按优先级排序
  const sortedFiles = plan.files.sort((a, b) => a.priority - b.priority);
  
  for (const file of sortedFiles) {
    // 跳过已完成的文件
    if (session.completedFiles.includes(file.path)) continue;
    
    session.currentFile = file.path;
    await saveSession(session);
    
    // 构建上下文
    const context = buildContext(session, file);
    
    // 生成单个文件
    const content = await generateSingleFile(context, file);
    
    // 写入文件
    await fileWriter.writeFile(targetDir, file.path, content);
    
    // 更新进度
    session.completedFiles.push(file.path);
    session.currentFile = undefined;
    await saveSession(session);
    
    console.log(chalk.green(`  ✓ ${file.path}`));
  }
}

function buildContext(session: GenerationSession, currentFile: FileToGenerate): string {
  const completedFilesContent = session.completedFiles
    .map(f => {
      const content = fs.readFileSync(path.join(session.targetDir, f), 'utf-8');
      return `### ${f}\n\`\`\`\n${content}\n\`\`\``;
    })
    .join('\n\n');
  
  return `
# 已生成的文件

${completedFilesContent}

# 当前需要生成

文件: ${currentFile.path}
描述: ${currentFile.description}

请生成此文件的完整内容，确保与已生成的文件保持一致性。
`;
}
```

---

### 6. 错误处理与重试

#### 重试策略
```typescript
interface RetryConfig {
  maxRetries: number;        // 最大重试次数
  initialDelay: number;      // 初始延迟（毫秒）
  maxDelay: number;          // 最大延迟
  backoffMultiplier: number; // 退避倍数
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2
};

async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error;
  let delay = config.initialDelay;
  
  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // 不重试的错误类型
      if (error.status === 401) {
        throw new Error('API Key 无效，请检查配置');
      }
      if (error.status === 403) {
        throw new Error('API 访问被拒绝，请检查权限');
      }
      
      // 最后一次尝试
      if (attempt === config.maxRetries + 1) break;
      
      // 限流处理
      if (error.status === 429) {
        const retryAfter = error.headers?.['retry-after'];
        delay = retryAfter ? parseInt(retryAfter) * 1000 : delay * 2;
      }
      
      console.log(chalk.yellow(`⚠️ 第 ${attempt} 次尝试失败，${delay/1000}s 后重试...`));
      await sleep(delay);
      
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
    }
  }
  
  throw lastError;
}
```

#### 响应完整性验证
```typescript
function validateResponse(response: string, expectedFile: string): ValidationResult {
  const issues: string[] = [];
  
  // 检查代码块闭合
  const codeBlockCount = (response.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    issues.push('代码块未闭合');
  }
  
  // 检查 JSON 语法（如果是 JSON 文件）
  if (expectedFile.endsWith('.json')) {
    try {
      JSON.parse(extractCodeContent(response));
    } catch {
      issues.push('JSON 语法错误');
    }
  }
  
  // 检查 TypeScript 基本语法
  if (expectedFile.endsWith('.ts') || expectedFile.endsWith('.tsx')) {
    const content = extractCodeContent(response);
    if (content.includes('// TODO:') || content.includes('// ...')) {
      issues.push('代码不完整，包含占位符');
    }
  }
  
  // 检查明显的截断
  if (response.endsWith('```') && response.split('```').length === 2) {
    issues.push('响应可能被截断');
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}
```

---

### 7. 用户中断处理

```typescript
let currentSession: GenerationSession | null = null;// 监听 SIGINT (Ctrl+C)
process.on('SIGINT', handleInterrupt);
process.on('SIGTERM', handleInterrupt);

async function handleInterrupt() {
  console.log('\n\n' + chalk.yellow('⚠️ 检测到中断信号'));
  
  if (currentSession && currentSession.status !== 'completed') {
    console.log(chalk.blue('💾 正在保存当前进度...'));
    
    currentSession.status = 'failed';
    currentSession.error = {
      message: '用户中断',
      file: currentSession.currentFile,
      retryCount: 0
    };
    
    await saveSession(currentSession);
    
    console.log(chalk.green(`✓ 进度已保存`));
    console.log();
    console.log(chalk.gray(`会话 ID: ${currentSession.id}`));
    console.log(chalk.gray(`已完成: ${currentSession.completedFiles.length}/${currentSession.plan.files.length} 文件`));
    console.log();
    console.log('恢复命令:');
    console.log(chalk.cyan(`  intools create --ai --resume ${currentSession.id}`));
    console.log();
    console.log('或恢复最近会话:');
    console.log(chalk.cyan(`  intools create --ai --resume`));
  }
  
  process.exit(0);
}
```

---

## CLI 命令设计

### 主命令

```bash
intools create <name> --ai [options]
```

#### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--ai` | 启用 AI 辅助创建 | - |
| `--resume [sessionId]` | 恢复会话 | 最近会话 |
| `--provider <provider>` | 指定服务商 | 配置值 |
| `--model <model>` | 指定模型 | 配置值 |
| `--no-stream` | 禁用流式输出 | - |
| `--dry-run` | 只显示计划，不生成 | - |

```
packages/intools-cli/src/
├── commands/
│   ├── create/
│   │   ├── index.ts          # 修改：添加 --ai 选项
│   │   ├── ai-create.ts      # [新增] AI 创建主入口
│   │   └── ...
│   ├── config.ts             # [新增] 配置命令
│   └── ai-session.ts         # [新增] 会话管理命令
├── services/
│   ├── ai/
│   │   ├── index.ts          # [新增] AI 服务入口
│   │   ├── providers/
│   │   │   ├── base.ts       # [新增] 抽象基类
│   │   │   ├── openai.ts     # [新增] OpenAI 实现
│   │   │   ├── claude.ts     # [新增] Claude 实现
│   │   │   └── deepseek.ts   # [新增] DeepSeek 实现
│   │   ├── tools.ts          # [新增] Function Calling 工具定义
│   │   └── prompts.ts        # [新增] 系统提示词
│   ├── config-manager.ts     # [新增] 配置管理
│   ├── session-manager.ts    # [新增] 会话管理
│   └── file-writer.ts        # [新增] 文件写入器
├── types/
│   └── ai.ts                 # [新增] AI 相关类型定义
└── index.ts                  # 修改：注册新命令
```

---

## 实现计划

### Phase 1: 基础设施 (3-4 小时)

1. 配置管理系统
   - `ConfigManager` 类实现
   - `intools config` 命令
   - API Key 安全存储

2. AI 服务抽象
   - `AIService` 接口
   - OpenAI/Claude/DeepSeek 适配器
   - 流式响应处理

### Phase 2: 核心功能 (4-5 小时)

3. 会话管理
   - `SessionManager` 类实现
   - 会话持久化
   - 断点续传逻辑

4. 文件生成
   - `FileWriter` 类实现
   - 分批生成策略
   - Tool Use 集成

### Phase 3: 错误处理 (2-3 小时)

5. 健壮性
   - 重试机制
   - 响应验证
   - 用户中断处理

### Phase 4: CLI 集成 (2 小时)

6. 命令行
   - 修改 `create` 命令
   - 添加 `config` 命令
   - 添加 `ai-session` 命令

### Phase 5: 测试与文档 (2 小时)

7. 完善
   - 端到端测试
   - 用户文档
   - 错误消息优化

---

## 验证方案

### 自动化测试

由于此功能涉及 AI API 调用和文件系统操作，主要依赖手动测试和模拟测试。

### 手动测试用例

#### 测试 1：首次配置
```bash
# 1. 确保没有配置文件
rm -rf ~/.intools/config.json

# 2. 运行命令，应提示配置
intools create test-plugin --ai

# 3. 验证：
#    - 交互式选择服务商
#    - 输入 API Key
#    - 配置保存成功
```

#### 测试 2：正常生成
```bash
# 1. 创建简单插件
intools create hello-world --ai

# 2. 输入描述："一个显示 Hello World 的简单插件"

# 3. 验证：
#    - 生成计划显示正确
#    - 所有文件创建成功
#    - 文件内容符合预期
#    - 可以正常运行：cd hello-world && npm install && npm run dev
```

#### 测试 3：断点续传
```bash
# 1. 开始生成
intools create complex-plugin --ai

# 2. 等待生成 2-3 个文件后按 Ctrl+C

# 3. 验证进度保存
cat ~/.intools/ai-sessions/*.json

# 4. 恢复会话
intools create --ai --resume

# 5. 验证：
#    - 从中断处继续
#    - 最终生成完整
```

#### 测试 4：错误处理
```bash
# 1. 配置错误的 API Key
intools config set ai.apiKey invalid-key

# 2. 尝试创建
intools create test --ai

# 3. 验证：
#    - 显示清晰的错误消息
#    - 提示修复方法
```

---

## User Review Required

> [!IMPORTANT]
> 以下决策点需要用户确认：

**1. 默认服务商选择**
- 推荐 DeepSeek（性价比高）？还是 OpenAI（兼容性好）？

**2. API Key 存储方式**
- 方案 A：明文存储在配置文件（简单）
- 方案 B：使用系统 Keychain 加密存储（安全但复杂）

**3. 会话保留策略**
- 完成的会话保留多久？7 天？永久？
- 失败的会话是否自动清理？

**4. 付费估算提示**
- 是否在开始前估算 API 调用成本？
- 是否在生成完成后显示实际花费？

---

请确认以上设计方案，如有修改意见请告知，确认后我将开始实现。
