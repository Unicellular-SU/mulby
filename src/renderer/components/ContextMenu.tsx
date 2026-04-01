import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  id: string
  label: string
  /** 分隔线：设为 true 时忽略 id 和 label */
  separator?: boolean
  /** 危险操作（红色文字） */
  danger?: boolean
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  position: { x: number; y: number }
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * 自定义右键菜单组件
 * 使用项目设计系统变量，支持亮/暗主题、毛玻璃效果
 */
const ContextMenu = memo(function ContextMenu({
  items,
  position,
  onSelect,
  onClose
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [adjustedPos, setAdjustedPos] = useState(position)

  // 挂载后检测是否超出视口边界，自动调整位置
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    let { x, y } = position

    if (x + rect.width > window.innerWidth - pad) {
      x = window.innerWidth - rect.width - pad
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = window.innerHeight - rect.height - pad
    }
    if (x < pad) x = pad
    if (y < pad) y = pad

    setAdjustedPos({ x, y })
  }, [position])

  // 点击外部或 Esc 关闭
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    // 延迟绑定，避免触发右键的 mousedown 立刻关闭菜单
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick, true)
    }, 0)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick, true)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className="ctx-menu"
      style={{ left: adjustedPos.x, top: adjustedPos.y }}
      role="menu"
    >
      {items.map((item, index) =>
        item.separator ? (
          <div key={`sep-${index}`} className="ctx-menu-separator" role="separator" />
        ) : (
          <div
            key={item.id}
            className={`ctx-menu-item ${item.danger ? 'danger' : ''}`}
            role="menuitem"
            onClick={() => {
              onSelect(item.id)
              onClose()
            }}
          >
            {item.label}
          </div>
        )
      )}
    </div>,
    document.body
  )
})

/** 右键菜单状态 hook */
export function useContextMenu() {
  const [state, setState] = useState<{
    items: ContextMenuItem[]
    position: { x: number; y: number }
    resolve: (id: string | null) => void
  } | null>(null)

  const show = useCallback(
    (items: ContextMenuItem[], e: { clientX: number; clientY: number }): Promise<string | null> => {
      return new Promise((resolve) => {
        setState({
          items,
          position: { x: e.clientX, y: e.clientY },
          resolve
        })
      })
    },
    []
  )

  const handleSelect = useCallback(
    (id: string) => {
      state?.resolve(id)
      setState(null)
    },
    [state]
  )

  const handleClose = useCallback(() => {
    state?.resolve(null)
    setState(null)
  }, [state])

  const menu = state ? (
    <ContextMenu
      items={state.items}
      position={state.position}
      onSelect={handleSelect}
      onClose={handleClose}
    />
  ) : null

  return { show, menu }
}

export default ContextMenu
