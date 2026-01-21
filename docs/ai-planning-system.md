# AI 开发 Planning 系统设计方案

## 概述

本文档描述了为 InTools CLI 设计的 AI Planning 系统，该系统实现了"Plan First, Code Later"的开发模式，通过任务分解、进度跟踪和持续可见的 todo list，提升 AI 辅助开发的效率和可控性。

## 研究背景

### 1. 分离规划与执行
[Tigran Tech](https://tigran.tech/ai-assisted-development-workflow-codex-claude-code/) 和 [Nathan Onn](https://www.nathanonn.com/the-codex-claude-code-workflow-how-i-plan-with-gpt-5-and-execute-with-claude-code/) 的核心洞察：
> "Stop treating AI as a single tool that does everything. Split the responsibilities."

**关键模式**：
- **Codex/GPT**: 用于规划和任务分解
- **Claude Code**: 用于执行实现

### 2. 四阶段工作流
[Humane Interface](https://humaineinterface.substack.com/p/i-mastered-the-claude-code-workflow) 提出的最佳实践：
```
Research → Plan → Implement → Validate
```

### 3. Plan Mode 的重要性
[Steve Kinney](https://stevekinney.com/courses/ai-development/claude-code-plan-mode) 和 [Cursor](https://cursor.com/blog/agent-best-practices) 强调：
> "Planning forces clear thinking about what you're building and gives the agent context."

**Plan Mode 特点**：
- 只生成计划，不写代码
- 用户审核后再执行
- 避免 AI 过早跳入实现

### 4. 任务分解最佳实践
[Patronus AI](https://www.patronus.ai/ai-agent-development/agentic-workflow) 和 [Agiflow](https://agiflow.io/docs/features/spec-development) 的建议：
- **静态分解**：预定义的任务结构
- **动态分解**：根据上下文调整
- **清晰的验收标准**：每个任务都有明确的完成标准

### 5. 持久化和可见性
[Todo MCP](https://todo-mcp.org/) 指出的痛点：
> "The agent continues working but has no memory of the decisions you made together."

**解决方案**：
- 持久化 todo list 到文件
- 在 CLI 界面持续显示
- 支持跨会话恢复

---

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    用户输入任务                          │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Planning Mode (规划模式)                    │
│  - AI 分析任务复杂度                                     │
│  - 生成任务分解树                                        │
│  - 估算每个子任务的工作量                                │
│  - 识别依赖关系                                          │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│           用户审核 & 确认 (Approval Gate)                │
│  - 显示完整的 todo list                                  │
│  - 用户可以修改/添加/删除任务                            │
│  - 确认后进入执行模式                                    │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│            Execution Mode (执行模式)                     │
│  - 按顺序执行任务                                        │
│  - 实时更新任务状态                                      │
│  - 持续显示进度                                          │
│  - 支持暂停/恢复                                         │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Validation (验证阶段)                       │
│  - 运行测试                                              │
│  - 检查代码质量                                          │
│  - 生成总结报告                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 数据结构设计

### Task（任务）
```typescript
interface Task {
    id: string;                    // 唯一标识
    title: string;                 // 任务标题（简短）
    description: string;           // 详细描述
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
    priority: 'high' | 'medium' | 'low';
    estimatedTokens?: number;      // 预估 token 消耗
    dependencies: string[];        // 依赖的任务 ID
    acceptanceCriteria: string[];  // 验收标准
    files: string[];               // 涉及的文件
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    error?: string;                // 失败原因
}
```

### TaskPlan（任务计划）
```typescript
interface TaskPlan {
    id: string;                    // 计划 ID
    goal: string;                  // 总体目标
    tasks: Task[];                 // 任务列表
    totalEstimatedTokens?: number; // 总预估 token
    createdAt: Date;
    updatedAt: Date;
    status: 'draft' | 'approved' | 'in_progress' | 'completed' | 'failed';
    currentTaskIndex: number;      // 当前执行到第几个任务
}
```

### TaskAnalysis（任务分析）
```typescript
interface TaskAnalysis {
    complexity: 'simple' | 'medium' | 'complex';  // 复杂度
    estimatedSteps: number;                        // 预估步骤数
    requiredFiles: string[];                       // 涉及的文件
    dependencies: string[];                        // 依赖关系
    risks: string[];                               // 潜在风险
    shouldPlan: boolean;                           // 是否需要规划
}
```

---

## UI 设计

### 折叠面板（推荐方案）

```
┌────────────────────────────────────────────────────────────┐
│  📋 Task Plan (1/5 completed) [展开/折叠]                   │
│  ├─ ✅ 1. 分析需求和设计数据库模型                          │
│  ├─ 🔄 2. 实现 API 端点 (当前)                             │
│  ├─ ⏸️  3. 实现前端登录表单                                 │
│  ├─ ⏸️  4. 编写单元测试                                     │
│  └─ ⏸️  5. 部署到测试环境                                   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  User: 实现用户登录功能                                     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 状态图标
- ✅ `completed` - 已完成
- 🔄 `in_progress` - 进行中
- ⏸️ `pending` - 等待中
- ❌ `failed` - 失败
- ⏭️ `skipped` - 已跳过

### 详细视图
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 任务计划：实现用户登录功能
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏸️  1. 分析需求和设计数据库模型
    描述: 设计 User 表结构，包含 email, password_hash, created_at 等字段
    验收标准:
      • User 表创建完成
      • 字段类型正确
      • 添加必要的索引
    涉及文件:
      • src/models/user.ts
      • migrations/001_create_users.sql
    优先级: 高

⏸️  2. 实现 API 端点
    描述: 创建 POST /api/auth/login 端点，验证用户凭证
    验收标准:
      • 端点返回 JWT token
      • 密码验证正确
      • 错误处理完善
    涉及文件:
      • src/routes/auth.ts
      • src/controllers/auth.ts
    依赖: 任务 1
    优先级: 高

⏸️  3. 实现前端登录表单
    描述: 创建 LoginForm 组件，集成表单验证
    涉及文件:
      • src/components/LoginForm.tsx
    优先级: 中

⏸️  4. 编写单元测试
    描述: 为 API 端点和前端组件编写测试
    涉及文件:
      • tests/auth.test.ts
      • tests/LoginForm.test.tsx
    依赖: 任务 2, 3
    优先级: 中

⏸️  5. 部署到测试环境
    描述: 运行数据库迁移并部署代码
    依赖: 任务 4
    优先级: 低

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
预估总工作量: ~2000 tokens
状态: 等待审核

是否开始执行？(yes/no/modify)
```

---

## 交互流程

### 流程 1: 自动检测并创建计划

```
User: 实现用户登录功能，包括前后端和测试

AI: 检测到这是一个中等复杂度的任务，让我先为你制定一个计划。

[分析中...]

我已经为你生成了一个包含 5 个步骤的计划：

[显示计划详情...]

是否开始执行？
  [y] 是，开始执行
  [n] 否，取消
  [m] 修改计划
  [s] 保存计划稍后执行
```

### 流程 2: 手动触发规划

```
User: /plan 实现用户登录功能

AI: 进入规划模式...

[生成计划...]

计划已创建，是否开始执行？
```

### 流程 3: 执行任务

```
User: yes

AI: 好的，开始执行任务计划。

━━━━━━━━━━━━━━━━
📋 进度: 0/5 | 🔄 正在执行任务 1
━━━━━━━━━━━━━━━━

🔄 任务 1: 分析需求和设计数据库模型

[AI 开始工作...]

✅ 已创建 src/models/user.ts
✅ 已创建 migrations/001_create_users.sql

任务 1 完成！

━━━━━━━━━━━━━━━━
📋 进度: 1/5 | 🔄 正在执行任务 2
━━━━━━━━━━━━━━━━

🔄 任务 2: 实现 API 端点

[继续执行...]
```

### 流程 4: 查看进度

```
User: /progress

AI: 当前任务进度：

━━━━━━━━━━━━━━━━
📋 任务计划：实现用户登录功能
━━━━━━━━━━━━━━━━
✅ 1. 分析需求和设计数据库模型 (已完成)
✅ 2. 实现 API 端点 (已完成)
🔄 3. 实现前端登录表单 (进行中 - 60%)
⏸️  4. 编写单元测试 (等待中)
⏸️  5. 部署到测试环境 (等待中)

总进度: 2.6/5 (52%)
已用时间: 15 分钟
预估剩余: 13 分钟
━━━━━━━━━━━━━━━━
```

### 流程 5: 修改计划

```
User: /plan edit

AI: 当前计划：

1. 分析需求和设计数据库模型
2. 实现 API 端点
3. 实现前端登录表单
4. 编写单元测试
5. 部署到测试环境

请选择操作：
  [a] 添加任务
  [d] 删除任务
  [m] 修改任务
  [r] 重新排序
  [c] 取消

User: a

AI: 请描述要添加的任务：

User: 添加日志记录功能

AI: 好的，我将添加任务：
  标题: 添加日志记录功能
  位置: 在任务 2 之后
  依赖: 任务 2

确认添加？(yes/no)
```

---

## 命令系统

### 规划相关命令
```bash
/plan                  # 为当前任务创建计划
/plan show             # 显示当前计划
/plan edit             # 编辑计划
/plan resume           # 恢复上次计划
/plan clear            # 清除计划
/plan save [name]      # 保存计划模板
/plan load [name]      # 加载计划模板
```

### 任务控制命令
```bash
/task next             # 跳到下一个任务
/task skip [id]        # 跳过某个任务
/task retry [id]       # 重试失败的任务
/task add              # 添加新任务
/task remove [id]      # 删除任务
/task detail [id]      # 查看任务详情
```

### 进度查询命令
```bash
/progress              # 显示进度概览
/progress detail       # 显示详细进度
/progress export       # 导出进度报告
```

---

## 持久化机制

### 目录结构
```
.intools/
├── sessions/
│   └── {session-id}/
│       ├── conversation.json    # 对话历史
│       ├── plan.json            # 当前任务计划
│       └── progress.json        # 执行进度
├── plans/
│   ├── {plan-id}.json           # 独立的计划文件
│   └── templates/               # 计划模板
│       ├── feature.json
│       ├── bugfix.json
│       └── refactor.json
└── reports/
    └── {date}-summary.md        # 每日总结报告
```

### Plan 文件格式
```json
{
  "id": "plan-20260121-001",
  "goal": "实现用户登录功能",
  "createdAt": "2026-01-21T10:00:00Z",
  "updatedAt": "2026-01-21T10:30:00Z",
  "status": "in_progress",
  "currentTaskIndex": 1,
  "totalEstimatedTokens": 2000,
  "tasks": [
    {
      "id": "task-1",
      "title": "分析需求和设计数据库模型",
      "description": "设计 User 表结构，包含 email, password_hash, created_at 等字段",
      "status": "completed",
      "priority": "high",
      "dependencies": [],
      "acceptanceCriteria": [
        "User 表创建完成",
        "字段类型正确",
        "添加必要的索引"
      ],
      "files": ["src/models/user.ts", "migrations/001_create_users.sql"],
      "createdAt": "2026-01-21T10:00:00Z",
      "startedAt": "2026-01-21T10:05:00Z",
      "completedAt": "2026-01-21T10:15:00Z"
    },
    {
      "id": "task-2",
      "title": "实现 API 端点",
      "description": "创建 POST /api/auth/login 端点，验证用户凭证",
      "status": "in_progress",
      "priority": "high",
      "dependencies": ["task-1"],
      "acceptanceCriteria": [
        "端点返回 JWT token",
        "密码验证正确",
        "错误处理完善"
      ],
      "files": ["src/routes/auth.ts", "src/controllers/auth.ts"],
      "createdAt": "2026-01-21T10:00:00Z",
      "startedAt": "2026-01-21T10:15:00Z"
    }
  ]
}
```

---

## 智能特性

### 1. 自动检测任务复杂度
```typescript
function analyzeTask(userInput: string): TaskAnalysis {
    const indicators = {
        simple: ['修复', '更新', '添加注释', '重命名', '删除'],
        medium: ['实现', '添加功能', '重构', '优化'],
        complex: ['设计', '架构', '迁移', '集成', '重写']
    };

    // 检测关键词
    let complexity: 'simple' | 'medium' | 'complex' = 'simple';

    // 检测长度（字数）
    const wordCount = userInput.split(/\s+/).length;
    if (wordCount > 50) complexity = 'complex';
    else if (wordCount > 20) complexity = 'medium';

    // 检测是否包含多个动作
    const actionWords = ['实现', '添加', '修改', '删除', '测试', '部署'];
    const actionCount = actionWords.filter(w => userInput.includes(w)).length;
    if (actionCount >= 3) complexity = 'complex';
    else if (actionCount >= 2) complexity = 'medium';

    return {
        complexity,
        estimatedSteps: complexity === 'simple' ? 1 : complexity === 'medium' ? 3-5 : 5-10,
        shouldPlan: complexity !== 'simple'
    };
}
```

### 2. 依赖关系管理
```typescript
class DependencyManager {
    // 检查任务是否可以执行
    canExecute(task: Task, completedTasks: Set<string>): boolean {
        return task.dependencies.every(depId => completedTasks.has(depId));
    }

    // 获取可并行执行的任务
    getParallelTasks(tasks: Task[], completedTasks: Set<string>): Task[] {
        return tasks.filter(t =>
            t.status === 'pending' &&
            this.canExecute(t, completedTasks)
        );
    }

    // 检测循环依赖
    detectCyclicDependency(tasks: Task[]): boolean {
        // 使用拓扑排序检测
    }
}
```

### 3. 动态调整计划
```typescript
class PlanAdapter {
    // 任务失败时调整计划
    async onTaskFailed(task: Task, error: string): Promise<Task[]> {
        // 1. 分析失败原因
        const analysis = await this.analyzeFailure(task, error);

        // 2. 生成修复任务
        const fixTask: Task = {
            id: `fix-${task.id}`,
            title: `修复：${task.title}`,
            description: `解决错误：${error}`,
            status: 'pending',
            priority: 'high',
            dependencies: []
        };

        // 3. 调整后续任务
        const adjustedTasks = this.adjustDependentTasks(task);

        return [fixTask, ...adjustedTasks];
    }
}
```

### 4. 进度估算
```typescript
class ProgressEstimator {
    // 估算剩余时间
    estimateRemainingTime(plan: TaskPlan): number {
        const completedTasks = plan.tasks.filter(t => t.status === 'completed');
        const avgTimePerTask = this.calculateAverageTime(completedTasks);
        const remainingTasks = plan.tasks.filter(t => t.status !== 'completed');

        return avgTimePerTask * remainingTasks.length;
    }

    // 计算完成百分比
    calculateProgress(plan: TaskPlan): number {
        const total = plan.tasks.length;
        const completed = plan.tasks.filter(t => t.status === 'completed').length;
        const inProgress = plan.tasks.filter(t => t.status === 'in_progress').length;

        // 进行中的任务算 0.5
        return ((completed + inProgress * 0.5) / total) * 100;
    }
}
```

---

## AI Prompt 设计

### 任务分解 Prompt
```
你是一个专业的软件开发项目经理。用户给你一个开发任务，你需要将其分解为具体的、可执行的子任务。

用户任务：{user_input}

当前项目上下文：
- 项目类型：{project_type}
- 技术栈：{tech_stack}
- 现有文件：{file_list}

请按照以下格式生成任务计划：

```json
{
  "goal": "任务的总体目标（一句话概括）",
  "tasks": [
    {
      "title": "任务标题（简短，动词开头）",
      "description": "详细描述（包含具体要做什么）",
      "priority": "high/medium/low",
      "dependencies": ["依赖的任务 ID"],
      "acceptanceCriteria": [
        "验收标准 1",
        "验收标准 2"
      ],
      "files": ["涉及的文件路径"]
    }
  ]
}
```

要求：
1. 任务要具体、可执行、可验证
2. 每个任务应该在 30 分钟内完成
3. 合理安排依赖关系
4. 优先级要合理（核心功能 high，辅助功能 medium，优化 low）
5. 验收标准要明确、可测试
6. 文件路径要准确
```

### 任务执行 Prompt
```
你现在要执行以下任务：

任务标题：{task.title}
任务描述：{task.description}
验收标准：
{task.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

涉及文件：
{task.files.map(f => `- ${f}`).join('\n')}

请按照以下步骤执行：
1. 分析任务需求
2. 检查相关文件
3. 实现功能
4. 验证是否满足验收标准
5. 报告完成情况

开始执行...
```

---

## 实施计划

### Phase 1: 核心功能（第 1-2 天）
- ✅ 创建 TaskPlan 数据结构和类型定义
- ✅ 实现 PlanManager 管理器（创建、保存、加载）
- ✅ 实现任务分解 AI prompt
- ✅ 实现基础 UI 显示（折叠面板）
- ✅ 持久化到文件
- ✅ `/plan` 命令

**交付物**：
- `src/types/plan.ts` - 类型定义
- `src/services/plan-manager.ts` - 计划管理器
- `src/ui/components/PlanPanel.tsx` - UI 组件
- `src/services/ai/prompts/planning.md` - AI prompt

### Phase 2: 交互增强（第 3-4 天）
- ✅ 用户审核和修改计划
- ✅ 任务状态实时更新
- ✅ 进度显示和估算
- ✅ `/progress` 命令
- ✅ `/task` 系列命令

**交付物**：
- `src/services/plan-command-handler.ts` - 命令处理器
- 完善的命令系统（/plan, /progress, /task）
- 交互式编辑功能
- 进度跟踪和报告

### Phase 3: 高级特性（第 5-7 天）
- ✅ 依赖关系管理
- ✅ 动态调整计划
- ✅ 跨会话恢复
- ✅ 任务跳过/重试
- ✅ 计划模板系统
- ✅ 进度报告导出

**交付物**：
- `src/services/dependency-manager.ts` - 依赖管理器（循环检测、拓扑排序、关键路径）
- `src/services/plan-adapter.ts` - 动态计划调整器（失败恢复、工作量估算）
- 内置模板系统（feature, bugfix, refactor）
- JSON/Markdown 双格式报告导出

---

## 性能指标

### 用户体验指标
- **规划时间**: < 10 秒（生成计划）
- **响应时间**: < 1 秒（UI 更新）
- **准确率**: > 85%（任务分解准确性）

### 系统性能指标
- **内存占用**: < 50MB（计划数据）
- **文件大小**: < 100KB（单个计划文件）
- **并发支持**: 支持多个计划同时存在

---

## 参考文献

- [Tigran Tech: AI-Assisted Development Workflow](https://tigran.tech/ai-assisted-development-workflow-codex-claude-code/)
- [Nathan Onn: The Codex-Claude Code Workflow](https://www.nathanonn.com/the-codex-claude-code-workflow-how-i-plan-with-gpt-5-and-execute-with-claude-code/)
- [Humane Interface: I Mastered the Claude Code Workflow](https://humaineinterface.substack.com/p/i-mastered-the-claude-code-workflow)
- [Steve Kinney: Claude Code Plan Mode](https://stevekinney.com/courses/ai-development/claude-code-plan-mode)
- [Cursor: Best Practices for Coding with Agents](https://cursor.com/blog/agent-best-practices)
- [Patronus AI: Agentic Workflow Tutorial](https://www.patronus.ai/ai-agent-development/agentic-workflow)
- [Agiflow: AI Native Project Management](https://agiflow.io/docs/features/spec-development)
- [Todo MCP: Never Lose Your CLI Agent's Progress](https://todo-mcp.org/)
- [Developer Toolkit: PRD → Plan → Todo Workflow](https://developertoolkit.ai/en/claude-code/quick-start/prd-workflow/)
- [Alex Kurkin: Research → Plan → Implement Framework](https://www.alexkurkin.com/guides/claude-code-framework)

---

## 更新日志

- **2026-01-21**: Phase 3 完成 - 依赖管理、动态调整、模板系统
- **2026-01-21**: Phase 2 完成 - 交互增强、命令系统
- **2026-01-21**: Phase 1 完成 - 核心功能实现
- **2026-01-21**: 初始版本，定义系统架构和实施计划
