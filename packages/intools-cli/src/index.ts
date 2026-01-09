#!/usr/bin/env node
import { Command } from 'commander'
import { create } from './commands/create'
import { build } from './commands/build'
import { pack } from './commands/pack'
import { dev } from './commands/dev'

const program = new Command()

program
  .name('intools')
  .description('InTools 插件开发 CLI 工具')
  .version('1.0.0')

program
  .command('create <name>')
  .description('创建新插件项目')
  .option('-t, --template <template>', '模板类型', 'basic')
  .option('-u, --ui <type>', 'UI 类型: html | react')
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

program.parse()
