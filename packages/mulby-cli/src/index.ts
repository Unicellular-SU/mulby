#!/usr/bin/env node
import { Command } from 'commander'
import { create } from './commands/create'
import { build } from './commands/build'
import { pack } from './commands/pack'
import { dev } from './commands/dev'
import { configCommand } from './commands/config'
import { createAIConfigCommand } from './commands/config-ai'
import { sessionCommand } from './commands/ai-session'
import { readFileSync } from 'fs'
import { join } from 'path'
import { resume } from './commands/resume'
import chalk from 'chalk'

// 全局错误处理 - 防止进程意外退出
process.on('uncaughtException', (err) => {
  console.error(chalk.red('\n❌ Uncaught Exception:'))
  console.error(chalk.red(err.stack || err.message))
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('\n❌ Unhandled Promise Rejection:'))
  console.error(chalk.red(reason instanceof Error ? reason.stack || reason.message : String(reason)))
  // 不立即退出，让程序有机会处理
})

// 读取 package.json 获取版本号
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))

const program = new Command()

program
  .name('mulby')
  .description('Mulby 插件开发 CLI 工具')
  .version(pkg.version)

program
  .command('create <name>')
  .description('创建新插件项目')
  .option('-t, --template <template>', '模板类型: react (默认) | basic', 'react')
  .option('--ai', '使用 AI 辅助生成插件')
  .option('--desc <description>', '此插件的简单功能描述')
  .option('--resume [sessionId]', '恢复 AI 生成会话')
  .action(create)

program
  .command('build')
  .description('构建插件')
  .action(build)

program
  .command('pack')
  .description('打包成 .inplugin 文件')
  .action(pack)

program
  .command('dev')
  .description('开发模式（热重载）')
  .action(dev)

program
  .command('config <action> [key] [value]')
  .description('管理配置 (get, set, delete, list)')
  .action(configCommand)

// 添加 AI 配置命令（独立的顶级命令）
program.addCommand(createAIConfigCommand())

program
  .command('ai-session <action> [sessionId]')
  .description('管理 AI 会话 (list, resume)')
  .action(sessionCommand)

program
  .command('resume')
  .description('恢复当前目录的 AI 会话')
  .action(resume)

program.parse()
