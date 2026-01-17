# Notes: Plugin Spec Rewrite

## Sources

### Source 1: Docs and CLI
- URL: local repo
- Key points:
  - CLI provides `create`, `dev`, `build`, `pack` with React/basic templates.
  - API docs are split by area in `docs/apis`.
  - Manifest spec is defined in `docs/manifest-v2.md`.

### Source 2: Runtime code
- URL: local repo
- Key points:
  - Manifest required fields: `name`, `version`, `displayName`, `main`, `features`.
  - UI receives init event `plugin:init` with `pluginName`, `featureCode`, `input`, optional `attachments`, `mode`, `route`.
  - Backend context includes `input`, `featureCode`, `attachments`, and `api`.

## Synthesized Findings

### Architecture
- Plugin dev workflow is CLI-driven; packaging produces `.inplugin`.
- APIs are documented in `docs/apis/*` and should be referenced rather than duplicated.

### Plugin Manifest
- `cmds` supports `img`; adding a `scan` feature enables image matching.
