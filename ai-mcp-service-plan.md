# AI MCP Unified Service Plan (for `src/main/ai`)

## 1. Goals and scope
- Provide a unified MCP configuration, management, and invocation layer for:
  - Main app AI calls (`window.mulby.ai.call`)
  - Plugin AI calls (`context.api.ai.call`)
  - Future agent-mode calls (if introduced later)
- Keep compatibility with existing `AiOption.tools` and plugin-host tool invocation.
- Implement security-first MCP lifecycle aligned with 2025-2026 spec practices.

Out of scope for phase-1:
- MCP server marketplace/discovery ecosystem.
- Cross-device MCP sync.
- Full-blown agent workflow orchestration.

## 2. Current gaps (from codebase)
- `AiService` tool executor currently assumes plugin context for meaningful execution.
- No MCP configuration schema in `AiSettings`.
- No MCP IPC/preload API in current app.
- No trust model (manual/protocol import), no per-tool policy controls.
- No MCP runtime observability (server logs/progress) in current app UI.

## 3. Target architecture (project-fit)

### 3.1 Main modules (`src/main/ai/mcp`)
- `types.ts`: MCP domain types (server/tool/policy/trust/runtime states).
- `config.ts`: MCP persistent config load/save/migration.
- `secureSecrets.ts`: optional encrypted secret store for sensitive env/headers.
- `clientPool.ts`: connection lifecycle manager (init/reuse/restart/stop/cleanup).
- `transportFactory.ts`: stdio/sse/streamableHttp transport creation.
- `oauth.ts`: OAuth helper (PKCE + local callback + token storage strategy).
- `catalog.ts`: list tools/prompts/resources + schema normalization.
- `runtime.ts`: call tool / abort / timeout / long-running logic.
- `policy.ts`: trust + allowlist + auto-approve + plugin-scope checks.
- `events.ts`: typed event bus for logs/progress/state changes.

### 3.2 AI integration points
- `src/main/ai/service.ts`
  - Add MCP-aware tool resolution stage before `buildTools(...)`.
  - Merge two tool sources:
    - legacy tools from caller (`AiOption.tools`)
    - generated MCP tools from selected MCP servers/tools
  - Route execution by tool name namespace:
    - `mcp__<serverId>__<toolName>` -> MCP runtime
    - others -> existing executor chain (plugin host method)
- `src/main/index.ts`
  - Replace current single-purpose `setAiToolExecutor` lambda with composite executor:
    - `dispatchToolExecution(input)` delegates MCP/non-MCP paths

### 3.3 IPC and preload APIs
- Add `src/main/ipc/ai-mcp.ts` and register in `src/main/ipc/index.ts`.
- Expose in `src/preload/index.ts` under `window.mulby.ai.mcp`:
  - `servers.list/get/upsert/remove`
  - `servers.activate/deactivate/restart/checkConnectivity`
  - `tools.list(serverId)`
  - `prompts.list/get`, `resources.list/get` (phase-2 optional)
  - `runtime.abort(callId)`
  - `logs.get(serverId)`, `onLog(listener)`
- Extend `src/shared/types/ai.ts` and `src/shared/types/electron.d.ts`.

### 3.4 Renderer management UI
- In `src/renderer/components/AiSettingsView.tsx` add MCP tab/group:
  - Server CRUD (stdio/sse/streamableHttp)
  - activate/deactivate/restart/connectivity test
  - trust warning for protocol-imported server (show command preview)
  - per-tool enable/disable
  - per-tool auto-approve toggle
  - timeout + long-running switches
  - server log panel

### 3.5 Plugin AI integration
- Extend `AiToolContext` with MCP scoping context:
  - `pluginName?: string`
  - `mcpScope?: { allowedServerIds?: string[]; allowedToolIds?: string[] }`
- Extend plugin API (`src/main/plugin/api.ts`, `src/shared/types/plugin.ts`) with optional MCP options in `ai.call`.
- Enforce plugin policy at main process:
  - plugin cannot invoke MCP server/tool unless both global policy and plugin policy allow it.

## 4. Data model proposal

### 4.1 Add MCP settings in AI settings
```ts
interface AiMcpSettings {
  servers: AiMcpServer[]
  defaults?: {
    timeoutMs?: number
    longRunningMaxMs?: number
    approvalMode?: 'always' | 'auto-approved-only' | 'never'
  }
}
```

