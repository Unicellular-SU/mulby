let backgroundTimer = null
let counter = 0

export default {
  onLoad({ api }) {
    console.log('[BackgroundTest] Plugin loaded')
    api.notification.show('后台测试插件已加载')
  },

  onBackground({ api }) {
    console.log('[BackgroundTest] Entering background mode')
    api.notification.show('插件进入后台运行')

    // 启动后台定时器，每10秒显示一次通知
    backgroundTimer = setInterval(() => {
      counter++
      console.log(`[BackgroundTest] Background tick: ${counter}`)
      api.notification.show(`后台运行中 (${counter})`)
    }, 10000)
  },

  onForeground({ api }) {
    console.log('[BackgroundTest] Returning to foreground')
    api.notification.show('插件回到前台')

    // 清理后台定时器
    if (backgroundTimer) {
      clearInterval(backgroundTimer)
      backgroundTimer = null
    }
  },

  onUnload({ api }) {
    console.log('[BackgroundTest] Plugin unloading')

    // 清理定时器
    if (backgroundTimer) {
      clearInterval(backgroundTimer)
      backgroundTimer = null
    }

    api.notification.show(`后台测试插件已卸载 (运行了 ${counter} 次)`)
  },

  run({ api, input }) {
    api.notification.show('后台测试插件运行: ' + input)
    console.log('[BackgroundTest] Run with input:', input)
  }
}
