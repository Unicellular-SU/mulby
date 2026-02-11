import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PluginInfo } from '../../shared/types/electron'

interface PluginDetailsProps {
    pluginName: string
    onBack: () => void
}

type FeatureCmd = PluginInfo['features'][number]['cmds'][number] | string

interface CommandTag {
    kind: string
    label: string
    detail?: string
}

function formatCommand(cmd: FeatureCmd): CommandTag {
    if (typeof cmd === 'string') {
        return { kind: '关键词', label: cmd }
    }
    switch (cmd.type) {
        case 'keyword':
            return { kind: '关键词', label: cmd.value || '未命名' }
        case 'regex':
            return { kind: '正则', label: cmd.match || '未指定', detail: cmd.explain }
        case 'files':
            return { kind: '文件', label: cmd.exts && cmd.exts.length > 0 ? cmd.exts.map(ext => `.${ext}`).join(', ') : '任意格式' }
        case 'img':
            return { kind: '图片', label: cmd.exts && cmd.exts.length > 0 ? cmd.exts.map(ext => `.${ext}`).join(', ') : '任意格式' }
        case 'over':
            return { kind: '覆盖', label: '无需输入' }
        default:
            return { kind: cmd.type || '命令', label: cmd.value || cmd.match || '未命名' }
    }
}

function InfoItem({ label, value, mono = false }: { label: string; value?: string | number | ReactNode; mono?: boolean }) {
    const displayValue = value === undefined || value === null || value === '' ? '—' : value
    return (
        <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{label}</p>
            {typeof value === 'string' || typeof value === 'number' ? (
                <p className={`${mono ? 'font-mono text-sm' : 'text-sm'} text-slate-900 dark:text-slate-100 break-words`}>
                    {displayValue}
                </p>
            ) : (
                <div className={`${mono ? 'font-mono text-sm' : 'text-sm'} text-slate-900 dark:text-slate-100`}>
                    {displayValue}
                </div>
            )}
        </div>
    )
}

function PluginIcon({ icon, name }: { icon?: PluginInfo['icon']; name: string }) {
    if (!icon) {
        return (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200">
                <span className="text-xl font-semibold">{name.slice(0, 1).toUpperCase()}</span>
            </div>
        )
    }

    if (icon.type === 'svg') {
        return (
            <div
                className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-100 [&>svg]:h-10 [&>svg]:w-10"
                dangerouslySetInnerHTML={{ __html: icon.value }}
            />
        )
    }

    return (
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
            <img src={icon.value} alt={`${name} icon`} className="h-12 w-12 rounded-xl object-cover" />
        </div>
    )
}

