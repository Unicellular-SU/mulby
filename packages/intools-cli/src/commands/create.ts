import * as fs from 'fs-extra'
import * as path from 'path'
import chalk from 'chalk'

interface CreateOptions {
  template: string
}

export async function create(name: string, options: CreateOptions) {
  const targetDir = path.resolve(process.cwd(), name)

  if (fs.existsSync(targetDir)) {
    console.log(chalk.red(`错误: 目录 ${name} 已存在`))
    process.exit(1)
  }

  console.log(chalk.blue(`创建插件项目: ${name}`))

  // 创建目录
  fs.mkdirSync(targetDir, { recursive: true })
  fs.mkdirSync(path.join(targetDir, 'src'))

  // 生成 manifest.json
  const manifest = {
    name,
    version: '1.0.0',
    displayName: name,
    description: '插件描述',
    main: 'dist/main.js',
    features: [
      {
        code: 'main',
        explain: '主功能',
        cmds: [{ type: 'keyword', value: name }]
      }
    ]
  }

  fs.writeJsonSync(
    path.join(targetDir, 'manifest.json'),
    manifest,
    { spaces: 2 }
  )

  console.log(chalk.green('  ✓ manifest.json'))

  // 生成 package.json
  const pkg = {
    name,
    version: '1.0.0',
    scripts: {
      build: 'esbuild src/main.ts --bundle --platform=node --outfile=dist/main.js',
      pack: 'intools pack'
    },
    devDependencies: {
      esbuild: '^0.20.0',
      typescript: '^5.0.0'
    }
  }

  fs.writeJsonSync(
    path.join(targetDir, 'package.json'),
    pkg,
    { spaces: 2 }
  )

  console.log(chalk.green('  ✓ package.json'))

  // 生成 src/main.ts
  const mainTs = `module.exports = {
  async run(context: any) {
    const { clipboard, notification } = context.api
    const { featureCode, input } = context
    const text = input || await clipboard.readText()

    // 在这里实现你的逻辑
    const result = text.toUpperCase()

    await clipboard.writeText(result)
    notification.show('处理完成')
  }
}
`

  fs.writeFileSync(path.join(targetDir, 'src/main.ts'), mainTs)
  console.log(chalk.green('  ✓ src/main.ts'))

  console.log()
  console.log(chalk.green('插件创建成功!'))
  console.log()
  console.log('下一步:')
  console.log(chalk.cyan(`  cd ${name}`))
  console.log(chalk.cyan('  npm install'))
  console.log(chalk.cyan('  npm run build'))
}
