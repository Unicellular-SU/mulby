import * as fs from 'fs-extra'
import * as path from 'path'
import archiver from 'archiver'
import chalk from 'chalk'

interface PluginPackageManifest {
  name: string
  version: string
  preload?: string
  dependencies?: Record<string, string>
}

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
  manifest: PluginPackageManifest
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    const output = fs.createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => resolve())
    archive.on('error', (err: Error) => reject(err))

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

    // 添加 preload 脚本（如果在 manifest 中配置了）
    if (manifest.preload) {
      const preloadPath = path.join(cwd, manifest.preload)
      if (fs.existsSync(preloadPath)) {
        archive.file(preloadPath, { name: manifest.preload })
        console.log(chalk.gray(`  + ${manifest.preload}`))

        try {
          console.log(chalk.blue('  使用 @vercel/nft 分析 preload 依赖...'))
          const { nodeFileTrace } = await import('@vercel/nft')
          const { fileList } = await nodeFileTrace([preloadPath], {
            base: cwd
          })

          let depsCount = 0
          for (const file of fileList) {
            // 跳过 preload 文件自身，上面已经单独处理了
            if (file === manifest.preload) continue

            const abspath = path.join(cwd, file)
            if (fs.existsSync(abspath)) {
              const stat = fs.statSync(abspath)
              // 只打包真实存在的文件
              if (stat.isFile()) {
                archive.file(abspath, { name: file })
                depsCount++
              }
            }
          }
          console.log(chalk.green(`  ✓ 已精确打包 ${depsCount} 个 preload 依赖文件 (告别冗余)`))
        } catch (err) {
          console.log(chalk.yellow(`  ⚠️ 解析 preload 依赖时出错: ${err}`))
        }
      } else {
        console.log(chalk.yellow(`警告: preload 文件不存在: ${manifest.preload}`))
      }
    }

    // 添加 README.md（如果存在）
    const readmePath = path.join(cwd, 'README.md')
    if (fs.existsSync(readmePath)) {
      archive.file(readmePath, { name: 'README.md' })
    }

    archive.finalize()
  })
}


