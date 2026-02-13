# Notes: AI Skills 2025-2026 + Project Integration

## Current Task Notes (2026-02-12)

### Agent Skills 官方规范一次性达标（执行阶段）
- 用户确认策略：
  - 不合规 Skill 处理：立即硬校验（拒绝安装/导入/创建/刷新入库）。
  - 交付范围：全量一次到位（不需要迁移工具）。
  - 扩展字段策略：迁移到 `metadata` 命名空间（`metadata.mulby.*`）。
- 本轮强制目标：
  - `SKILL.md` 仅允许官方字段：`name`、`description`、`license`、`compatibility`、`metadata`、`allowed-tools`。
  - 启动阶段只读取 frontmatter，激活时再加载正文。
  - 全入口硬校验：create/install/import/refresh/update。
  - UI 暴露规范状态与失败原因。
- 实施结果：
  - 新增 `spec-validator`，统一执行 frontmatter 严格校验与 `metadata.mulby.*` 编解码。
  - Skills 服务入口已全部接入硬校验与规范化写入。
  - 创建链路改为官方字段输出，非官方扩展统一收敛到 `metadataMulby`。
  - 新增规范单测并更新服务单测；`npm run test:unit` 与 `npm run typecheck` 通过。

## Current Task Notes (2026-02-11)

### Mulby -> Mulby 全量改名
- 已确认执行模式：一次性切断（不保留旧命名兼容别名）。
- 本次替换目标：
  - `Mulby` -> `Mulby`
  - `mulby` -> `mulby`
  - `mulby` / `mulby` -> `mulby`
  - `mulby-cli` -> `mulby-cli`
  - `window.mulby` -> `window.mulby`
  - `window.mulbyMain` -> `window.mulbyMain`
  - `.mulby` -> `.mulby`
  - `com.mulby.app` -> `com.mulby.app`
  - `@mulby/` -> `@mulby/`
  - `Mulby` 类型前缀 -> `Mulby`
- 需同步处理目录/文件重命名：
  - `packages/mulby-cli` -> `packages/mulby-cli`
  - `docs/mulby-cli` -> `docs/mulby-cli`
  - `plugins/mulby-showcase` -> `plugins/mulby-showcase`
  - `plugins/**/src/types/mulby.d.ts` -> `plugins/**/src/types/mulby.d.ts`
- 排除直接替换范围：
  - `node_modules/**`
  - 二进制包（如 `.png`, `.inplugin`, `.icns`, `.zip`, `.dmg`）
  - 需要重建的构建产物目录（按需重建）

## Current Task Notes (2026-02-09)

### Capability Policy 解耦迁移
- 目标：能力授权从 Skill/source 维度解耦到 AI 全局策略。
- 迁移策略：
  - 新增 `globalGrants` 作为主路径。
  - 保留 `grants` 兼容历史 scoped 规则。
  - 通过 `legacy` 记录是否存在 scoped grants（用于 UI 提示与后续清理）。
- 风险控制：
  - 不自动提升 scoped allow 到 global allow，避免权限扩大。
  - 兼容期保留 scoped grants 生效（可通过开关关闭）。

### 本次落地结果
- `src/shared/types/settings.ts`
  - 新增 `globalGrants`、`compatEnableScopedGrants`、`legacy` 字段。
- `src/main/services/app-settings.ts`
  - 增加旧配置到 `globalGrants` 的平滑归一化与 `legacy` 统计。
- `src/main/ai/tools/capability-policy.ts`
  - 裁决逻辑改为全局能力优先，scoped grants 仅兼容期生效。
- `src/renderer/components/SettingsView.tsx`
  - 移除按 Skill/source 能力矩阵，改为全局 grant 管理 UI。
- `src/main/ai/__tests__/capabilities.test.ts`
  - 增加/调整全局策略与兼容窗口测试。

## Sources

### Source 1: Anthropic Claude Code docs (Skills)
- URL: https://docs.anthropic.com/en/docs/claude-code/skills
- Key points:
  - Skills are modular capability units loaded from markdown + optional resources/scripts.
  - Supports project-level (`.claude/skills`) and user-level (`~/.claude/skills`) distribution.
  - `SKILL.md` metadata/description is used for invocation/discovery.
  - Guidance emphasizes narrow, composable skills.

### Source 2: Anthropic Skills API guide
- URL: https://docs.claude.com/en/docs/agents-and-tools/skills/overview
- Key points:
  - Skills can be attached by source ID or custom content.
  - Recommends skill curation and caching for cost/latency control.
  - Supports explicit management APIs (create/list/update/delete patterns).

### Source 3: OpenAI Agents SDK docs (Hosted MCP)
- URL: https://openai.github.io/openai-agents-python/mcp/
- Key points:
  - MCP tool routing includes per-server tool allowlist and approval control.
  - `require_approval` supports global and per-tool behavior.
  - Runtime supports approval request/response loop for risky tools.

### Source 4: MCP official docs (spec + transports + security)
- URL: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- URL: https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices
- URL: https://modelcontextprotocol.io/specification/2025-06-18/specification
- Key points:
  - `Streamable HTTP` is the preferred transport; SSE remains for backward compatibility.
  - Security model highlights explicit user consent/control and least privilege.
  - Calls out trust boundaries and data/tool safety requirements.

### Source 5: GitHub Copilot docs (Custom instructions / Skills)
- URL: https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot
- Key points:
  - Skills are presented as reusable instruction modules, separated from prompt body.
  - Supports team/project-scoped reuse patterns and discoverability by metadata.

### Source 6: Agent Skills ecosystem docs
- URL: https://agentskills.io/
- URL: https://agentskills.io/integrate-skills
- Key points:
  - Emerging cross-agent skill packaging format (SKILL.md-centric).
  - Emphasizes portable metadata + capability declaration + dependency handling.

### Source 7: Cherry Studio source (local reference)
- File: `cs/src/main/utils/markdownParser.ts`
- File: `cs/src/main/services/agents/plugins/PluginService.ts`
- File: `cs/src/renderer/src/services/MarketplaceService.ts`
- File: `cs/src/renderer/src/hooks/useMarketplaceBrowser.ts`
- Key points:
  - Skill parser supports `SKILL.md/skill.md`, YAML failsafe parse, frontmatter recovery, hash-based metadata.
  - Skill install path supports marketplace resolve + repo clone + skill dir locate + metadata register.
  - Marketplace uses paged list/search + cache TTL + typed validation.

## Synthesized Findings

### Industry consensus (2025-2026)
- Skills should be treated as a **first-class capability layer**, not raw prompt snippets.
- Practical architecture is usually: `skill package` + `registry/install` + `runtime resolver` + `approval/policy`.
- Skills and MCP are complementary:
  - Skills provide intent-level behavior packs.
  - MCP provides executable external tools/resources.
- Tool/permission safety is now standard:
  - per-tool allowlist
  - approval gates (first-use + risky tools)
  - auditable logs.

### Direct implications for this repo
- Existing `src/main/ai` already has MCP runtime and tool-context scoping; this is a strong base.
- Most suitable integration point is **before tool merge/build** in `AiService`:
  - resolve skill contributions
  - merge skill prompt/system context
  - merge skill-declared MCP policy into `option.mcp` + `toolContext`.
- For plugin compatibility, extend `AiOption` with `skills` selection and enforce scope in main process (plugin request is advisory, not authority).

### Non-goals for phase 1
- No arbitrary skill script execution by default (reduce supply-chain risk).
- No global cloud sync/marketplace write path in MVP.
