// 简单的后端入口 (CommonJS 格式)
function onLoad() {
    console.log('[preload-test] 插件已加载')
}

function run() {
    console.log('[preload-test] 插件运行')
}

module.exports = { onLoad, run }
