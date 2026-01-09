module.exports = {
  async run(context) {
    const { clipboard, notification } = context.api
    const text = await clipboard.readText()

    try {
      const obj = JSON.parse(text)
      const formatted = JSON.stringify(obj, null, 2)
      await clipboard.writeText(formatted)
      notification.show('JSON 格式化成功')
    } catch (e) {
      notification.show('无效的 JSON 格式', 'error')
    }
  }
}
