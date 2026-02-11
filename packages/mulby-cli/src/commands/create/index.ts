import * as fs from 'fs-extra'
import * as path from 'path'
import chalk from 'chalk'
import { createBasicProject } from './basic'
import { createReactProject } from './react'
import { aiCreate } from './ai-create'

export async function create(name: string, options: any) {
  if (options.ai || options.resume) {
    await aiCreate(name, options);
    return;
  }

  const targetDir = path.resolve(process.cwd(), name)

  if (fs.existsSync(targetDir)) {
    console.log(chalk.red(`错误: 目录 ${name} 已存在`))
    process.exit(1)
  }

  const template = options.template || 'react'

  console.log(chalk.blue(`创建插件项目: ${name}`))
  console.log(chalk.gray(`模板: ${template}`))
  console.log()

  if (template === 'react') {
    await createReactProject(targetDir, name)
  } else {
    await createBasicProject(targetDir, name)
  }

  console.log()
  console.log(chalk.green('插件创建成功!'))
  console.log()
  console.log('下一步:')
  console.log(chalk.cyan(`  cd ${name}`))
  console.log(chalk.cyan('  npm install'))
  console.log(chalk.cyan('  npm run dev'))
}
