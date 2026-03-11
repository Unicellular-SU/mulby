module.exports = {
  async run(context) {
    const { clipboard, notification } = context.api
    const rawInput = typeof context.input === 'string' ? context.input : ''
    const clipboardText = await clipboard.readText()
    const text = (rawInput || clipboardText || '').trim()

    if (!text) {
      notification.show('Nothing to process', 'error')
      return
    }

    const result = `[Mulby] ${text}`
    await clipboard.writeText(result)
    notification.show('Prefixed text copied to clipboard')
  }
}
