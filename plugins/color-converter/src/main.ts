// 后端逻辑 - 颜色转换器
module.exports = {
  onLoad() {
    console.log('颜色转换器已加载')
  },

  onUnload() {
    console.log('颜色转换器已卸载')
  },

  async run(context: any) {
    const { notification } = context.api
    notification.show('颜色转换器已启动')
  }
}
