

interface SidebarProps {
    activeModule: string
    onModuleChange: (module: string) => void
}

const modules = [
    { id: 'sysinfo', icon: '📊', label: '系统信息' },
    { id: 'clipboard', icon: '📋', label: '剪贴板' },
    { id: 'input', icon: '⌨️', label: '输入控制' },
    { id: 'filemanager', icon: '📁', label: '文件管理' },
    { id: 'network', icon: '🌐', label: '网络' },
    { id: 'screen', icon: '🖥️', label: '屏幕' },
    { id: 'media', icon: '🎵', label: '媒体' },
    { id: 'window-api', label: '窗口 API', icon: '🪟' },
    { id: 'child-window', label: 'Child Window', icon: '🖼️' },
    { id: 'inbrowser', label: 'InBrowser', icon: '🤖' },
    { id: 'sharp', label: 'Sharp 图像', icon: '🖼️' },
    { id: 'ffmpeg', label: 'FFmpeg 音视频', icon: '🎬' },
    { id: 'settings', icon: '⚙️', label: '设置' },
    { id: 'security', icon: '🔐', label: '安全' },
]

export function Sidebar({ activeModule, onModuleChange }: SidebarProps) {
    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <h1 className="sidebar-title">
                    <span>🧰</span>
                    <span>Mulby</span>
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
