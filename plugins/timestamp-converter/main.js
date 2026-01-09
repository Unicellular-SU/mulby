module.exports = {
  async run(context) {
    const { clipboard, notification } = context.api
    const { featureCode, input } = context
    const text = input || await clipboard.readText()
    let result

    if (featureCode === 'toTimestamp') {
      result = String(new Date(text).getTime())
    } else {
      const ts = text.length === 10 ? text * 1000 : Number(text)
      result = new Date(ts).toLocaleString()
    }

    await clipboard.writeText(result)
    notification.show('转换完成: ' + result)
  }
}
