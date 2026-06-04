import { ipcMain, dialog, shell } from 'electron'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { spawn } from 'child_process'
import { appSettingsManager } from '../services/app-settings'
import { PluginManager } from '../plugin'
import { buildProjectEntry, dedupeProjects } from '../plugin/plugin-project-utils'
import { validatePluginAt } from '../plugin/plugin-validator'
import type {
  PluginProjectSource
} from '../../shared/types/settings'
import type {
  AddPluginProjectResult,
  BuildPluginResult,
  CreatePluginResult,
  DeveloperOpResult,
  PackPluginResult,
  PluginProjectStatus,
  PluginValidationResult
} from '../../shared/types/developer'

/**
 * 开发者模式相关的 IPC 处理器。
 *
 * 保留 LEGACY 的 4 个 handler（addPluginPath/removePluginPath/reloadPlugins/selectDirectory），
 * 新增基于 pluginProjects[] 模型的项目管理、校验、脚手架、构建/打包等能力（设计 §4.4）。
 */
export function registerDeveloperHandlers(pluginManager: PluginManager) {
    // ==================== LEGACY（保留向后兼容） ====================

    // 添加开发目录（旧：直接写 pluginPaths）
    ipcMain.handle('developer:addPluginPath', async (_event, path: string) => {
        const settings = appSettingsManager.getSettings()

        if (settings.developer.pluginPaths.includes(path)) {
            return { success: false, error: '目录已存在' }
        }

        if (!existsSync(path)) {
            return { success: false, error: '目录不存在' }
        }

        appSettingsManager.updateSettings({
            developer: {
                ...settings.developer,
                pluginPaths: [...settings.developer.pluginPaths, path]
            }
        })

        await pluginManager.init()

        return { success: true }
    })

    // 移除开发目录（旧）
    ipcMain.handle('developer:removePluginPath', async (_event, path: string) => {
        const settings = appSettingsManager.getSettings()

        appSettingsManager.updateSettings({
            developer: {
                ...settings.developer,
                pluginPaths: settings.developer.pluginPaths.filter(p => p !== path)
            }
        })

        await pluginManager.init()

        return { success: true }
    })

    // 刷新全部插件（旧：全量重载）
    ipcMain.handle('developer:reloadPlugins', async () => {
        await pluginManager.init()
        return { success: true }
    })

    // 选择目录对话框
    ipcMain.handle('developer:selectDirectory', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: '选择插件开发目录'
        })

        if (result.canceled || result.filePaths.length === 0) {
            return null
        }

        return result.filePaths[0]
    })

    // ==================== NEW（pluginProjects[] 模型） ====================

    // 添加开发项目（自动判别 single/collection）
    ipcMain.handle(
        'developer:addPluginProject',
        async (_event, args: { path: string; source?: PluginProjectSource }): Promise<AddPluginProjectResult> => {
            const inputPath = args?.path
            if (!inputPath || !existsSync(inputPath)) {
                return { success: false, error: '目录不存在' }
            }

            const settings = appSettingsManager.getSettings()
            const result = buildProjectEntry(inputPath, args?.source, settings.developer.pluginProjects)
            if (!result.ok || !result.entry) {
                return { success: false, error: result.error || '无法添加项目' }
            }

            appSettingsManager.updateSettings({
                developer: {
                    ...settings.developer,
                    pluginProjects: dedupeProjects([...settings.developer.pluginProjects, result.entry])
                }
            })

            // 增量加载该项目，避免全量 init() 关闭活动窗口/重载全部插件导致卡死
            const { errors } = await pluginManager.loadDevProject(result.entry)
            if (errors.length > 0) {
                return { success: true, project: result.entry, warning: errors.join('；') }
            }
            return { success: true, project: result.entry }
        }
    )

    // 移除开发项目（仅改设置与运行态，不删磁盘文件）
    ipcMain.handle(
        'developer:removePluginProject',
        async (_event, args: { id?: string; path?: string }): Promise<DeveloperOpResult> => {
            const settings = appSettingsManager.getSettings()
            const projects = settings.developer.pluginProjects
            const targetPath = args?.path ? resolve(args.path) : undefined
            const target = projects.find(
                (p) => (args?.id && p.id === args.id) || (targetPath && resolve(p.path) === targetPath)
            )
            if (!target) {
                return { success: false, error: '项目不存在' }
            }

            appSettingsManager.updateSettings({
                developer: {
                    ...settings.developer,
                    pluginProjects: projects.filter((p) => p !== target)
                }
            })

            // 增量卸载该项目下插件（不删磁盘文件、不全量 init）
            await pluginManager.unloadDevProject([target.path])

            return { success: true }
        }
    )

    // 局部重载单个插件
    ipcMain.handle(
        'developer:reloadPlugin',
        async (_event, args: { pluginId: string }): Promise<DeveloperOpResult> => {
            const pluginId = args?.pluginId
            if (!pluginId) {
                return { success: false, error: '缺少 pluginId' }
            }
            return pluginManager.reloadPlugin(pluginId)
        }
    )

    // 按目录路径刷新载入（用于“未加载”插件：此时无可用 pluginId）
    ipcMain.handle(
        'developer:reloadPluginByPath',
        async (_event, args: { path: string }): Promise<DeveloperOpResult> => {
            const inputPath = args?.path
            if (!inputPath || !existsSync(inputPath)) {
                return { success: false, error: '目录不存在' }
            }

            const settings = appSettingsManager.getSettings()
            // 优先复用 pluginProjects 中已登记的 entry（按 resolve 后绝对路径匹配）。
            // 已登记插件多处于“已登记未加载”态，若直接走 buildProjectEntry 会被其
            // “项目已存在”判定拦截而重载失败；故先查表复用，找不到再新建。
            const resolvedPath = resolve(inputPath)
            let entry = settings.developer.pluginProjects.find(
                (p) => resolve(p.path) === resolvedPath
            )
            if (!entry) {
                const result = buildProjectEntry(inputPath, 'added', settings.developer.pluginProjects)
                if (!result.ok || !result.entry) {
                    return { success: false, error: result.error || '无法识别为有效插件目录' }
                }
                entry = result.entry
            }

            // 无条件按 entry 载入（复用或新建均走同一路径）
            const { loaded, errors } = await pluginManager.loadDevProject(entry)
            if (loaded.length > 0) {
                return { success: true }
            }
            return { success: false, error: errors.join('；') || '未加载到任何插件' }
        }
    )

    // 校验单个插件目录（不落库）
    ipcMain.handle(
        'developer:validatePlugin',
        async (_event, args: { path: string }): Promise<PluginValidationResult> => {
            const p = args?.path
            if (!p || !existsSync(p)) {
                return { valid: false, errors: ['目录不存在'], warnings: [], built: false, mainEntryFound: false }
            }
            return validatePluginAt(p)
        }
    )

    // 列出开发项目 + 其下插件运行态
    // 加固：getPluginProjectStatus 内部已对每个插件 try-catch 隔离；此处再包一层外层兜底，
    // 确保该 handler 在任何异常下都会 resolve（返回空数组），杜绝开发者工具刷新图标永久 loading。
    ipcMain.handle(
        'developer:listPluginProjects',
        async (): Promise<PluginProjectStatus[]> => {
            try {
                const settings = appSettingsManager.getSettings()
                return pluginManager.getPluginProjectStatus(settings.developer.pluginProjects)
            } catch {
                return []
            }
        }
    )

    // 通过 npx mulby-cli 创建新插件（脚手架）
    ipcMain.handle(
        'developer:createPlugin',
        async (
            _event,
            args: { targetDir: string; name: string; template?: 'react' | 'basic' }
        ): Promise<CreatePluginResult> => {
            const targetDir = args?.targetDir
            const name = args?.name
            if (!targetDir || !existsSync(targetDir)) {
                return { success: false, log: '', error: '目标目录不存在' }
            }
            if (!name || !/^[\w.-]+$/.test(name)) {
                return { success: false, log: '', error: '插件名称无效（仅允许字母、数字、. _ -）' }
            }

            const skillDir =
                process.env.MULBY_DEV_SKILL_DIR ||
                join(homedir(), '.cursor', 'skills', 'develop-mulby-plugin')
            const script = join(skillDir, 'scripts', 'invoke_mulby_cli.mjs')
            if (!existsSync(script)) {
                return {
                    success: false,
                    log: '',
                    error: `找不到 mulby-cli 调用脚本：${script}。请设置 MULBY_DEV_SKILL_DIR 或安装 develop-mulby-plugin 技能。`
                }
            }

            const template = args?.template === 'basic' ? 'basic' : 'react'
            const { code, log } = await spawnCollect(
                process.execPath,
                [script, 'create', name, '--template', template],
                resolve(targetDir)
            )

            if (code !== 0) {
                return {
                    success: false,
                    log,
                    error: `脚手架创建失败（exit ${code}）。可能未联网或 mulby-cli 不可用，请手动执行 mulby create 或改用"导入目录"。`
                }
            }

            const createdPath = join(resolve(targetDir), name)
            // 创建成功后自动登记为 created 来源的开发项目
            const settings = appSettingsManager.getSettings()
            const entryResult = buildProjectEntry(createdPath, 'created', settings.developer.pluginProjects)
            if (entryResult.ok && entryResult.entry) {
                appSettingsManager.updateSettings({
                    developer: {
                        ...settings.developer,
                        pluginProjects: dedupeProjects([...settings.developer.pluginProjects, entryResult.entry])
                    }
                })
                // 增量加载新建项目，避免全量 init() 卡死
                await pluginManager.loadDevProject(entryResult.entry)
            }

            return { success: true, path: createdPath, log }
        }
    )

    // 构建插件（宿主 spawn npm run build，流式日志）
    ipcMain.handle(
        'developer:buildPlugin',
        async (_event, args: { path: string }): Promise<BuildPluginResult> => {
            const p = args?.path
            if (!p || !existsSync(p)) {
                return { success: false, log: '', error: '目录不存在' }
            }
            const cwd = resolve(p)
            const first = await spawnCollect(npmCommand(), ['run', 'build'], cwd)
            if (first.code === 0) {
                return { success: true, log: first.log }
            }

            // 兜底：脚手架目录常见问题是未安装依赖（如 esbuild/vite 缺失）。
            // 命中特征后自动 npm install 再重试一次 build，减少用户手工操作。
            if (shouldAutoInstallDeps(first.log)) {
                const install = await spawnCollect(npmCommand(), ['install', '--no-audit', '--no-fund'], cwd)
                const retry = await spawnCollect(npmCommand(), ['run', 'build'], cwd)
                const mergedLog =
                    `${first.log}\n\n[auto-fix] 检测到依赖缺失，已自动执行 npm install 后重试构建\n` +
                    `${install.log}\n\n[auto-fix] 重试构建结果\n${retry.log}`
                if (retry.code === 0) {
                    return { success: true, log: mergedLog }
                }
                return { success: false, log: mergedLog, error: `构建失败（重试后 exit ${retry.code}）` }
            }

            return { success: false, log: first.log, error: `构建失败（exit ${first.code}）` }
        }
    )

    // 打包插件（宿主 spawn npm run pack）
    ipcMain.handle(
        'developer:packPlugin',
        async (_event, args: { path: string }): Promise<PackPluginResult> => {
            const p = args?.path
            if (!p || !existsSync(p)) {
                return { success: false, log: '', error: '目录不存在' }
            }
            const { code, log } = await spawnCollect(npmCommand(), ['run', 'pack'], resolve(p))
            if (code !== 0) {
                return { success: false, log, error: `打包失败（exit ${code}）` }
            }
            const match = log.match(/([^\s'"]+\.inplugin)/)
            return { success: true, log, outFile: match ? match[1] : undefined }
        }
    )

    // 在系统文件管理器中打开插件目录
    ipcMain.handle(
        'developer:openPluginDir',
        async (_event, args: { path: string }): Promise<DeveloperOpResult> => {
            const p = args?.path
            if (!p || !existsSync(p)) {
                return { success: false, error: '目录不存在' }
            }
            const err = await shell.openPath(resolve(p))
            return err ? { success: false, error: err } : { success: true }
        }
    )

    // 更新项目元数据（lastOpenedAt / label）
    ipcMain.handle(
        'developer:updateProjectMeta',
        async (
            _event,
            args: { id: string; lastOpenedAt?: number; label?: string }
        ): Promise<DeveloperOpResult> => {
            const id = args?.id
            if (!id) {
                return { success: false, error: '缺少 id' }
            }
            const settings = appSettingsManager.getSettings()
            let found = false
            const projects = settings.developer.pluginProjects.map((p) => {
                if (p.id !== id) return p
                found = true
                return {
                    ...p,
                    lastOpenedAt: typeof args.lastOpenedAt === 'number' ? args.lastOpenedAt : p.lastOpenedAt,
                    label: typeof args.label === 'string' ? args.label : p.label
                }
            })
            if (!found) {
                return { success: false, error: '项目不存在' }
            }
            appSettingsManager.updateSettings({
                developer: { ...settings.developer, pluginProjects: projects }
            })
            return { success: true }
        }
    )
}

/**
 * Windows 下 npm 可执行名为 npm.cmd。
 */
function npmCommand(): string {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

/**
 * spawn 一个子进程并收集 stdout/stderr 合并日志，返回退出码与日志。
 * 用于 build/pack/create —— 锁定工作目录、提供结构化日志、绕开 runCommand denylist。
 */
function spawnCollect(
    command: string,
    cmdArgs: string[],
    cwd: string
): Promise<{ code: number; log: string }> {
    return new Promise((resolvePromise) => {
        let log = ''
        const child = spawn(command, cmdArgs, {
            cwd,
            env: process.env,
            shell: process.platform === 'win32'
        })
        const append = (chunk: Buffer) => {
            log += chunk.toString()
        }
        child.stdout?.on('data', append)
        child.stderr?.on('data', append)
        child.on('error', (err) => {
            log += `\n[spawn error] ${err.message}`
            resolvePromise({ code: 1, log })
        })
        child.on('close', (code) => {
            resolvePromise({ code: code ?? 1, log })
        })
    })
}

function shouldAutoInstallDeps(log: string): boolean {
    const text = log.toLowerCase()
    return (
        text.includes('command not found') ||
        text.includes('cannot find module') ||
        text.includes('module not found') ||
        text.includes('esbuild: not found') ||
        text.includes('vite: not found')
    )
}
