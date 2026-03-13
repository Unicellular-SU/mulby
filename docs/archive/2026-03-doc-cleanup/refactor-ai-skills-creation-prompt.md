# 重构 AI Skills 创建模块 — 详细需求说明

## 一、项目背景

Mulby 项目中现有 AI Skills 模块（`src/main/ai/skills/`）负责 AI 创建/管理 Skills 功能。现需**完全重构**该模块中"AI 创建 Skills"的功能和代码，解决当前架构中存在的局限性问题。

---

## 二、核心模块定位（只修改代码，不修改规范）

| 模块 | 路径 | 角色 |
|------|------|------|
| Skills Composer（核心重构对象） | `src/main/ai/skills/composer.ts` | AI 生成 Skill 的编排器，构建 prompt、调用 AI、解析/校验/写入结果 |
| Skills Service | `src/main/ai/skills/service.ts` | Skill 的 CRUD/持久化/resolve/preview，不涉及 AI 生成逻辑 |
| Types | `src/main/ai/skills/types.ts` | AI Skill 创建相关的类型定义 |
| Creator Resources | `src/main/ai/skills/creator-resources.ts` | 加载内置 `resources/skills/skill-creator/` 资源包 |
| Spec Validator | `src/main/ai/skills/spec-validator.ts` | SKILL.md frontmatter/body 的验证与序列化 |
| Runtime Capability Introspection | `src/main/ai/tools/runtime-capability-introspection-tool.ts` | 运行时能力自省工具，告诉 AI 当前有哪些工具/MCP/Skills 可用 |
| 前端页面（重构对象） | `src/renderer/components/AiSkillsSettingsView.tsx` | Skills 管理/AI 创建的用户界面 |
| 内置 Skill Creator 包 | `resources/skills/skill-creator/` | SKILL.md + scripts/ + references/ 构成的创作指南资源包 |
| 共享类型 | `src/shared/types/ai.ts` | `AiSkillMulbyExtensions`、`AiSkillCreateProgressChunk` 等类型定义 |

---

## 三、逐项需求详解

### 需求 1：严格遵守 Agent Skills 官方规范

**官方规范要点**（来源：https://agentskills.io/specification）：

1. **目录结构**：
   ```
   skill-name/
   ├── SKILL.md          # 必需
   ├── scripts/           # 可选 — 可执行脚本（Python/Bash等）
   ├── references/        # 可选 — 参考文档（按需加载到上下文）
   └── assets/            # 可选 — 模板、图片等输出用资源
   ```

2. **SKILL.md 格式**：
   - 必须以 `---` 包裹的 YAML frontmatter 开头
   - **必填字段**：`name`（1-64字符，仅小写字母数字和连字符）、`description`（1-1024字符）
   - **可选字段**：`license`、`compatibility`（1-500字符）、`metadata`（string key-value map）、`allowed-tools`
   - **禁止**在 frontmatter 中放置任何其他字段

3. **渐进式加载（Progressive Disclosure）**：
   - 第1层：metadata（name + description）~100 tokens — 启动时加载
   - 第2层：SKILL.md body < 5000 tokens — 触发时加载
   - 第3层：bundled resources — 按需加载

4. **质量要求**：
   - SKILL.md body 保持在 500 行以内
   - 不创建多余的辅助文件（README.md、CHANGELOG.md 等）
   - 只包含 AI agent 执行任务所需的核心信息

**重构要求**：  
- 生成的每一个 skill 都必须通过 `spec-validator.ts` 的 `validateSkillMarkdown()` 校验
- frontmatter 仅允许官方规范定义的 6 个字段
- 项目扩展字段（mode/triggerPhrases/capabilities/mcpPolicy 等）通过 `metadata` 中 `mulby.*` 前缀 key 编码（见需求 3）

---

### 需求 2：调用内置 `skill-creator` 资源创建 Skills

