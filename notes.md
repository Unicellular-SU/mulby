# Notes: Img Cmd Extension Filter

## Sources

### Source 1: Plugin manager matching
- URL: local repo
- Key points:
  - `img` matching is handled in `PluginManager.search`.
  - `files` matching already filters by extension.

## Synthesized Findings

### Architecture
- Extend `CmdImg` to accept optional `exts` and filter image attachments accordingly.

### Plugin Manifest
- `cmds` supports `img`; adding a `scan` feature enables image matching.
