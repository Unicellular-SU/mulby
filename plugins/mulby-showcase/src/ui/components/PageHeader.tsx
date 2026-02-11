import React from 'react'

interface PageHeaderProps {
    icon: string
    title: string
    description?: string
    actions?: React.ReactNode
}

export function PageHeader({ icon, title, description, actions }: PageHeaderProps) {
    return (
        <header className="page-header">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2 className="page-title">
                        <span>{icon}</span>
                        <span>{title}</span>
                    </h2>
                    {description && <p className="page-description">{description}</p>}
                </div>
                {actions && <div className="action-bar">{actions}</div>}
            </div>
        </header>
    )
}
