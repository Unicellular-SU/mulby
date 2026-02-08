# Task Plan: AI MCP Unified Service Design & Phase-A Implementation

## Goal
Implement the first runnable MCP foundation in `src/main/ai` for unified config/management/invocation across core AI and plugin AI.

## Phases
- [x] Phase 1: Plan and setup
- [x] Phase 2: Research best practices and current project architecture
- [x] Phase 3: Design target architecture and rollout plan
- [x] Phase 4: Implement Phase-A backend foundation
- [x] Phase 5: Validate with typecheck/tests and summarize

## Key Questions
1. Can we add MCP without breaking existing AI/provider behavior?
2. Can plugin AI invoke MCP safely with scope controls?
3. Is there enough API surface for renderer-side MCP management next?

## Decisions Made
- Added `@modelcontextprotocol/sdk` as runtime dependency.
- Implemented dedicated MCP runtime at `src/main/ai/mcp/service.ts`.
- Integrated MCP tool resolution into `AiService` (`AiOption.mcp` + merged tool set).
- Kept backward compatibility for legacy/plugin host tools via namespaced tool routing.

## Errors Encountered
- Initial import path/type mismatch for SDK `streamableHttp` and logging payload fields.
- Resolved with `.js` subpath import and SDK-compliant logging data extraction.

## Status
**Completed (Phase A)** - backend runtime + API exposure + integration + test/type verification.