**当前资源结构**（`resources/skills/skill-creator/`）：
```
skill-creator/
├── SKILL.md               # 18KB 创作指南，包含完整的 6 步创建流程
├── LICENSE.txt
├── scripts/
│   ├── init_skill.py       # 初始化 skill 目录模板
│   ├── package_skill.py    # 打包为 .skill 文件
│   └── quick_validate.py   # 快速校验
├── references/
│   ├── workflows.md        # 工作流设计模式
│   └── output-patterns.md  # 输出模式最佳实践
└── skills/                 # (可能为空/示例)
```

**当前问题（`creator-resources.ts`）**：  
- `extractSkillCreatorSnippet()` 只截取了 SKILL.md 的一个片段（2500 字符），浪费了大量高质量指导内容
- `buildSkillCreatorContext()` 只拼了 references 的前 3000 字符，scripts 只列了文件名

**重构要求**：  
- 将 `skill-creator/SKILL.md` 中的创作流程（Step 1-6）完整地纳入 AI 的 system prompt
- 让 AI 遵循官方推荐的 6 步流程：理解需求 → 规划资源 → 初始化 → 编辑 → 打包 → 迭代
- references 文件（`workflows.md`、`output-patterns.md`）的完整内容作为参考上下文提供
- 当 skill 涉及脚本时，AI 应生成可执行的 scripts（优先使用 `init_skill.py` 初始化模板）

---

### 需求 3：保留 metadataMulby 扩展机制

**metadataMulby 是什么**：  
Mulby 项目对 Agent Skills 官方 `metadata` 字段的扩展约定。因为官方规范仅允许 frontmatter 中使用 `name/description/license/compatibility/metadata/allowed-tools` 这 6 个字段，所以 Mulby 特有的扩展功能（触发模式、触发短语、内部工具权限、MCP 策略等）通过 `metadata` map 中以 `mulby.*` 为前缀的 key 来编码。

**类型定义**（`src/shared/types/ai.ts:180-189`）：
```typescript
interface AiSkillMulbyExtensions {
  mode?: 'manual' | 'auto' | 'both'        // 触发模式
  triggerPhrases?: string[]                 // 触发短语列表
  capabilities?: string[]                   // 请求的 AI 能力（如 shell.exec）
  internalTools?: string[]                  // 内部工具白名单（已废弃，优先用 capabilities）
  mcpPolicy?: AiSkillMcpPolicy              // MCP 策略（允许/阻止的 server/tool）
}
```

**编码方式**（`spec-validator.ts` 中的 `encodeMulbyExtensions()`）：  
将 `AiSkillMulbyExtensions` 序列化为 YAML metadata 中的 `mulby.*` key，例如：
```yaml
metadata:
  mulby.mode: "auto"
  mulby.trigger_phrases: '["翻译","translate"]'
  mulby.capabilities: '["shell.exec"]'
  mulby.mcp_policy: '{"serverIds":["postgres"]}'
```

**重构要求**：  
- AI 生成的 JSON payload 中仍需包含 `metadataMulby` 字段（与当前相同）
- 在 system prompt 中清晰说明 `metadataMulby` 的作用和支持的 key
- 仅允许 `mode`、`triggerPhrases`、`capabilities`、`internalTools`、`mcpPolicy` 这 5 个 key
- `capabilities` 仅支持 `AI_TOOL_CAPABILITY_NAMES` 中定义的值
- 生成的 SKILL.md frontmatter 中的 `metadata` 字段须由 `encodeMulbyExtensions()` 正确生成

---

### 需求 4：解决大型 Skill 生成截断问题

**当前问题**：  
当需要创建包含大量内容的复杂 Skill（SKILL.md 内容很长、或者 scripts/ 有多个文件且每个文件内容不少），一次性要求 AI 输出完整的 JSON payload（包含所有文件的 `content` 字段），经常因大模型输出 token 限制导致 JSON 被截断，最终解析失败。

**解决方案（需要实现）**：  
采用**分阶段生成 + 增量组装**策略，而非一次性输出所有内容：

