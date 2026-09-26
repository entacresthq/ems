import { useState, type ReactNode } from 'react'
import { isApiError } from '@/api/client'
import { TextArea } from '@/components/form/inputs'
import { Alert } from './Alert'
import { Button } from './Button'
import { Dialog } from './Dialog'

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  title: string
  children?: ReactNode
  /** Exactly what will happen, e.g. "Reverse transaction". */
  confirmLabel: string
  tone?: 'primary' | 'danger'
  /** Ask for a written reason (reversals, closures, rejections). */
  reason?: { label: string; hint?: string; minLength?: number }
  onConfirm: (reason: string) => Promise<unknown> | void
}

/**
 * Confirmation for destructive or sensitive actions. Stays open and shows the
 * error if the action fails, so nothing is lost.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  // Remounting on open resets the reason, error and busy state.
  return <ConfirmDialogContent key={props.open ? 'open' : 'closed'} {...props} />
}

function ConfirmDialogContent({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  tone = 'primary',
  reason,
  onConfirm,
}: ConfirmDialogProps) {
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const minLength = reason?.minLength ?? 10
  const reasonError =
    reason && touched && text.trim().length < minLength
      ? `Write at least ${minLength} characters so the approver understands why.`
      : undefined

  async function confirm() {
    setTouched(true)
    if (reason && text.trim().length < minLength) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(text.trim())
      onClose()
    } catch (e) {
      setError(isApiError(e) ? e.message : 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      dismissible={!busy}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={confirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-ink-2 flex flex-col gap-4 text-sm">
        {children}
        {reason && (
          <TextArea
            label={reason.label}
            hint={reason.hint}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setTouched(true)}
            error={reasonError}
          />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  )
}
