import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

type ToastTone = 'success' | 'danger' | 'info'

interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
}

interface ToastItem extends ToastInput {
  id: number
}

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null)

const ICONS = { success: CircleCheck, danger: CircleAlert, info: Info }
const RULE = { success: 'border-ledger', danger: 'border-brick', info: 'border-ink' }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback(
    (id: number) => setToasts((all) => all.filter((t) => t.id !== id)),
    [],
  )

  const show = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++
      setToasts((all) => [...all.slice(-2), { ...toast, id }])
      window.setTimeout(() => dismiss(id), toast.tone === 'danger' ? 8000 : 5000)
    },
    [dismiss],
  )

  const value = useMemo(() => show, [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 top-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4"
      >
        {toasts.map((t) => {
          const tone = t.tone ?? 'success'
          const Icon = ICONS[tone]
          return (
            <div
              key={t.id}
              role={tone === 'danger' ? 'alert' : 'status'}
              className={cn(
                'bg-surface shadow-overlay pointer-events-auto flex w-full max-w-sm gap-3 border-l-4 px-4 py-3',
                RULE[tone],
              )}
            >
              <Icon
                className={cn(
                  'mt-0.5 size-5 shrink-0',
                  tone === 'success'
                    ? 'text-ledger'
                    : tone === 'danger'
                      ? 'text-brick'
                      : 'text-ink',
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-ink font-semibold">{t.title}</p>
                {t.description && <p className="text-ink-2 mt-0.5">{t.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="text-ink-2 hover:bg-ink-tint -m-1 self-start rounded p-1"
                aria-label="Dismiss"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
