import * as fs from 'fs-extra'
import * as path from 'path'
import chalk from 'chalk'
import { buildMulbyTypes, buildUseMulby } from './create/templates/react/index.js'

/**
 * 更新已有插件项目中的 MulbyTypes 和 UseMulby hook。
 *
 * 扫描策略：
 * 1. mulby.d.ts — 按优先级查找 src/types/mulby.d.ts → 任意 mulby.d.ts
 * 2. useMulby.ts — 按优先级查找 src/ui/hooks/useMulby.ts → 任意 useMulby.ts
 */
export async function updateTypes(options: { dryRun?: boolean; yes?: boolean }) {
  const cwd = process.cwd()
  const manifestPath = path.join(cwd, 'manifest.json')

  if (!fs.existsSync(manifestPath)) {
    console.log(chalk.red('错误: 当前目录不是 Mulby 插件项目（未找到 manifest.json）'))
    process.exit(1)
  }

  const manifest = fs.readJsonSync(manifestPath)
  console.log(chalk.blue(`插件: ${manifest.displayName || manifest.name} v${manifest.version || '?'}`))
  console.log()

  // --- 1. 定位 mulby.d.ts ---
  const typesFile = resolveFile(cwd, [
    'src/types/mulby.d.ts',
    'types/mulby.d.ts',
    'mulby.d.ts',
  ])

  // --- 2. 定位 useMulby.ts ---
  const hookFile = resolveFile(cwd, [
    'src/ui/hooks/useMulby.ts',
    'src/hooks/useMulby.ts',
    'src/useMulby.ts',
  ])

  if (!typesFile && !hookFile) {
    console.log(chalk.yellow('未找到 mulby.d.ts 或 useMulby.ts，无需更新。'))
    return
  }

  // --- 3. 生成最新内容 ---
  const latestTypes = buildMulbyTypes()
  const latestHook = buildUseMulby()

  const updates: { file: string; label: string; content: string }[] = []

  if (typesFile) {
    const current = fs.readFileSync(typesFile, 'utf-8')
    if (current.trim() === latestTypes.trim()) {
      console.log(chalk.gray(`  • mulby.d.ts    — 已是最新`))
    } else {
      updates.push({
        file: typesFile,
        label: `mulby.d.ts (${path.relative(cwd, typesFile)})`,
        content: latestTypes,
      })
    }
  }

  if (hookFile) {
    const current = fs.readFileSync(hookFile, 'utf-8')
    if (current.trim() === latestHook.trim()) {
      console.log(chalk.gray(`  • useMulby.ts   — 已是最新`))
    } else {
      updates.push({
        file: hookFile,
        label: `useMulby.ts (${path.relative(cwd, hookFile)})`,
        content: latestHook,
      })
    }
  }

  if (updates.length === 0) {
    console.log()
    console.log(chalk.green('✓ 所有文件已是最新，无需更新。'))
    return
  }

  // --- 4. 显示待更新列表 ---
  console.log()
  console.log(chalk.yellow(`待更新 ${updates.length} 个文件:`))
  for (const u of updates) {
    console.log(chalk.cyan(`  → ${u.label}`))
  }

  if (options.dryRun) {
    console.log()
    console.log(chalk.gray('--dry-run 模式，未执行任何写入。'))
    return
  }

  // --- 5. 确认 ---
  if (!options.yes) {
    const inquirer = await import('inquirer')
    const { confirm } = await inquirer.default.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: '确认覆盖以上文件？',
        default: true,
      },
    ])
    if (!confirm) {
      console.log(chalk.gray('已取消。'))
      return
    }
  }

  // --- 6. 写入 ---
  for (const u of updates) {
    fs.writeFileSync(u.file, u.content, 'utf-8')
    console.log(chalk.green(`  ✓ ${u.label}`))
  }

  console.log()
  console.log(chalk.green('✓ 类型定义已更新到最新版本。'))
}

/**
 * 按优先级查找文件，返回第一个存在的绝对路径，或 null。
 */
function resolveFile(cwd: string, candidates: string[]): string | null {
  for (const rel of candidates) {
    const abs = path.join(cwd, rel)
    if (fs.existsSync(abs)) return abs
  }
  return null
}
