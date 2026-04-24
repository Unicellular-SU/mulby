// ── Process / Worker readiness ──────────────────────────────────────────
export const PLUGIN_READY_TIMEOUT_MS = 10_000
export const PARSER_WORKER_STARTUP_TIMEOUT_MS = 10_000
export const MCP_PING_TIMEOUT_MS = 1_000

// ── HTTP ────────────────────────────────────────────────────────────────
export const HTTP_DEFAULT_TIMEOUT_MS = 30_000

// ── OS command execution ────────────────────────────────────────────────
export const OS_COMMAND_TIMEOUT_MS = 2_000

// ── Window animation settle ─────────────────────────────────────────────
export const WINDOW_HIDE_SETTLE_MS = 200

// ── InBrowser wait-loop polling ─────────────────────────────────────────
export const IN_BROWSER_POLL_INTERVAL_MS = 100

// ── Background manager ─────────────────────────────────────────────────
export const BG_BATCH_DELAY_MS = 500
export const BG_FORCE_STOP_TIMEOUT_MS = 3_000

// ── Search session / JS execution settle ────────────────────────────────
export const SESSION_WARMUP_DELAY_MS = 1_000
export const DYNAMIC_JS_SETTLE_MS = 800
export const SESSION_WARMUP_TIMEOUT_MS = 10_000

// ── Task scheduler ──────────────────────────────────────────────────────
export const SCHEDULER_IDLE_CHECK_MS = 60_000

// ── MCP transport ───────────────────────────────────────────────────────
export const MCP_TRANSPORT_CLOSE_TIMEOUT_MS = 3_000

// ── Darwin search preheat ───────────────────────────────────────────────
export const DARWIN_PREHEAT_DELAY_MS = 2_000

// ── Process graceful exit ───────────────────────────────────────────────
export const PROCESS_GRACEFUL_EXIT_MS = 100

// ── Geolocation ─────────────────────────────────────────────────────────
export const GEOLOCATION_NATIVE_TIMEOUT_MS = 10_000
