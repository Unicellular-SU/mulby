import React from 'react';
import { Upload, Plus } from 'lucide-react';

interface PDFHeaderProps {
    title: string;
    icon: React.ReactNode;
    actionButton?: {
        label: string;
        icon?: React.ReactNode;
        onClick: () => void;
    };
}

export const PDFHeader: React.FC<PDFHeaderProps> = ({ title, icon, actionButton }) => {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '24px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}>
                {icon} {title}
            </h2>
            {actionButton && (
                <button onClick={actionButton.onClick} style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '8px 16px', borderRadius: '20px', border: 'none',
                    background: 'var(--primary-color)', color: 'white', cursor: 'pointer', fontWeight: '500'
                }}>
                    {actionButton.icon || <Plus size={18} />} {actionButton.label}
                </button>
            )}
        </div>
    );
};

interface PDFUploadAreaProps {
    onClick: () => void;
    title?: string;
    subTitle?: string;
    icon?: React.ReactNode;
    compact?: boolean; // For when there is a list but we still want an upload button? Or just full page.
}

export const PDFUploadArea: React.FC<PDFUploadAreaProps> = ({
    onClick,
    title = "点击选择 PDF 文件",
    subTitle = "或将文件拖放到此处",
    icon
}) => {
    return (
        <div
            onClick={onClick}
            style={{
                flex: 1,
                background: 'rgba(255,255,255,0.5)',
                borderRadius: '24px',
                border: '3px dashed rgba(0, 122, 255, 0.2)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.02)'
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0, 122, 255, 0.03)';
                e.currentTarget.style.borderColor = 'var(--primary-color)';
                e.currentTarget.style.transform = 'scale(0.99)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.5)';
                e.currentTarget.style.borderColor = 'rgba(0, 122, 255, 0.2)';
                e.currentTarget.style.transform = 'none';
            }}
        >
            <div style={{
                width: '96px',
                height: '96px',
                background: 'linear-gradient(135deg, #007AFF 0%, #0056b3 100%)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px',
                boxShadow: '0 12px 24px rgba(0, 122, 255, 0.3)'
            }}>
                {icon || <Upload size={40} color="white" />}
            </div>
            <p style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>{title}</p>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{subTitle}</p>
        </div>
    );
};
