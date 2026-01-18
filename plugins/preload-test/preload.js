// 插件自定义 preload 脚本
// 测试 Node.js 原生模块的访问

const fs = require('fs')
const os = require('os')
const path = require('path')

// 通过 window 暴露给前端
window.customApi = {
    // 获取系统信息
    getSystemInfo: () => ({
        homeDir: os.homedir(),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        hostname: os.hostname()
    }),

    // 读取文件
    readFile: (filePath) => {
        try {
            return fs.readFileSync(filePath, 'utf-8')
        } catch (error) {
            return `读取失败: ${error.message}`
        }
    },

    // 列出目录
    listDir: (dirPath) => {
        try {
            return fs.readdirSync(dirPath)
        } catch (error) {
            return [`读取失败: ${error.message}`]
        }
    },

    // 路径操作
    path: {
        join: (...args) => path.join(...args),
        dirname: (p) => path.dirname(p),
        basename: (p) => path.basename(p)
    }
}

console.log('[Preload Test] 自定义 preload 已加载')
