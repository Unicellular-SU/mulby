module.exports = {
  async run(context) {
    const { clipboard, notification } = context.api

    let value = new Date().toISOString()
    if (context.featureCode === 'unix-now') {
      value = String(Math.floor(Date.now() / 1000))
    }

    await clipboard.writeText(value)
    notification.show(`Copied: ${value}`)
  }
}
