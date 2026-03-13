# Plugin Store Index v2 (Rich Metadata)

Use this schema in `plugins.json` to support richer cards in Mulby plugin store.

## Supported plugin fields

```json
{
  "id": "qrcode-helper",
  "name": "qrcode-helper",
  "displayName": "QR Code Helper",
  "version": "1.0.0",
  "author": "Mulby Team",
  "description": "Short summary shown in list cards",
  "details": "Long markdown description shown in expanded details",
  "icon": {
    "type": "url",
    "value": "./plugins/qrcode-helper/icon.png"
  },
  "screenshots": [
    {
      "url": "./plugins/qrcode-helper/screenshots/1.png",
      "caption": "Main screen"
    },
    {
      "url": "./plugins/qrcode-helper/screenshots/2.png"
    }
  ],
  "tags": ["qrcode", "tool"],
  "categories": ["productivity"],
  "license": "MIT",
  "homepage": "https://github.com/Unicellular-SU/mulby_plugins",
  "repository": "https://github.com/Unicellular-SU/mulby_plugins/tree/main/plugins/qrcode-helper",
  "downloadUrl": "https://raw.githubusercontent.com/Unicellular-SU/mulby_plugins/main/releases/qrcode-helper-1.0.0.inplugin",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "lastPackageTime": "2026-03-12T00:00:00.000Z"
}
```

## Backward compatibility

- Existing fields remain valid.
- `description` is still the summary field.
- If `description` is empty, `details` is used as fallback summary.
- `icon` supports:
  - `{ "type": "url", "value": "..." }`
  - `{ "type": "emoji", "value": "*" }`
  - direct string URL or relative path.
- `screenshots` supports:
  - string array (`["./a.png"]`)
  - object array (`[{ "url": "...", "caption": "..." }]`).

## Packaging update notes

When generating `plugins.json` in your plugin source repo:

1. Keep required fields: `id`, `name`, `version`, `description`, `downloadUrl`.
2. Add `details` from README or a generated markdown intro.
3. Add `icon` from manifest or static assets.
4. Add `screenshots` from a `screenshots/` directory when available.
5. Add `license`, `tags`, `categories`, and `repository` when possible.

