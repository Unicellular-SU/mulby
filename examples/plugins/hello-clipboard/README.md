# Hello Clipboard

## What it does

- Reads text from `context.input`
- Falls back to clipboard text when input is empty
- Adds a `[Mulby]` prefix
- Writes the result back to the clipboard

## APIs used

- `context.api.clipboard`
- `context.api.notification`

## Why this example exists

This is the smallest useful backend-only example in the repo. Start here if you want to understand the runtime shape of a Mulby plugin.
