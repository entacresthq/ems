import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** Hide the close button and ignore Esc (e.g. while saving). */
  dismissible?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }

/**
 * Modal built on the native <dialog>, which gives focus trapping, Esc and
 * inert background for free. Clicking the backdrop does not close it, so a
 * stray tap cannot dismiss a half-finished action.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  size = 'md',
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(e) => {
        e.preventDefault()
        if (dismissible) onClose()
      }}
      className={cn(
        'bg-surface text-ink shadow-overlay m-auto w-[calc(100%-2rem)] rounded p-0',
        SIZES[size],
      )}
    >
      {open && (
        <div className="flex max-h-[85dvh] flex-col">
          <header className="border-rule flex items-start justify-between gap-4 border-b px-5 pt-4 pb-3">
            <div>
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="text-ink-2 mt-1 text-sm">
                  {description}
                </p>
              )}
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                className="text-ink-2 hover:bg-ink-tint -mr-2 rounded p-2"
                aria-label="Close"
              >
                <X className="size-5" aria-hidden />
              </button>
            )}
          </header>
          {children && <div className="overflow-y-auto px-5 py-4">{children}</div>}
          {footer && (
            <footer className="border-rule flex flex-col-reverse gap-2 border-t px-5 py-3 sm:flex-row sm:justify-end">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  )
}
