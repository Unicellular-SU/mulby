# Settings & Plugin Management Design (Main Window)

## Scope

This document defines the page structure and data flow for:
- Settings page inside the main window (left navigation always visible).
- Plugin management page with enhanced capabilities.
- Plugin store sources (multiple user-defined indexes).

References:
- UI spec: `docs/ui-design.md`
- Plugin window behavior: `docs/plugin-window-design.md`
- Renderer app: `src/renderer/App.tsx`
- Plugin details: `src/renderer/components/PluginDetails.tsx`
- Preload APIs: `src/preload/index.ts`
- Plugin IPC: `src/main/ipc/plugin.ts`
- Theme manager: `src/main/services/theme.ts`
- Plugin state: `src/main/plugin/state.ts`

## Entry Points

- `Cmd/Ctrl + ,` opens Settings (same window, "details mode").
- Menu item "Settings" (see `docs/apis/menu.md`).
- Search command route `settings` (see `docs/apis/features.md`) should map to the Settings view.

## Layout Structure (Main Window)

### Overall

- Window size: reuse detail view height from `src/renderer/App.tsx` (currently 700).
- Left nav is persistent; content area changes by section.
- Design language matches `docs/ui-design.md` (Inter font, glass/clean surfaces, no emoji icons).

### Layout Blocks

```
┌─────────────────────────────────────────────────────────────┐
│  Top Bar: Title + search (optional) + close/back             │
├───────────────┬─────────────────────────────────────────────┤
│  Left Nav     │  Content Area                                │
│  - General    │  Section content (forms, lists, cards)        │
│  - Appearance │                                               │
│  - Shortcuts  │                                               │
│  - Plugins    │                                               │
│  - Store      │                                               │
│  - Permissions│                                               │
│  - About      │                                               │
└───────────────┴─────────────────────────────────────────────┘
```

### Navigation Rules

- Keyboard navigation supported (up/down to move items, enter to select).
- Highlight current section, visible focus ring.
- Use icons from a single SVG set (Lucide or Heroicons).

## Settings Sections (Content)

### 1) General

- Launch on startup (requires main process support).
- Language (placeholder for future i18n).
- Main window behavior:
  - Search window height mode (compact or standard).
  - Execute-after-run behavior (close when no UI / always close / stay).
  - Attachments panel auto-close (boolean).

### 2) Appearance

- Theme mode: `light` / `dark` / `system`.
  - Use `window.mulby.theme.get()` and `window.mulby.theme.set()` in renderer.
- Reduced motion (respect `prefers-reduced-motion`).
- Glass intensity (optional; mapped to CSS vars).

### 3) Shortcuts (All User-Configurable)

- Global shortcuts (app-level):
  - Toggle main window (default: `Alt+Space`).
  - Open settings (default: `Cmd/Ctrl + ,`).
  - Optional: “Open plugin manager”, “Check updates”.
- Plugin feature shortcuts:
  - Map plugin feature code to accelerator.
  - Conflict detection across app and plugins.

**Design note:** Current shortcut IPC is window-scoped (`shortcut:*` in `src/preload/index.ts`),
so app-level shortcuts should be backed by a new main-process registry (see Data Flow).

### 4) Plugins (Management)

- Installed list with:
  - Icon, displayName, version, author (if available), enable toggle.
  - “Details”, “Open folder”, “Uninstall”.
- Built-in plugins:
  - Mark with a badge and lock icon.
  - Disable/Uninstall buttons are disabled or hidden.
- Bulk actions:
  - Enable all (except built-in).
  - Disable all (except built-in).
- Filters:
  - Enabled / Disabled
  - Has UI / No UI
  - Built-in / Third-party
- Search by name, description, feature keywords.

### 5) Store (Indexes & Updates)

- Source list (multiple user-defined indexes):
  - URL, name, enabled toggle, priority.
  - Add / edit / remove source.
  - Test connection (fetch and validate JSON).
- Store list:
  - Aggregated catalog from enabled sources.
  - Install / update actions.
- Update center:
  - Compare local `manifest.json` vs store version.
  - Batch update with progress.

### 6) Permissions

- Show status for: accessibility, screen, mic, camera, location.
- Actions: request permission / open system settings.
- Uses `window.mulby.permission.*`.

### 7) About / Advanced

- App info: version, build, data path (use `window.mulby.system.getAppInfo()` and `getPath()`).
- Logs folder open (use `window.mulby.shell.openFolder()`).
- Export/Import settings (future).

## Plugin Store Source Model

### Source Schema (stored in app settings)

```
{
  id: string,
  name: string,
  url: string,
  enabled: boolean,
  priority: number,
  lastSyncAt?: number,
  lastError?: string
}
```

