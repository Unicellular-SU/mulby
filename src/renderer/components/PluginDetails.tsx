import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'


interface PluginDetailsProps {
    pluginName: string
    onBack: () => void
}

interface PluginInfo {
    name: string
    displayName: string
    description: string
    features: any[]
    enabled: boolean
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
            const plugins = await window.intools.plugin.getAll()
            const current = plugins.find(p => p.name === pluginName)
            setPlugin(current || null)

            // 获取 README
            const content = await window.intools.plugin.getReadme(pluginName)
            setReadme(content)
        } catch (err) {
            console.error('Failed to load plugin details:', err)
        } finally {
            setLoading(false)
        }
    }

    const handleUninstall = async () => {
        if (confirm(`确定要卸载插件 ${plugin?.displayName || pluginName} 吗？`)) {
            const result = await window.intools.plugin.uninstall(pluginName)
            if (result.success) {
                window.intools.notification.show('插件已卸载')
                onBack()
            } else {
                window.intools.notification.show(result.error || '卸载失败', 'error')
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

    return (
        <div className="h-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
            {/* 顶部栏 */}
            <div className="flex items-center px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
                <button
                    onClick={onBack}
                    className="mr-4 p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors no-drag"
                    title="返回列表"
                >
                    <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>

                <div className="flex-1">
                    <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        {plugin.displayName}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-normal">
                            已安装
                        </span>
                    </h1>
                    <p className="text-sm text-gray-900 dark:text-gray-100 line-clamp-1">{plugin.description}</p>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={handleUninstall}
                        className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded transition-colors no-drag"
                    >
                        卸载
                    </button>
                </div>
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-auto">
                <div className="max-w-4xl mx-auto p-6">
                    {readme ? (
                        <article className="prose dark:prose-invert max-w-none text-gray-900 dark:text-gray-100">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {readme}
                            </ReactMarkdown>
                        </article>
                    ) : (
                        <div className="text-center py-12 text-gray-400">
                            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor">
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
            </div>
        </div>
    )
}
