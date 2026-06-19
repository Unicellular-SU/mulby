// Mulby 插件验证 harness 的测试夹具（CommonJS）。
//
// host-worker 通过 require 加载本文件，并调用导出的生命周期函数：
//   - onLoad(context)          插件首次加载时
//   - run(context)             触发某个功能时（context.featureCode / context.input）
//
// 该夹具是一个纯静默插件（manifest.features[].mode = 'silent'，无 ui），
// 用于验证「加载 → onLoad → 触发匹配 → 执行」整条链路。

exports.onLoad = function onLoad() {
  console.log('[verify-hello] onLoad ok')
}

exports.run = function run(context) {
  const featureCode = context && context.featureCode
  const input = context && context.input
  console.log('[verify-hello] run feature=' + featureCode + ' input=' + String(input))
}
