import * as fs from 'fs-extra'
import * as path from 'path'
import archiver from 'archiver'
import chalk from 'chalk'
import type { Archiver } from 'archiver'

interface PluginPackageManifest {
  name: string
  version: string
  preload?: string
  dependencies?: Record<string, string>
  assets?: string[]
}

type PackageJson = {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

type ArchiveStats = {
  files: number
  packages: number
}

type AddPathOptions = {
  sourcePath: string
  archivePath: string
}

const ENTRY_MAIN_ARCHIVE_NAME = 'main.js'

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
    const addedArchivePaths = new Set<string>()
    const addedPackages = new Set<string>()

    // 添加 manifest.json
    addFileToArchive(archive, addedArchivePaths, {
      sourcePath: path.join(cwd, 'manifest.json'),
      archivePath: 'manifest.json'
    })

    // 添加打包后的 main.js
    const distMainPath = path.join(cwd, 'dist/main.js')
    addFileToArchive(archive, addedArchivePaths, {
      sourcePath: distMainPath,
      archivePath: ENTRY_MAIN_ARCHIVE_NAME
    })

    await addTracedRuntimeDependencies(archive, cwd, distMainPath, '后端 main.js', addedArchivePaths, addedPackages, {
      skipArchivePaths: new Set(['dist/main.js', ENTRY_MAIN_ARCHIVE_NAME])
    })

    // 添加图标（如果存在）
    const iconPath = path.join(cwd, 'icon.png')
    if (fs.existsSync(iconPath)) {
      addFileToArchive(archive, addedArchivePaths, {
        sourcePath: iconPath,
        archivePath: 'icon.png'
      })
    }

    // 添加 UI 目录（如果存在）
    const uiDir = path.join(cwd, 'ui')
    if (fs.existsSync(uiDir)) {
      addPathToArchive(archive, addedArchivePaths, {
        sourcePath: uiDir,
        archivePath: 'ui'
      })
    }

    // 添加 preload 脚本（如果在 manifest 中配置了）
    if (manifest.preload) {
      const preloadPath = path.join(cwd, manifest.preload)
      if (fs.existsSync(preloadPath)) {
        addFileToArchive(archive, addedArchivePaths, {
          sourcePath: preloadPath,
          archivePath: manifest.preload
        })
        console.log(chalk.gray(`  + ${manifest.preload}`))
        await addTracedRuntimeDependencies(archive, cwd, preloadPath, 'preload', addedArchivePaths, addedPackages, {
          skipArchivePaths: new Set([manifest.preload])
        })
      } else {
        console.log(chalk.yellow(`警告: preload 文件不存在: ${manifest.preload}`))
      }
    }

    // 添加 README.md（如果存在）
    const readmePath = path.join(cwd, 'README.md')
    if (fs.existsSync(readmePath)) {
      addFileToArchive(archive, addedArchivePaths, {
        sourcePath: readmePath,
        archivePath: 'README.md'
      })
    }

    // 添加自定义 assets 目录/文件（如果有）
    if (manifest.assets && Array.isArray(manifest.assets)) {
      for (const assetPath of manifest.assets) {
        const fullPath = path.join(cwd, assetPath)
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath)
          if (stat.isDirectory()) {
            addPathToArchive(archive, addedArchivePaths, {
              sourcePath: fullPath,
              archivePath: assetPath
            })
            console.log(chalk.gray(`  + 目录: ${assetPath}/`))
          } else if (stat.isFile()) {
            addFileToArchive(archive, addedArchivePaths, {
              sourcePath: fullPath,
              archivePath: assetPath
            })
            console.log(chalk.gray(`  + 文件: ${assetPath}`))
          }
        } else {
          console.log(chalk.yellow(`警告: assets 配置的路径不存在: ${assetPath}`))
        }
      }
    }

    archive.finalize()
  })
}

async function addTracedRuntimeDependencies(
  archive: Archiver,
  cwd: string,
  entryPath: string,
  label: string,
  addedArchivePaths: Set<string>,
  addedPackages: Set<string>,
  options?: { skipArchivePaths?: Set<string> }
): Promise<void> {
  try {
    console.log(chalk.blue(`  使用 @vercel/nft 分析 ${label} 依赖...`))
    const { nodeFileTrace } = await import('@vercel/nft')
    const { fileList, warnings } = await nodeFileTrace([entryPath], {
      base: cwd,
      processCwd: cwd
    })

    const stats: ArchiveStats = { files: 0, packages: 0 }
    const beforeFiles = addedArchivePaths.size

    for (const warning of warnings) {
      console.log(chalk.yellow(`  ⚠️ ${label} 依赖解析警告: ${warning.message}`))
    }

    for (const file of fileList) {
      const normalizedFile = normalizeArchivePath(file)
      if (!normalizedFile || options?.skipArchivePaths?.has(normalizedFile)) continue

      const packageName = getPackageNameFromNodeModulesPath(normalizedFile)
      if (packageName) {
        addPackageWithDependencies(archive, cwd, packageName, addedArchivePaths, addedPackages, stats)
        continue
      }

      const sourcePath = path.join(cwd, normalizedFile)
      if (!fs.existsSync(sourcePath)) continue
      addPathToArchive(archive, addedArchivePaths, {
        sourcePath,
        archivePath: normalizedFile
      }, stats)
    }

    const addedFiles = addedArchivePaths.size - beforeFiles
    console.log(chalk.green(`  ✓ 已打包 ${label} 运行时依赖: ${addedFiles} 个文件，${stats.packages} 个包`))
  } catch (err) {
    console.log(chalk.yellow(`  ⚠️ 解析 ${label} 依赖时出错: ${err}`))
  }
}

