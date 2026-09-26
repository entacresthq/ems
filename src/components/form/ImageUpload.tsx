import { useId, useState } from 'react'
import { Camera, ImageUp } from 'lucide-react'
import { resizeImage } from '@/lib/image'
import { cn } from '@/lib/cn'

/**
 * Pick or take a photo, shrink it on the device and hand back a Blob.
 * `capture` opens the camera directly on phones.
 */
export function ImageUpload({
  label,
  hint,
  currentUrl,
  value,
  onChange,
  capture,
  shape = 'portrait',
  error,
}: {
  label: string
  hint?: string
  currentUrl?: string | null
  value: Blob | null
  onChange: (blob: Blob | null) => void
  capture?: boolean
  shape?: 'portrait' | 'wide'
  error?: string
}) {
  const id = useId()
  const [preview, setPreview] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shown = value ? preview : currentUrl

  async function choose(file: File | undefined) {
    if (!file) return
    setProblem(null)
    setBusy(true)
    try {
      const blob = await resizeImage(file, shape === 'wide' ? 900 : 700)
      if (preview) URL.revokeObjectURL(preview)
      setPreview(URL.createObjectURL(blob))
      onChange(blob)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That image could not be read. Try another.')
    } finally {
      setBusy(false)
    }
  }

  const message = problem ?? error
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-ink text-sm font-medium" id={`${id}-label`}>
        {label}
      </span>
      <div className="flex items-center gap-4">
        <div
          className={cn(
            'border-rule-strong bg-paper flex shrink-0 items-center justify-center overflow-hidden rounded border border-dashed',
            shape === 'portrait' ? 'h-28 w-24' : 'h-20 w-48',
          )}
        >
          {shown ? (
            <img src={shown} alt={`${label} preview`} className="h-full w-full object-contain" />
          ) : (
            <ImageUp className="text-ink-3 size-6" aria-hidden />
          )}
        </div>
        <div className="flex flex-col items-start gap-2">
          <label
            htmlFor={id}
            className="border-rule-strong bg-surface hover:bg-ink-tint focus-within:outline-ink inline-flex h-10 cursor-pointer items-center gap-2 rounded border px-4 text-sm font-medium focus-within:outline-2 focus-within:outline-offset-2"
          >
            <Camera className="size-4" aria-hidden />
            {busy ? 'Preparing…' : shown ? 'Replace' : capture ? 'Take photo' : 'Choose image'}
            <input
              id={id}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture={capture ? 'environment' : undefined}
              className="sr-only"
              aria-labelledby={`${id}-label`}
              onChange={(e) => {
                void choose(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          {value && (
            <button
              type="button"
              className="text-ink-2 text-sm underline"
              onClick={() => onChange(null)}
            >
              Remove new image
            </button>
          )}
        </div>
      </div>
      {hint && !message && <p className="text-ink-3 text-sm">{hint}</p>}
      {message && <p className="text-brick text-sm font-medium">{message}</p>}
    </div>
  )
}