### Index Schema (served by GitHub Pages or raw)

```
{
  "name": "Mulby Community",
  "updatedAt": 1730000000000,
  "plugins": [
    {
      "id": "com.example.foo",
      "name": "foo",
      "displayName": "Foo Toolkit",
      "description": "...",
      "version": "1.2.3",
      "author": "user",
      "icon": "https://.../icon.png",
      "downloadUrl": "https://.../foo-1.2.3.inplugin",
      "sha256": "..."
    }
  ]
}
```

## Data Flow (Renderer ↔ Main)

### 1) Settings Load

- Renderer:
  - `window.mulby.storage.get('appSettings', 'global')`
  - Merge defaults and update UI state.
- Main:
  - `storage` IPC already exists (`src/main/ipc/storage.ts`).

### 2) Theme Changes

- Renderer:
  - On user selection: `window.mulby.theme.set(mode)`
  - Listen: `window.mulby.onThemeChange`.
- Main:
  - `ThemeManager` persists `theme.json` and broadcasts updates.

### 3) Plugin List

- Renderer:
  - `window.mulby.plugin.getAll()`
  - Use `PluginDetails` for README via `plugin:getReadme`.
- Main:
  - `registerPluginHandlers()` exposes `getAll`, `enable`, `disable`, `uninstall`.
  - Enhance `getAll` to include built-in flag and timestamps (requires extending IPC data).

### 4) Built-in Plugin Locking

- Main:
  - Add `builtin` to manifest or maintain a list in main process.
  - `plugin:getAll` includes `builtin`.
- Renderer:
  - Disable enable/disable/uninstall actions for built-in plugins.

### 5) Store Index Fetch

- Renderer:
  - For each enabled source: `window.mulby.http.get(url)`
  - Validate schema, aggregate by id/version.
  - Cache in `storage` under `pluginStoreCache`.
- Main:
  - No new IPC required; uses `http` API.

### 6) Install/Update Flow

- Renderer:
  - Download `.inplugin` with `http` (or use `filesystem` + `dialog`).
  - Call `window.mulby.plugin.install(filePath)` after saving.
- Main:
  - `PluginInstaller` handles install/update; `PluginManager.init()` reloads.

### 7) Shortcut Settings (App-level)

**Needs new main-process registry.**

- Renderer:
  - Read: `storage.get('shortcuts', 'global')`.
  - Set: `ipc` to update + register (new handler).
  - Conflict check (main returns registered status).
- Main:
  - Store shortcut config in a new service (`src/main/services/shortcut.ts`).
  - Register global shortcuts via `globalShortcut.register`.
  - Provide IPC: `shortcut:app:get`, `shortcut:app:set`, `shortcut:app:reset`, `shortcut:app:conflicts`.

## Renderer State Model (Suggested)

```
type ViewMode = 'home' | 'plugin-details' | 'settings'

state:
  viewMode
  settingsSection
  appSettings
  plugins[]
  storeSources[]
  storeIndex[]
  shortcuts[]
```

**Integration with current App:**
- Replace `detailsPluginName` as a single view switch, e.g.:
  - `viewMode: 'plugin-details'` + `detailsPluginName`
  - `viewMode: 'settings'` + `settingsSection`
- Keep existing window sizing logic; set height to 700 when viewMode != home.

## UX Notes (from existing spec)

- Respect keyboard-first operation.
- Visible focus states for all interactive elements.
- Avoid hover scale; use color/opacity transitions.
- No emoji icons; use SVGs consistently.

## Implementation Status (Current)

### Implemented

- Settings view with left navigation embedded in main window.
- App settings storage in main process using the shared `store` table.
- App-level shortcut registration and conflict reporting.
- Shortcut input uses stable `event.code` mapping to avoid dead-key issues and supports multiple modifiers.
- Theme switching wired to `theme` API.
- Search-driven entry to Settings (system command injected into results when query matches settings keywords).
- Shortcut status reflects current registration, loaded with settings; status only updates when shortcut settings change.
- Recording shortcuts temporarily pauses app-level global shortcuts to prevent hiding the window during capture.
- Plugin management list with search, status filter, enable/disable, details, and uninstall (built-in plugins locked).
- Store sources list add/remove/toggle persisted to settings.
- Permissions status display and system settings jump.
- About section reads app info and user data path.

### New IPC/API

- `settings:get`, `settings:update`, `settings:reset`
- Renderer API: `window.mulby.settings`
- App event: `app:openSettings` (main -> renderer)
 - `plugin:getAll` now returns version/author/path/builtin for management UI.

### Pending

- Plugin management section (enabled/disable, details, update checks).
- Store index fetching, install/update pipeline UI.
- General settings with real behaviors (startup, window behaviors, etc.).
```
