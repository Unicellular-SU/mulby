module.exports = {
  async run(context) {
    const { clipboard, notification } = context.api
    const { featureCode, input } = context
    const text = input || await clipboard.readText()
    let result

    if (featureCode === 'decode') {
      result = Buffer.from(text, 'base64').toString('utf-8')
      notification.show('Base64 解码成功')
    } else {
      result = Buffer.from(text).toString('base64')
      notification.show('Base64 编码成功')
    }

    await clipboard.writeText(result)
  }
}
