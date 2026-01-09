module.exports = {
  async run(context) {
    const { clipboard, notification } = context.api
    const text = await clipboard.readText()
    let result

    if (/^\d{10,13}$/.test(text)) {
      const ts = text.length === 10 ? text * 1000 : Number(text)
      result = new Date(ts).toLocaleString()
    } else {
      result = String(new Date(text).getTime())
    }

    await clipboard.writeText(result)
    notification.show('转换完成: ' + result)
  }
}
