import React from 'react'

interface CardProps {
    title?: string
    icon?: string
    children: React.ReactNode
    actions?: React.ReactNode
    className?: string
}

export function Card({ title, icon, children, actions, className = '' }: CardProps) {
    return (
        <div className={`card ${className}`}>
            {(title || actions) && (
                <div className="card-header">
                    {title && (
                        <h3 className="card-title">
                            {icon && <span>{icon}</span>}
                            <span>{title}</span>
                        </h3>
                    )}
                    {actions && <div className="action-bar">{actions}</div>}
                </div>
            )}
            <div className="card-content">{children}</div>
        </div>
    )
}
