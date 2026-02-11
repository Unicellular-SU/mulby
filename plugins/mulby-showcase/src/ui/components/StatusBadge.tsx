import React from 'react'

interface StatusBadgeProps {
    status: 'success' | 'warning' | 'error' | 'info'
    children: React.ReactNode
}

export function StatusBadge({ status, children }: StatusBadgeProps) {
    const icons = {
        success: '✓',
        warning: '⚠',
        error: '✕',
        info: 'ℹ',
    }

    return (
        <span className={`badge badge-${status}`}>
            <span>{icons[status]}</span>
            <span>{children}</span>
        </span>
    )
}
