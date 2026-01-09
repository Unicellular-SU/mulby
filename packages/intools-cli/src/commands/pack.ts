import * as fs from 'fs-extra'
import * as path from 'path'
import archiver from 'archiver'
import chalk from 'chalk'

export async function pack() {
  const cwd = process.cwd()
  const manifestPath = path.join(cwd, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    console.log(chalk.red('错误: 未找到 manifest.json'))
    process.exit(1)
  }

  const manifest = fs.readJsonSync(manifestPath)
  const distMain = path.join(cwd, 'dist/main.js')

  if (!fs.existsSync(distMain)) {
    console.log(chalk.red('错误: 未找到 dist/main.js，请先运行 build'))
    process.exit(1)
  }

  const outputName = `${manifest.name}-${manifest.version}.inplugin`
  const outputPath = path.join(cwd, outputName)

  console.log(chalk.blue(`打包插件: ${outputName}`))

  await createArchive(cwd, outputPath, manifest)

  console.log(chalk.green(`✓ 打包成功: ${outputName}`))
}

async function createArchive(
  cwd: string,
  outputPath: string,
  manifest: any
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => resolve())
    archive.on('error', (err) => reject(err))

    archive.pipe(output)

    // 添加 manifest.json
    archive.file(path.join(cwd, 'manifest.json'), { name: 'manifest.json' })

    // 添加打包后的 main.js
    archive.file(path.join(cwd, 'dist/main.js'), { name: 'main.js' })

    // 添加图标（如果存在）
    const iconPath = path.join(cwd, 'icon.png')
    if (fs.existsSync(iconPath)) {
      archive.file(iconPath, { name: 'icon.png' })
    }

    // 添加 UI 目录（如果存在）
    const uiDir = path.join(cwd, 'ui')
    if (fs.existsSync(uiDir)) {
      archive.directory(uiDir, 'ui')
    }

    archive.finalize()
  })
}
