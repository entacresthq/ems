import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { isApiError } from '@/api/client'
import { systemApi, systemKeys, type SystemStatus } from '@/api/system'
import { TextArea } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/dates'
import { SetupLayout } from './SetupLayout'

/** Asks for the licence code bought from Entacrest. Also shown when a licence ends. */
export function LicenceScreen({ status }: { status: SystemStatus }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const queryClient = useQueryClient()
  const current = status.licence

  const activate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) {
      setError('Paste your licence code.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      queryClient.setQueryData(systemKeys.status, await systemApi.activate(code))
    } catch (err) {
      setError(
        isApiError(err)
          ? (err.fieldErrors.code?.join(' ') ?? err.message)
          : 'EMS couldn’t check the code. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const copyMachineCode = async () => {
    try {
      await navigator.clipboard.writeText(status.machineCode)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <SetupLayout
      step={0}
      title={current?.status === 'expired' ? 'Renew your EMS licence' : 'Activate EMS'}
      description="Enter the licence code you received from Entacrest when you bought EMS."
      aside={
        <div className="flex flex-col gap-4 text-sm">
          <div>
            <h2 className="font-semibold">This computer’s code</h2>
            <p className="text-ink-2 mt-1">
              Entacrest may ask for it to tie your licence to this computer.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="bg-surface border-rule rounded border px-3 py-1.5 font-mono text-base tracking-wide">
                {status.machineCode}
              </code>
              <Button
                size="sm"
                variant="ghost"
                icon={<Copy className="size-4" aria-hidden />}
                onClick={() => void copyMachineCode()}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          <div>
            <h2 className="font-semibold">Need a licence?</h2>
            <p className="text-ink-2 mt-1">
              Contact Entacrest. Licences are priced by the number of branches and renew yearly.
            </p>
          </div>
        </div>
      }
    >
      {current?.status === 'expired' && (
        <Alert tone="warning" className="mb-4">
          Licence {current.id} for {current.licensee} ended on{' '}
          {current.expires ? formatDate(current.expires) : 'its end date'}. Enter a renewal code to
          carry on. Your data is safe on this computer.
        </Alert>
      )}
      {current?.status === 'wrong_machine' && (
        <Alert tone="warning" className="mb-4">
          The licence saved here is for a different computer. Enter a licence for this one.
        </Alert>
      )}
      <form onSubmit={activate} noValidate className="flex flex-col gap-4">
        <TextArea
          label="Licence code"
          rows={5}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={error ?? undefined}
          hint="It starts with EMS-. Paste all of it, including any line breaks."
          className="font-mono text-sm break-all"
          spellCheck={false}
          autoFocus
        />
        <div>
          <Button type="submit" variant="primary" size="lg" loading={busy}>
            Activate
          </Button>
        </div>
      </form>
    </SetupLayout>
  )
}
