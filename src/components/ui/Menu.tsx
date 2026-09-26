import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'

export type MenuItem =
  | { type: 'link'; label: string; to: string; icon?: ReactNode }
  | { type: 'button'; label: string; onSelect: () => void; icon?: ReactNode; tone?: 'danger' }
  | { type: 'separator' }

/** Small dropdown menu: arrow keys move, Esc closes and returns focus. */
export function Menu({
  trigger,
  triggerLabel,
  items,
  align = 'right',
}: {
  trigger: ReactNode
  triggerLabel: string
  items: MenuItem[]
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const focusables = () =>
      Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    focusables()[0]?.focus()
    const onPointer = (e: PointerEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      )
        setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      const items = focusables()
      const index = items.indexOf(document.activeElement as HTMLElement)
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        items[(index + 1) % items.length]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        items[(index - 1 + items.length) % items.length]?.focus()
      } else if (e.key === 'Tab') {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const itemClass =
    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-ink-tint focus:bg-ink-tint focus:outline-none'

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-ink-tint flex items-center gap-2 rounded px-2 py-1.5"
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          className={cn(
            'border-rule bg-surface shadow-overlay absolute z-30 mt-1 min-w-56 rounded border py-1',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) => {
            if (item.type === 'separator')
              return <div key={i} role="separator" className="border-rule my-1 border-t" />
            if (item.type === 'link') {
              return (
                <Link
                  key={i}
                  role="menuitem"
                  to={item.to}
                  className={itemClass}
                  onClick={() => setOpen(false)}
                >
                  {item.icon}
                  {item.label}
                </Link>
              )
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={cn(itemClass, item.tone === 'danger' && 'text-brick')}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                {item.icon}
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
