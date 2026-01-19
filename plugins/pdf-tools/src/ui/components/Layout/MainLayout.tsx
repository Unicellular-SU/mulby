import React from 'react';
import Sidebar from './Sidebar.tsx';

interface MainLayoutProps {
    children: React.ReactNode;
    activePath: string;
    onNavigate: (path: string) => void;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children, activePath, onNavigate }) => {
    return (
        <div style={{
            display: 'flex',
            height: '100vh',
            width: '100vw',
            background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)', // Subtle gradient
            padding: '16px',
            gap: '16px'
        }}>
            <Sidebar activePath={activePath} onNavigate={onNavigate} />
            <main className="glass-panel" style={{
                flex: 1,
                borderRadius: 'var(--radius-lg)',
                padding: '24px',
                overflowY: 'auto',
                position: 'relative'
            }}>
                {children}
            </main>
        </div>
    );
};

export default MainLayout;
