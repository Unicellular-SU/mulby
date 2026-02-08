# Notes: AI Skills 2025-2026 + Project Integration

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
