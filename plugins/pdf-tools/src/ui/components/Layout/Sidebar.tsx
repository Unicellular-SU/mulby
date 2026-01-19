import React from 'react';
import {
    Combine,
    Scissors,
    Droplet,
    Image as ImageIcon,
    FileImage,
    FileText,
    Presentation,
    Sheet
} from 'lucide-react';

interface SidebarProps {
    activePath: string;
    onNavigate: (path: string) => void;
}

const NAV_ITEMS = [
    { id: 'merge', icon: Combine, label: 'PDF 合并' },
    { id: 'split', icon: Scissors, label: 'PDF 拆分' },
    { id: 'watermark', icon: Droplet, label: 'PDF 水印' },
    { id: 'extract-img', icon: ImageIcon, label: '提取图片' },
    { id: 'pdf-to-img', icon: FileImage, label: 'PDF 转图片' },
    { id: 'pdf-to-word', icon: FileText, label: 'PDF 转 Word' },
    { id: 'pdf-to-ppt', icon: Presentation, label: 'PDF 转 PPT' },
    { id: 'pdf-to-excel', icon: Sheet, label: 'PDF 转 Excel' },
];

const Sidebar: React.FC<SidebarProps> = ({ activePath, onNavigate }) => {
    return (
        <aside className="glass-panel" style={{
            width: 'var(--sidebar-width)',
            height: '100%',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            padding: '20px'
        }}>
            <div style={{ padding: '0 12px 24px', fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)' }}>
                PDF 工具箱
            </div>

            <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
                {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.id}
                            onClick={() => onNavigate(item.id)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '12px 16px',
                                border: 'none',
                                background: activePath === item.id ? 'rgba(255,255,255,0.5)' : 'transparent',
                                borderRadius: 'var(--radius-md)',
                                color: activePath === item.id ? 'var(--primary-color)' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: activePath === item.id ? '600' : '400',
                                transition: 'all 0.2s ease',
                                textAlign: 'left',
                                backdropFilter: activePath === item.id ? 'blur(10px)' : 'none',
                                boxShadow: activePath === item.id ? '0 2px 10px rgba(0,0,0,0.05)' : 'none'
                            }}
                        >
                            <Icon size={20} strokeWidth={2} />
                            {item.label}
                        </button>
                    );
                })}
            </nav>
        </aside>
    );
};

export default Sidebar;
