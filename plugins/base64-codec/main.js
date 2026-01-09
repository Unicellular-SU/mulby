module.exports = {
  async run(context) {
    const { clipboard, notification } = context.api
    const text = await clipboard.readText()
    let result

    try {
      result = Buffer.from(text, 'base64').toString('utf-8')
      if (Buffer.from(result).toString('base64') !== text) {
        result = Buffer.from(text).toString('base64')
      }
    } catch {
      result = Buffer.from(text).toString('base64')
    }

    await clipboard.writeText(result)
    notification.show('已复制到剪贴板')
  }
}