function addPackageWithDependencies(
  archive: Archiver,
  cwd: string,
  packageName: string,
  addedArchivePaths: Set<string>,
  addedPackages: Set<string>,
  stats: ArchiveStats,
  importerRealPath?: string,
  archivePackagePath = packageNameToArchivePath(packageName),
  required = true
): void {
  if (addedPackages.has(archivePackagePath)) return

  const packageRoot = resolvePackageRoot(cwd, packageName, importerRealPath)
  if (!packageRoot) {
    if (required) {
      console.log(chalk.yellow(`  ⚠️ 依赖包未安装，跳过: ${packageName}`))
    }
    return
  }

  addedPackages.add(archivePackagePath)
  stats.packages++
  addPathToArchive(archive, addedArchivePaths, {
    sourcePath: packageRoot,
    archivePath: archivePackagePath
  }, stats)

  const packageJsonPath = path.join(packageRoot, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return

  let packageJson: PackageJson
  try {
    packageJson = fs.readJsonSync(packageJsonPath) as PackageJson
  } catch {
    return
  }

  const dependencies = Object.keys(packageJson.dependencies || {})
  const optionalDependencies = Object.keys(packageJson.optionalDependencies || {})

  for (const dependencyName of dependencies) {
    addPackageWithDependencies(
      archive,
      cwd,
      dependencyName,
      addedArchivePaths,
      addedPackages,
      stats,
      packageRoot,
      path.posix.join(archivePackagePath, 'node_modules', ...dependencyName.split('/')),
      true
    )
  }

  for (const dependencyName of optionalDependencies) {
    addPackageWithDependencies(
      archive,
      cwd,
      dependencyName,
      addedArchivePaths,
      addedPackages,
      stats,
      packageRoot,
      path.posix.join(archivePackagePath, 'node_modules', ...dependencyName.split('/')),
      false
    )
  }
}

function resolvePackageRoot(cwd: string, packageName: string, importerRealPath?: string): string | null {
  const candidates: string[] = []

  if (importerRealPath) {
    let current = importerRealPath
    while (true) {
      candidates.push(path.join(current, 'node_modules', ...packageName.split('/')))
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }

  candidates.push(path.join(cwd, 'node_modules', ...packageName.split('/')))

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue
    try {
      return fs.realpathSync(candidate)
    } catch {
      return candidate
    }
  }

  return null
}

function addPathToArchive(
  archive: Archiver,
  addedArchivePaths: Set<string>,
  input: AddPathOptions,
  stats?: ArchiveStats
): void {
  const archivePath = normalizeArchivePath(input.archivePath)
  if (!archivePath || !fs.existsSync(input.sourcePath)) return

  const lstat = fs.lstatSync(input.sourcePath)
  if (lstat.isSymbolicLink()) {
    const realPath = fs.realpathSync(input.sourcePath)
    addPathToArchive(archive, addedArchivePaths, { sourcePath: realPath, archivePath }, stats)
    return
  }

  if (lstat.isDirectory()) {
    for (const entry of fs.readdirSync(input.sourcePath)) {
      addPathToArchive(archive, addedArchivePaths, {
        sourcePath: path.join(input.sourcePath, entry),
        archivePath: path.posix.join(archivePath, entry)
      }, stats)
    }
    return
  }

  if (lstat.isFile()) {
    addFileToArchive(archive, addedArchivePaths, { sourcePath: input.sourcePath, archivePath }, stats)
  }
}

function addFileToArchive(
  archive: Archiver,
  addedArchivePaths: Set<string>,
  input: AddPathOptions,
  stats?: ArchiveStats
): void {
  const archivePath = normalizeArchivePath(input.archivePath)
  if (!archivePath || addedArchivePaths.has(archivePath)) return
  addedArchivePaths.add(archivePath)
  archive.file(input.sourcePath, { name: archivePath })
  if (stats) stats.files++
}

function normalizeArchivePath(input: string): string | null {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    return null
  }
  return normalized
}

function getPackageNameFromNodeModulesPath(input: string): string | null {
  const parts = normalizeArchivePath(input)?.split('/') || []
  const nodeModulesIndex = parts.lastIndexOf('node_modules')
  if (nodeModulesIndex < 0 || nodeModulesIndex >= parts.length - 1) return null

  const first = parts[nodeModulesIndex + 1]
  if (!first) return null
  if (first.startsWith('@')) {
    const second = parts[nodeModulesIndex + 2]
    return second ? `${first}/${second}` : null
  }
  return first
}

function packageNameToArchivePath(packageName: string): string {
  return path.posix.join('node_modules', ...packageName.split('/'))
}