1. **阶段一：结构规划**  
   AI 先输出 skill 的元数据结构和文件清单（仅包含路径，不含 content）：
   ```json
   {
     "name": "xxx",
     "description": "xxx",
     "metadataMulby": {...},
     "skillMd": "--- frontmatter ---\n# body...",
     "files": [
       {"path": "scripts/main.py"},
       {"path": "references/api-docs.md"},
       {"path": "assets/template.html"}
     ]
   }
   ```

2. **阶段二：逐文件生成**  
   对于每个文件路径，单独发起 AI 请求（或在多轮 tool call 中逐个生成），让 AI 专注于单个文件内容的输出：
   ```json
   {"path": "scripts/main.py", "content": "#!/usr/bin/env python3\n..."}
   ```

3. **阶段三：组装与校验**  
   将所有文件内容收集齐后，调用现有的 normalize/validate 流程完成最终写入。

4. **容错机制**：
   - 每个文件的生成允许重试（当前 `repairFilesWithAi()` 逻辑可以保留并强化）
   - 如果文件数量较少（如 ≤ 2 个）且预估总 token 较小，仍可一次性生成以提升效率
   - 为每个阶段提供独立的 progress 状态反馈

---

### 需求 5：AI 感知运行时可用能力

**当前机制**（`runtime-capability-introspection-tool.ts`）：  
系统已实现 `mulby_describe_runtime_capabilities` 工具，可返回当前 AI 环境的完整能力快照：
```json
{
  "summary": { "totalTools": N, "mcpToolCount": N, "selectedSkillCount": N, ... },
  "tools": [{ "name": "xxx", "source": "internal|mcp|custom", "brief": "xxx" }, ...],
  "mcp": { "mode": "auto", "discoveredServers": [...] },
  "skills": { "selectedSkillIds": [...], "selectedSkillNames": [...] },
  "capabilities": { "requested": [...], "allowed": [...] }
}
```

**重构要求**：  
- 在 Skill 创建的 system prompt 中告知 AI 存在 `mulby_describe_runtime_capabilities` 工具
- 引导 AI 在创建 Skill 前先调用此工具了解当前可用的 tools/MCP/capabilities
- AI 生成的 Skill 应合理利用这些已有能力（如：如果已有 postgres MCP server，Skill 可以在 `metadataMulby.mcpPolicy` 中引用它）
- 但不强制每次都调用——如果用户需求明确且简单，可以跳过自省步骤

---

### 需求 6：支持多轮对话迭代 Skills

**当前问题**：  
现有 `createSkillWithAi()` 虽然支持 `previousRawText` 进行修订，但本质是"全量替换"——把之前的完整 JSON 丢给 AI 让它修改后再全量输出。这既浪费 token 又容易出错。

**重构要求**：  
实现基于**对话历史的迭代式修改**：

1. **对话状态管理**：
   - 创建 `SkillCreationSession` 概念，在内存中维护一个会话，包含：
     - `sessionId`：会话唯一标识
     - `conversationHistory`：完整的 messages 数组（system + user + assistant 消息）
     - `currentSkillState`：当前 skill 的最新状态（parsed payload）
     - `skillRecordId`：已保存的 skill record ID（如果已经保存过）
   
2. **增量修改而非全量重生成**：
   - 用户在对话中说"把触发模式改成 auto"、"在 scripts/ 下增加一个数据处理脚本" 时
   - AI 应基于当前 skill 的完整上下文，只修改相关部分
   - 返回一个 diff/patch 描述，或返回仅变更的字段：
     ```json
     {
       "action": "patch",
       "patches": {
         "metadataMulby.mode": "auto",
         "files": [{"path": "scripts/process-data.py", "content": "..."}]
       }
     }
     ```
   - 也支持 `"action": "full"` 进行全量重生成（当修改范围太大时）

3. **状态传递**：
   - 前端维护 session，每次用户交互把 `sessionId` 和新的用户消息传给后端
   - 后端从 session 中取回对话历史，追加新消息，调用 AI
   - AI 的每一轮输出追加到对话历史中

---

### 需求 7：前端对话式界面重构

