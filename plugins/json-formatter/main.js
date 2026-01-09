module.exports = {
  async run(context) {
    const { clipboard, notification } = context.api
    const { featureCode, input } = context
    const text = input || await clipboard.readText()

    try {
      const obj = JSON.parse(text)
      let result

      if (featureCode === 'minify') {
        result = JSON.stringify(obj)
        notification.show('JSON 压缩成功')
      } else {
        result = JSON.stringify(obj, null, 2)
        notification.show('JSON 格式化成功')
      }

      await clipboard.writeText(result)
    } catch (e) {
      notification.show('无效的 JSON 格式', 'error')
    }
  }
}