export default function PluginDetails({ pluginName, onBack }: PluginDetailsProps) {
    const [readme, setReadme] = useState<string | null>(null)
    const [plugin, setPlugin] = useState<PluginInfo | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadData()
    }, [pluginName])

    const loadData = async () => {
        setLoading(true)
        try {
            // 获取插件基本信息
            const plugins = await window.mulby.plugin.getAll()
            const current = plugins.find(p => p.name === pluginName)
            setPlugin(current || null)

            // 获取 README
            const content = await window.mulby.plugin.getReadme(pluginName)
            setReadme(content)
        } catch (err) {
            console.error('Failed to load plugin details:', err)
        } finally {
            setLoading(false)
        }
    }

    const handleUninstall = async () => {
        if (confirm(`确定要卸载插件 ${plugin?.displayName || pluginName} 吗？`)) {
            const result = await window.mulby.plugin.uninstall(pluginName)
            if (result.success) {
                window.mulby.notification.show('插件已卸载')
                onBack()
            } else {
                window.mulby.notification.show(result.error || '卸载失败', 'error')
            }
        }
    }

    if (loading) {
        return <div className="p-8 text-center text-gray-500">加载中...</div>
    }

    if (!plugin) {
        return (
            <div className="p-8 text-center">
                <p className="mb-4 text-red-500">插件未找到</p>
                <button onClick={onBack} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600">
                    返回
                </button>
            </div>
        )
    }

    const commandCount = plugin.features.reduce((sum, feature) => sum + (feature.cmds?.length || 0), 0)
    const hasReadme = Boolean(readme && readme.trim().length > 0)

    return (
        <div className="relative h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-blue-200/40 blur-[120px] dark:bg-blue-500/20" />
                <div className="absolute right-12 top-32 h-64 w-64 rounded-full bg-emerald-200/40 blur-[120px] dark:bg-emerald-400/10" />
                <div className="absolute bottom-0 left-12 h-64 w-64 rounded-full bg-purple-200/30 blur-[120px] dark:bg-indigo-500/10" />
            </div>

            <div className="relative flex h-full min-h-0 flex-col">
                <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white/70 px-6 py-4  dark:border-slate-800/80 dark:bg-slate-900/60">
                    <button
                        onClick={onBack}
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white no-drag"
                        title="返回列表"
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                    <div className="flex-1">
                        <p className="text-xs uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Plugin Details</p>
                        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{plugin.displayName}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                            {plugin.enabled ? '已启用' : '未启用'}
                        </span>
                        {plugin.builtin && (
                            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                                内置
                            </span>
                        )}
                        {plugin.isDev && (
                            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                                开发
                            </span>
                        )}
                        <button
                            onClick={handleUninstall}
                            disabled={plugin.builtin}
                            className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-full border border-transparent transition-colors no-drag"
                        >
                            卸载
                        </button>
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-auto">
                    <div className="mx-auto max-w-6xl px-6 pb-16 pt-8 no-drag">
                        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                            <div className="rounded-[28px] border border-slate-200/80 bg-white/80 p-6 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.4)]  dark:border-slate-800/80 dark:bg-slate-900/70">
                                <div className="flex flex-wrap items-start gap-4">
                                    <PluginIcon icon={plugin.icon} name={plugin.displayName} />
                                    <div className="flex-1 space-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">{plugin.displayName}</h2>
                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                                v{plugin.version || '0.0.0'}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-600 dark:text-slate-300">
                                            {plugin.description || '暂无简介'}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                            <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
                                                {plugin.features.length} 个功能
                                            </span>
                                            <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
                                                {commandCount} 条命令
                                            </span>
                                            {plugin.homepage && (
                                                <a
                                                    href={plugin.homepage}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:text-white"
                                                >
                                                    官方主页
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                                    <InfoItem label="插件名称" value={plugin.name} mono />
                                    <InfoItem label="唯一标识" value={plugin.id} mono />
                                    <InfoItem label="作者" value={plugin.author || '未知'} />
                                    <InfoItem
                                        label="主页"
                                        value={plugin.homepage ? (
                                            <a
                                                className="text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                                                href={plugin.homepage}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                {plugin.homepage}
                                            </a>
                                        ) : '—'}
                                    />
                                    <InfoItem label="入口文件" value={plugin.main || '—'} mono />
                                    <InfoItem label="UI 资源" value={plugin.ui || '—'} mono />
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-5  dark:border-slate-800/80 dark:bg-slate-900/70">
                                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">运行信息</h3>
                                    <div className="mt-4 grid gap-4">
                                        <InfoItem label="状态" value={plugin.enabled ? '启用中' : '已禁用'} />
                                        <InfoItem label="来源" value={plugin.builtin ? '内置插件' : '用户插件'} />
                                        <InfoItem label="安装路径" value={plugin.path || '—'} mono />
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="mt-10 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">功能与命令</h3>
                                <span className="text-xs text-slate-500 dark:text-slate-400">来自 PluginManifest</span>
                            </div>
                            <div className="grid gap-4">
                                {plugin.features.map((feature) => (
                                    <div key={feature.code} className="rounded-2xl border border-slate-200/80 bg-white/80 p-5  dark:border-slate-800/80 dark:bg-slate-900/70">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    {feature.icon && (
                                                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800">
                                                            {feature.icon.type === 'svg' ? (
                                                                <div
                                                                    className="h-4 w-4 [&>svg]:h-4 [&>svg]:w-4"
                                                                    dangerouslySetInnerHTML={{ __html: feature.icon.value }}
                                                                />
                                                            ) : (
                                                                <img src={feature.icon.value} alt="" className="h-4 w-4 object-contain" />
                                                            )}
                                                        </div>
                                                    )}
                                                    <h4 className="text-base font-semibold text-slate-900 dark:text-white">{feature.explain}</h4>
                                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                                        {feature.code}
                                                    </span>
                                                </div>
                                                {feature.route && (
                                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">路由：{feature.route}</p>
                                                )}
                                            </div>
                                            {feature.mode && (
                                                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                                                    {feature.mode}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-4 flex flex-wrap gap-3">
                                            {feature.cmds.length > 0 ? (
                                                feature.cmds.map((cmd, index) => {
                                                    const tag = formatCommand(cmd as FeatureCmd)
                                                    const explain = typeof cmd !== 'string' ? cmd.explain : undefined
                                                    return (
                                                        <div
                                                            key={`${feature.code}-${index}`}
                                                            className="min-w-[140px] rounded-2xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs text-slate-700 shadow-sm dark:border-slate-800/80 dark:bg-slate-950/60 dark:text-slate-200"
                                                            title={tag.detail ? `${tag.kind}：${tag.detail}` : tag.kind}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-500">
                                                                    {tag.kind}
                                                                </span>
                                                                <span className="font-medium text-slate-800 dark:text-slate-100">{tag.label}</span>
                                                            </div>
                                                            {explain && (
                                                                <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                                                    {explain}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })
                                            ) : (
                                                <span className="rounded-full border border-dashed border-slate-200 px-3 py-1 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                                    暂无命令
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {plugin.features.length === 0 && (
                                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                                        暂无可用功能入口
                                    </div>
                                )}
                            </div>
                        </section>

                        <section className="mt-12">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">README 文档</h3>
                                <span className="text-xs text-slate-500 dark:text-slate-400">{hasReadme ? 'Markdown' : '无文档'}</span>
                            </div>
                            <div className="mt-4 rounded-[28px] border border-slate-200/80 bg-white/80 p-6 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.4)]  dark:border-slate-800/80 dark:bg-slate-900/70">
                                {hasReadme ? (
                                    <article className="prose prose-slate max-w-none dark:prose-invert">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {readme || ''}
                                        </ReactMarkdown>
                                    </article>
                                ) : (
                                    <div className="text-center py-12 text-slate-400">
                                        <svg className="mx-auto mb-3 h-12 w-12 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeWidth="2" />
                                            <path d="M14 2v6h6" strokeWidth="2" />
                                            <path d="M16 13H8" strokeWidth="2" strokeLinecap="round" />
                                            <path d="M16 17H8" strokeWidth="2" strokeLinecap="round" />
                                            <path d="M10 9H8" strokeWidth="2" strokeLinecap="round" />
                                        </svg>
                                        <p>暂无文档说明</p>
                                    </div>
                                )}
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    )
}
