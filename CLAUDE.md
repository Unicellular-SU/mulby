# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InTools is a cross-platform plugin-based productivity toolbox (similar to uTools/Alfred/Raycast). It provides a global hotkey-activated search interface with an extensible plugin ecosystem.

## Development Commands

```bash
# Install dependencies
npm install

# Development mode (Vite + Electron with hot reload)
npm run electron:dev

# Build for production
npm run electron:build

# Lint
npm run lint

# Type check
npm run typecheck
```

## Architecture

### Electron Process Structure

- **Main Process** (`src/main/`) - Window management, IPC handlers, plugin runtime
- **Renderer Process** (`src/renderer/`) - React UI for search window
- **Preload** (`src/preload/`) - Context bridge exposing `window.intools` API

### Key Modules

| Module | Location | Purpose |
|--------|----------|---------|
| Plugin Manager | `src/main/plugin/manager.ts` | Plugin lifecycle, loading, search matching |
| Plugin Window | `src/main/plugin/window.ts` | Plugin UI window management (attached/detached modes) |
| Plugin Runner | `src/main/plugin/runner.ts` | VM2 sandbox execution for Node.js plugins |
| IPC Handlers | `src/main/ipc/` | Main-renderer communication |
| Theme Manager | `src/main/theme.ts` | System theme detection and switching |

### Plugin System

Plugins live in `plugins/` directory. Each plugin has:
- `manifest.json` - Plugin metadata, triggers (keyword/regex), features
- `dist/main.js` - Backend logic (runs in VM2 sandbox)
- `ui/index.html` - Optional React/HTML UI

Plugin UI can run in two modes:
- **Attached** - Embedded in main window below search box
- **Detached** - Separate independent window

### Path Aliases

```
@/        -> src/
@main/    -> src/main/
@renderer/-> src/renderer/
@shared/  -> src/shared/
```

### Tech Stack

- Electron 28 + React 18 + TypeScript
- Vite + vite-plugin-electron for build
- Tailwind CSS for styling
- Zustand for state management
- better-sqlite3 for data storage
- VM2 for plugin sandboxing

## CLI Tool

The `packages/intools-cli/` contains a CLI for plugin development:
```bash
intools create <plugin-name>  # Create new plugin from template
```

## Global Shortcut

`Alt+Space` - Toggle main window visibility
