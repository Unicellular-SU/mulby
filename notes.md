# Notes: AI MCP Unified Service Design

## Sources

### MCP official (primary)
- MCP Specification (current index): https://modelcontextprotocol.io/specification/2025-11-05
- MCP Changelog (2025-11-05): https://modelcontextprotocol.io/specification/2025-11-05/changelog
- MCP Security Best Practices (2025-11-25): https://modelcontextprotocol.io/specification/2025-11-05/basic/security_best_practices
- MCP Transports (2025-11-05): https://modelcontextprotocol.io/specification/2025-11-05/basic/transports
- MCP Lifecycle (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
- MCP Authorization (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- MCP Authorization Best Practices (2025-07-09): https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization#best-practices
- MCP Schema Reference (ToolAnnotations/ToolExecution): https://modelcontextprotocol.io/specification/2025-06-18/schema
- MCP TypeScript SDK docs: https://github.com/modelcontextprotocol/typescript-sdk

### Vendor docs (primary)
- OpenAI Responses API - remote MCP tools: https://platform.openai.com/docs/guides/tools-remote-mcp
- Anthropic API - MCP servers: https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector

### Local reference implementation
- Cherry Studio MCP service: `cs/src/main/services/MCPService.ts`
- Cherry Studio MCP OAuth: `cs/src/main/services/mcp/oauth/provider.ts`
- Cherry Studio MCP URL install: `cs/src/main/services/urlschema/mcp-install.ts`
- Cherry Studio MCP trust + settings UI: `cs/src/renderer/src/pages/settings/MCPSettings/*`
- Cherry Studio tool permission flow: `cs/src/main/services/agents/services/claudecode/tool-permissions.ts`

## Synthesized Best Practices (2025-2026)
- Prefer Streamable HTTP over HTTP+SSE for HTTP transport; keep stdio first-class for local servers.
- Enforce transport security: Origin validation for local HTTP servers, bind localhost for local callbacks, never expose loopback callbacks publicly.
- Enforce OAuth correctly (RFC 9728): resource indicators, incremental auth scope, and dynamic client registration compatibility.
- Disallow token passthrough and avoid forwarding third-party tokens into MCP servers.
- Always require explicit user consent for high-impact tool execution; support per-tool allow/deny and bounded auto-approve.
- Keep a trust boundary for imported/protocol-installed servers; show exact command/env preview before first enable.
- Build resilient runtime: connection reuse + pending-init dedupe + restart/stop + timeout + progress-aware long-running mode.
- Treat tool metadata as untrusted input (tool poisoning/rug-pull risks); apply schema validation + output limits + prompt isolation.
- Expose observability: per-server logs, progress events, structured errors, and cache invalidation on list/resource change notifications.
- Make permissions least-privilege: server-level enable, tool-level enable, context-level scope (global AI vs plugin AI).

## Local Architecture Findings (in_tools)
- Current AI tool execution is single hook (`setAiToolExecutor`) and currently hard-requires `pluginName` context.
- Core AI (renderer -> `window.intools.ai`) has no MCP config/runtime API yet.
- Plugin AI calls append `{ toolContext.pluginName }` and route tool invocation to plugin host methods.
- `AiSettings` currently only contains providers/models/defaultParams; no MCP schema.
- No MCP IPC channels in `src/main/ipc/ai.ts` or preload API.
- Existing stream protocol already supports `tool-call`/`tool-result`, suitable for MCP runtime telemetry reuse.

## Cherry Studio Findings (useful patterns)
- `MCPService` supports stdio/sse/streamableHttp/inMemory, OAuth provider, connection caching, pending init dedupe.
- Supports server lifecycle ops: check/restart/stop/remove/cleanup and per-server log buffer.
- Implements tool/prompt/resource list & fetch with cache + invalidation via MCP notifications.
- Runtime call supports timeout, long-running mode (`resetTimeoutOnProgress`, capped max timeout), and abort by callId.
- UI model includes trust flags (`installSource`, `isTrusted`, `trustedAt`) and protocol-install warning flow.
- Per-tool policy controls (`disabledTools`, `disabledAutoApproveTools`).

## Candidate Direction for in_tools
- Build a dedicated MCP subsystem under `src/main/ai/mcp` (config + runtime + policy + adapters).
- Keep AI provider runtime independent from MCP runtime; integrate at tool orchestration boundary only.
- Extend `AiOption` with MCP selection mode to avoid requiring callers to manually craft tool schemas.
- Maintain backward compatibility for existing plugin host tools while adding MCP tool namespace routing.
- Add plugin-aware MCP policy (plugin can use only explicitly allowed server/tool sets).

## Phase-A Implemented (this iteration)
- Added MCP schema into shared AI types (`AiMcpServer`, `AiMcpSettings`, `AiOption.mcp`, `AiApi.mcp`).
- Added settings persistence and normalization support for MCP in `src/main/ai/config.ts`.
- Implemented MCP runtime service with:
  - server lifecycle (`list/get/upsert/remove/activate/deactivate/restart/check`)
  - connection pooling + pending init dedupe
  - transports (`stdio`, `sse`, `streamableHttp`)
  - tools list cache + disabled tool policy
  - tool call/abort + timeout + long-running controls
  - server-scoped log buffer
- Integrated MCP tools into `AiService` by merged tool resolution (`declared tools + MCP tools`).
- Integrated tool execution routing in main process (`mcp__*` -> MCP runtime; others keep plugin host method path).
- Added IPC + preload APIs for MCP management and runtime ops.
- Added helper unit tests and passed full existing AI unit test suite.