### 4.2 Server model
```ts
interface AiMcpServer {
  id: string
  name: string
  type: 'stdio' | 'sse' | 'streamableHttp'
  isActive: boolean
  installSource?: 'manual' | 'protocol' | 'builtin'
  isTrusted?: boolean
  trustedAt?: number
  command?: string
  args?: string[]
  baseUrl?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  timeoutSec?: number
  longRunning?: boolean
  disabledTools?: string[]
  disabledAutoApproveTools?: string[]
}
```

### 4.3 AI call option extension
```ts
interface AiOption {
  // existing fields...
  mcp?: {
    mode?: 'off' | 'manual' | 'auto'
    serverIds?: string[]
    allowedToolIds?: string[]
  }
}
```

## 5. Security model (must-have)
- Trust gate before first activation for protocol-installed servers.
- Strict namespace validation for MCP tool IDs.
- Redact secrets in logs and persisted telemetry.
- No token passthrough from upstream AI provider to MCP servers.
- Runtime approval hook for risky tool calls:
  - default deny on timeout/no-window
  - optional per-tool auto-approve
- Plugin-scope least privilege enforcement.
- Local callback/OAuth endpoints bind localhost only.
- Optional allowlist for stdio commands (phase-2 hardening).

## 6. Execution roadmap

### Phase A (MVP, 1-2 iterations)
- Introduce MCP types/config store + IPC CRUD + activation/check.
- Implement client pool + listTools + callTool + abort + logs.
- Integrate MCP tool namespace into `AiService` tool executor.
- Add minimal UI in AI settings for server list + toggle + tool list.

### Phase B (security & UX hardening)
- Trust flow for protocol import.
- Per-tool auto-approve + runtime approval modal.
- Timeout/long-running settings and progress events.
- Better error taxonomy + diagnostics.

### Phase C (ecosystem support)
- OAuth support for streamableHttp/sse servers.
- prompts/resources management APIs.
- optional protocol import entry (`mulby://mcp/install?...`).

## 7. File-level implementation plan
- New files:
  - `src/main/ai/mcp/types.ts`
  - `src/main/ai/mcp/config.ts`
  - `src/main/ai/mcp/clientPool.ts`
  - `src/main/ai/mcp/runtime.ts`
  - `src/main/ai/mcp/policy.ts`
  - `src/main/ai/mcp/events.ts`
  - `src/main/ipc/ai-mcp.ts`
- Modified files:
  - `src/shared/types/ai.ts`
  - `src/shared/types/electron.d.ts`
  - `src/main/ai/service.ts`
  - `src/main/index.ts`
  - `src/main/ipc/index.ts`
  - `src/preload/index.ts`
  - `src/main/plugin/api.ts`
  - `src/shared/types/plugin.ts`
  - `src/renderer/components/AiSettingsView.tsx`

## 8. Testing strategy
- Unit tests:
  - tool namespace routing and fallback behavior
  - policy enforcement (trust + allowlist + plugin scope)
  - config migration and schema validation
  - timeout/abort behavior
- Integration tests:
  - stdio mock MCP server end-to-end call
  - plugin AI -> MCP tool call with permission boundaries
  - stream tool-call/tool-result chunk ordering
- Regression checks:
  - existing plugin host tool calling still works
  - non-tool AI calls unchanged

## 9. Risks and mitigations
- Risk: tool ID instability when server renamed.
  - Mitigation: use stable `server.id` in runtime IDs, display `server.name` only in UI.
- Risk: command injection via imported config.
  - Mitigation: trust gate + command preview + optional command allowlist.
- Risk: dead/hanging tool calls.
  - Mitigation: default timeout + progress-based extension + abort support.
- Risk: plugin privilege escalation via MCP.
  - Mitigation: main-process policy enforcement; plugin-provided scope treated as request, not authority.

## 10. Acceptance criteria
- User can configure/manage MCP servers in app settings.
- Main AI calls can invoke MCP tools without manual tool schema wiring.
- Plugin AI calls can invoke MCP tools under enforced policy.
- Tool execution has timeout/abort/log observability.
- Existing tool-calling compatibility remains intact.
