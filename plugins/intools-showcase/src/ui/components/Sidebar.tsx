import React from 'react'

interface SidebarProps {
    activeModule: string
    onModuleChange: (module: string) => void
}

const modules = [
    { id: 'sysinfo', icon: '📊', label: '系统信息' },
    { id: 'clipboard', icon: '📋', label: '剪贴板' },
    { id: 'files', icon: '📁', label: '文件管理' },
    { id: 'network', icon: '🌐', label: '网络与HTTP' },
    { id: 'screen', icon: '🖥️', label: '屏幕与捕获' },
    { id: 'media', icon: '🔊', label: '媒体与音频' },
    { id: 'settings', icon: '⚙️', label: '高级设置' },
    { id: 'security', icon: '🔐', label: '安全与存储' },
]

export function Sidebar({ activeModule, onModuleChange }: SidebarProps) {
    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <h1 className="sidebar-title">
                    <span>🧰</span>
                    <span>InTools</span>
                </h1>
            </div>
            <nav className="sidebar-nav">
                {modules.map((module) => (
                    <div
                        key={module.id}
                        className={`nav-item ${activeModule === module.id ? 'active' : ''}`}
                        onClick={() => onModuleChange(module.id)}
                    >
                        <span className="icon">{module.icon}</span>
                        <span>{module.label}</span>
                    </div>
                ))}
            </nav>
        </aside>
    )
}
