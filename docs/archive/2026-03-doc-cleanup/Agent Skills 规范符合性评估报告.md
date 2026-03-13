 # Agent Skills 规范符合性评估报告（src/main/ai）

  ## 评估范围与依据

  - 官方标准：https://agentskills.io/specification、https://agentskills.io/integrate-skills、https://agentskills.io/what-are-skills、https://agentskills.io/home
  - 评估代码：src/main/ai/**（重点：src/main/ai/skills/service.ts、src/main/ai/service.ts、src/shared/types/ai.ts）
  - 运行验证：已执行 npm run test:unit，结果 131 pass / 0 fail / 1 skip（环境相关跳过）

  ## 1. 一致性分析

  | 规范项 | 结论 | 证据 |
  |---|---|---|
  | Skill 以目录 + SKILL.md 为核心 | 符合 | src/main/ai/skills/service.ts:323, src/main/ai/skills/
  service.ts:898 |
  | 发现、匹配、激活、执行流程 | 基本符合 | 发现/加载：src/main/ai/skills/service.ts:527；匹配：src/main/
  ai/skills/service.ts:1126；激活注入：src/main/ai/skills/service.ts:1233；接入调用链：src/main/ai/
  service.ts:388 |
  | 启动阶段仅加载 frontmatter 元数据（官方推荐） | 不符合 | 解析时直接把 body 作为 promptTemplate：src/
  main/ai/skills/service.ts:174；目录扫描时读取完整 SKILL.md：src/main/ai/skills/service.ts:487 |
  | SKILL.md 必须有 YAML frontmatter 且含 name/description | 不符合 | 缺 frontmatter 时返回空对象继续处
  理：src/main/ai/skills/service.ts:100；description 非必填：src/main/ai/skills/service.ts:163, src/main/
  ai/skills/service.ts:636 |
  | 名称约束（长度、字符集、与目录名一致） | 不符合 | 仅 slugify，未校验目录一致/长度/连续连字符等：src/
  main/ai/skills/service.ts:56, src/main/ai/skills/service.ts:161, src/main/ai/skills/service.ts:456 |
  | 标准字段支持（license/compatibility/metadata/allowed-tools） | 不符合 | 领域模型未定义这些字段：src/
  shared/types/ai.ts:180；构建输出也未写入：src/main/ai/skills/service.ts:202 |
  | 安全建议（allowlist/确认/审计） | 部分符合 | 命令白黑名单、同意弹窗、审计链路完备：src/main/services/
  command-runner-core.ts:370, src/main/services/command-runner-core.ts:389, src/main/services/command-
  runner-core.ts:580 |

  ## 2. 主要差异点（按严重度）

  1. 高：SKILL.md 规范校验缺失，允许非规范 Skill 进入目录与运行链路。
     证据：src/main/ai/skills/service.ts:100, src/main/ai/skills/service.ts:898, src/main/ai/skills/
     service.ts:948。
  2. 高：frontmatter 解析器不是完整 YAML 解析器，复杂合法 YAML（尤其嵌套）兼容性差。
     证据：src/main/ai/skills/service.ts:99（自定义正则解析）。
  3. 高：标准字段未落模（license/compatibility/metadata/allowed-tools），与官方可移植格式存在断层。
     证据：src/shared/types/ai.ts:180, src/main/ai/skills/service.ts:202。
  4. 中：未执行官方推荐的“启动仅元数据、激活再加载正文”的渐进披露策略。
     证据：src/main/ai/skills/service.ts:174, src/main/ai/skills/service.ts:487。
  5. 中：名称规范校验不足（目录名一致性、字符约束、长度）。
     证据：src/main/ai/skills/service.ts:161, src/main/ai/skills/service.ts:456。
  6. 中：实现使用大量平台扩展字段（mcpPolicy/capabilities/mode 等），强功能但弱跨 Agent 互操作。
     证据：src/shared/types/ai.ts:188, src/shared/types/ai.ts:190, src/shared/types/ai.ts:191。
     说明：官方是否“严格禁止扩展顶层字段”未明确，这是基于规范兼容性的推断风险。

  ## 3. 合规性评分（1-10）

  - 规范性：5/10
    核心流程在，但格式约束与字段标准差异较大。
  - 完整性：8/10
    创建/导入/安装/启用/解析/预览/测试链路完整，工程实现成熟。
  - 可扩展性：7/10
    服务边界清晰（AiSkillService + AiService），但数据模型与解析策略偏平台私有，影响跨生态扩展。

  ## 4. 改进建议（具体重构方向）

  1. 在 install/create/import/refresh 全路径加入“规范校验层”。
     落点：src/main/ai/skills/service.ts:622, src/main/ai/skills/service.ts:812, src/main/ai/skills/
     service.ts:948, src/main/ai/skills/service.ts:527。
     建议新增 src/main/ai/skills/spec-validator.ts，严格校验必填字段与名称规则。
  2. 用标准 YAML 解析替换自定义 frontmatter 解析。
     落点：src/main/ai/skills/service.ts:99。
     收益：兼容官方 frontmatter 与嵌套字段。
  3. 扩展 AiSkillDescriptor 支持标准字段，并保留你们扩展能力。
     落点：src/shared/types/ai.ts:180。
     建议：标准字段直接建模，私有字段放 metadata.mulby.*（或 sidecar manifest）。
  4. 改为“启动只读 metadata，激活时再读正文”。
     落点：src/main/ai/skills/service.ts:487, src/main/ai/skills/service.ts:1233。
     做法：refreshCatalog 只缓存元数据；applyResolutionToOption 按选中 skill 惰性加载正文并缓存。
  5. 将 allowed-tools 接入能力策略裁决。
     落点：src/main/ai/tools/capability-policy.ts:62, src/main/ai/service.ts:222。
     做法：把 skill 声明工具做交集收敛，避免 skill 提权。
  6. 增加“规范回归测试集”。
     落点：src/main/ai/__tests__/skillsService.test.ts:37。
     补充用例：缺 frontmatter、非法 name、超长 description、metadata/compatibility/allowed-tools、目录名
     不一致。

  ## 参考来源

  - https://agentskills.io/specification
  - https://agentskills.io/integrate-skills
  - https://agentskills.io/what-are-skills
  - https://agentskills.io/home