**当前组件**（`AiSkillsSettingsView.tsx`，~991 行）：  
当前 AI 新建 Skill 是通过一个模态窗口（modal），有输入框填需求、选模型、然后一个 timeline 显示进度，最终展示结果或错误信息。

**重构为对话式界面**：

1. **布局**：
   - 新增/修改 Skill 的页面从 modal 改为**全屏对话式界面**（类似 ChatGPT/Claude 对话窗口）
   - 左侧或顶部展示当前 Skill 的元信息摘要
   - 主区域是对话流

2. **消息流（Message Stream）**：
   - **用户消息**：显示用户输入的需求/修改指令
   - **AI 消息**：
     - **文本内容**：以 markdown 渲染，流式逐字呈现
     - **代码块**：以语法高亮的代码块展示（SKILL.md 内容、script 内容等）
     - **思考过程（reasoning）**：如果模型支持（如 DeepSeek R1），展示思考过程，默认折叠，可展开
     - **工具调用**：显示 AI 调用了什么工具（如 runCommand），展示命令和结果
   - **状态消息**：各阶段的 progress 状态（生成中 → 解析中 → 校验中 → 写入中 → 完成）

3. **流式渲染要求**：
   - 使用现有的 `AiSkillCreateProgressChunk` 协议
   - `type: 'content'` → 流式追加 AI 的文本输出
   - `type: 'reasoning'` → 流式追加思考过程（渲染在可折叠区块中）
   - `type: 'status'` → 更新阶段状态指示器

4. **思考过程折叠交互**：
   ```
   ▶ 思考过程 (点击展开)
   ────────────────
   ▼ 思考过程
     关于这个 skill 的设计，我需要考虑以下几个方面...
     首先是目录结构的设计...
     (可折叠)
   ────────────────
   ```

5. **多轮交互**：
   - 底部始终有输入框，用户可以继续输入修改指令
   - 每一轮新的用户输入触发增量修改（对应需求 6）
   - 对话历史完整保留，可以滚动查看

6. **操作按钮**：
   - 对话结束后显示"保存 Skill"、"重新生成"、"复制输出"等操作
   - 如果已保存，后续修改直接更新同一个 skill record

---

## 四、关键技术约束

1. **不修改官方规范层**：`spec-validator.ts` 中的验证逻辑和 `encodeMulbyExtensions()`/`decodeMulbyExtensions()` 保持不变
2. **不修改 Service 层核心逻辑**：`service.ts` 中的 `createFromGenerated()`、`install()` 等持久化方法保持不变
3. **保持 IPC 协议兼容**：`shared/types/ai.ts` 中的 `AiApi.skills.*` 接口签名可以**新增**方法但**不能删除**现有方法
4. **保持流式协议兼容**：`AiSkillCreateProgressChunk` 类型可以**扩展**但不能破坏现有字段

---

## 五、实施建议（分阶段）

### Phase 1：后端 Composer 重构
- 重构 `composer.ts`，实现分阶段生成（需求 4）
- 完善 system prompt 构建（需求 1、2、3、5）
- 新增 `SkillCreationSession` 管理（需求 6）

### Phase 2：IPC 层适配
- 在 `shared/types/ai.ts` 中新增会话式 API：
  - `skills.createSession()` — 创建会话
  - `skills.sendMessage(sessionId, message)` — 发送消息并流式返回
  - `skills.getSession(sessionId)` — 获取会话状态
  - `skills.saveSkillFromSession(sessionId)` — 从会话保存 skill
- 保留现有 `createWithAi` / `createWithAiStream` 接口向后兼容

### Phase 3：前端界面重构（需求 7）
- 将 AI 新建 Skill 的 modal 改为对话式全屏页面
- 实现流式 markdown 渲染 + 代码高亮 + 思考过程折叠
- 实现多轮对话交互

---

## 六、参考资源

- **Agent Skills 官方规范**：https://agentskills.io/specification
- **Skills 介绍**：https://agentskills.io/what-are-skills
- **最佳实践**：https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- **示例 Skills**：https://github.com/anthropics/skills
- **内置 skill-creator SKILL.md**：`resources/skills/skill-creator/SKILL.md`
