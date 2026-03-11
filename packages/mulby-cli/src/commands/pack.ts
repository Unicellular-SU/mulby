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
  return new Promise((resolve, reject) => {
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

        // 当有 preload 时，打包 node_modules 中的生产依赖
        const nodeModulesDir = path.join(cwd, 'node_modules')
        const pkgJsonPath = path.join(cwd, 'package.json')

        if (fs.existsSync(nodeModulesDir) && fs.existsSync(pkgJsonPath)) {
          const pkgJson = fs.readJsonSync(pkgJsonPath)
          const dependencies = Object.keys(pkgJson.dependencies || {})

          if (dependencies.length > 0) {
            console.log(chalk.gray('  + node_modules/ (生产依赖)'))

            // 打包每个生产依赖及其子依赖
            for (const dep of dependencies) {
              const depPath = path.join(nodeModulesDir, dep)
              if (fs.existsSync(depPath)) {
                archive.directory(depPath, `node_modules/${dep}`)
              }
            }

            // 递归收集所有需要的依赖（包括依赖的依赖）
            const allDeps = collectAllDependencies(cwd, dependencies)
            for (const dep of allDeps) {
              if (!dependencies.includes(dep)) {
                const depPath = path.join(nodeModulesDir, dep)
                if (fs.existsSync(depPath)) {
                  archive.directory(depPath, `node_modules/${dep}`)
                }
              }
            }
          }
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

/**
 * 递归收集所有依赖（包括依赖的依赖）
 */
function collectAllDependencies(cwd: string, dependencies: string[]): string[] {
  const nodeModulesDir = path.join(cwd, 'node_modules')
  const collected = new Set<string>()
  const queue = [...dependencies]

  while (queue.length > 0) {
    const dep = queue.shift()!
    if (collected.has(dep)) continue
    collected.add(dep)

    // 读取该依赖的 package.json 获取其依赖
    const depPkgPath = path.join(nodeModulesDir, dep, 'package.json')
    if (fs.existsSync(depPkgPath)) {
      try {
        const depPkg = fs.readJsonSync(depPkgPath)
        const subDeps = Object.keys(depPkg.dependencies || {})
        for (const subDep of subDeps) {
          if (!collected.has(subDep)) {
            queue.push(subDep)
          }
        }
      } catch {
        // 忽略读取错误
      }
    }
  }

  return Array.from(collected)
}

