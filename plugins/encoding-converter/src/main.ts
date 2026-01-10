// 后端逻辑 - 在沙箱中运行
// 如果插件有 UI，此文件可以为空或用于后台任务

module.exports = {
  // 插件加载时调用
  onLoad() {
    console.log('插件已加载')
  },

  // 插件卸载时调用
  onUnload() {
    console.log('插件已卸载')
  },

  // 主执行函数（无 UI 时使用）
  async run(context: any) {
    const { notification } = context.api
    notification.show('插件已启动')
  }
}
