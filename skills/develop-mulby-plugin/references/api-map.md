# API Map

Use this reference as the navigator for the bundled Mulby API docs under `references/apis/`.

## First Reads

- Start with `references/PLUGIN_DEVELOP_PROMPT.md` for Mulby-specific plugin architecture, lifecycle, manifest, and preload rules.
- Start with `references/apis/README.md` when you need the API catalog.
- Open only the specific module files you need after that.

## Contexts

- `R` means renderer usage, typically through `window.mulby.{module}`
- `B` means backend usage, typically through `context.api.{module}`
- `R/B` means both

## High-Value Modules

- `references/apis/plugin.md`
  - Plugin discovery, run, install, enable, disable, redirect, command shortcuts, and background plugin management.
- `references/apis/settings.md`
  - Mulby settings, shortcut recording, app update actions, and related UI flows.
- `references/apis/scheduler.md`
  - Scheduled tasks, cron-like jobs, delay jobs, subscription events, task listing, and task state management.
- `references/apis/features.md`
  - Dynamic feature registration and feature metadata updates.
- `references/apis/messaging.md`
  - Inter-plugin messages and broadcasts.
- `references/apis/host.md`
  - Host-provided methods exposed to plugins.
- `references/apis/tools.md`
  - Plugin Tools for AI Agent: manifest declaration, handler registration, and tool schema.

## Common Requirement -> Bundled Doc Mapping

- Plugin settings UI or persisted app settings
  - `references/apis/settings.md`
  - `references/apis/storage.md`
- Scheduled work, delayed jobs, cron-style callbacks, task lists
  - `references/apis/scheduler.md`
- Dynamic feature registration or feature metadata updates
  - `references/apis/features.md`
- Inter-plugin messaging
  - `references/apis/messaging.md`
- Plugin-host calls or host capability boundaries
  - `references/apis/host.md`
- Plugin as AI tool provider (AI Agent integration)
  - `references/apis/tools.md`
- Filesystem access
  - `references/apis/filesystem.md`
- HTTP requests
  - `references/apis/http.md`
- Shell and OS integration
  - `references/apis/shell.md`
- Notifications
  - `references/apis/notification.md`
- Dialogs and pickers
  - `references/apis/dialog.md`
- Clipboard or clipboard history
  - `references/apis/clipboard.md`
  - `references/apis/clipboard-history.md`
- Window behavior and detached UI
  - `references/apis/window.md`
- Storage (V1 basic + V2 advanced: pagination, CAS, batch, transactions, watch)
  - `references/apis/storage.md`
- Global shortcuts and input capture
  - `references/apis/shortcut.md`
  - `references/apis/input.md`
- Media, permissions, or system integration
  - `references/apis/media.md`
  - `references/apis/permission.md`
  - `references/apis/system.md`
  - `references/apis/power.md`
  - `references/apis/screen.md`
- AI-related plugin integrations
  - `references/apis/ai.md`
- Desktop search, in-browser views, or plugin store work
  - `references/apis/desktop.md`
  - `references/apis/inbrowser.md`
  - `references/apis/plugin-store.md`

## Reading Strategy

1. Read only the module files relevant to the requested capability.
2. Confirm whether the code belongs in renderer, backend, or preload.
3. When a task is Mulby-specific, prefer the bundled full docs over shorthand summaries.
4. If the target environment's implementation differs from these bundled docs, trust the target environment and current types.
5. Keep `manifest.json`, backend code, UI code, and preload wiring aligned with the APIs you actually use.
