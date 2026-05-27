# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mulby is a cross-platform plugin-based productivity toolbox (similar to uTools/Alfred/Raycast). It provides a global hotkey-activated search interface with an extensible plugin ecosystem.

## Development Commands

Always use **pnpm** as the package manager in this repository.

```bash
# Install dependencies
pnpm install

# Start Vite dev server & launch Electron in hot reload mode
pnpm run electron:dev  # (or pnpm run dev)

# Build, compile native modules, and pack app using electron-builder
pnpm run electron:build

# Run comprehensive repo verification (Typecheck + Lint + Sync API Docs + Unit Tests + Bundle Smoke)
pnpm run verify

# Run TypeScript type check
pnpm run typecheck

# Run ESLint validation
pnpm run lint

# Run unit tests
pnpm run test:unit

# Reset onboarding status in SQLite DB (useful for debugging initial wizard)
node scripts/reset-onboarding.mjs

# Sync local skills/ folders to active AI coding IDEs (Cursor/Claude Code/Antigravity/etc.)
bash scripts/link-skills.sh
```

## Architecture

### Electron Process & Layout Structure

- **Main Process** (`src/main/`) - Window management, D-Bus native connectors, IPC handles, and plugin runtime supervisors.
- **Preload** (`src/preload/`) - Safe context bridge exposing controlled APIs under `window.mulby` and `window.mulbyMain`.
- **Renderer Process** (`src/renderer/`) - React 19 UI for main search box, store, setup screens, and developer console.
- **WebContentsView Architecture** - Plugin panels do NOT render inside the host BrowserWindow direct webContents. Instead, they run in dedicated Electron `WebContentsView` subviews positioned below custom HTML titlebars, maintaining modularity.

### Key Modules

| Module | Location | Purpose |
|--------|----------|---------|
| **Plugin Manager** | `src/main/plugin/manager.ts` | Orchestrates plugin lifecycle, loading, search indexing, and dispatching. |
| **Plugin Window** | `src/main/plugin/window.ts` | Embedded / detached window setups, using WebContentsView subviews. |
| **Host Process Manager** | `src/main/plugin/host-manager.ts` | Spawns, monitors, and bridges Node.js plugins in standard isolated `utilityProcess` hosts. |
| **Plugin Runner** | `src/main/plugin/runner.ts` | Fallback backend executor when process isolation is disabled in dev. |
| **WebContents Registry** | `src/main/services/webcontents-registry.ts` | Tracks custom WebContentsViews to bridge focus and IPC messages correctly. |
| **System commands** | `src/main/plugin/system-command-executor.ts` | Implements lock-screen, sleep, power control, screenshots, and native pickers. |
| **IPC Handlers** | `src/main/ipc/` | Handles main-renderer communication protocols. |

### Plugin System

- **System plugins** live in the `internal-plugins/` directory.
- **Third-party / Developer plugins** are loaded from the User Data directory (`plugins/` folder under app `userData`) or custom directories registered in settings.
- **Plugins layout**:
  - `manifest.json` - Plugin triggers (keywords, regex, clipboards), permissions, features, and entries.
  - `dist/main.js` - Background execution logic (runs in an isolated `utilityProcess` node thread).
  - `ui/index.html` - Embedded or detached panel React/HTML UI.

### Path Aliases

```
@/        -> src/
@main/    -> src/main/
@renderer/-> src/renderer/
@shared/  -> src/shared/
```

### Tech Stack

- **Electron 41.1 + React 19.2 + TypeScript 5.8**
- **Vite 8.0** + `vite-plugin-electron`
- **Tailwind CSS 3.3** for responsive styles
- **better-sqlite3 12.8** for local SQLite database storage
- **koffi 2.15** & **node-mac-permissions 2.5** for high-performance native macOS/Windows FFI
- **dbus-next 0.10** for native D-Bus communication on Linux (Geoclue location service, XDG color portal)
- *Note: VM2 and Zustand are NOT used in this repository.*

## Related Repositories

- `https://github.com/Unicellular-SU/mulby-cli` — Plugin development CLI.
- `https://github.com/Unicellular-SU/mulby-skills` — AI coding templates and guidelines.

## Global Hotkey

- `Alt+Space` (or custom modifier configured in general settings) - Toggles main search window visibility.
