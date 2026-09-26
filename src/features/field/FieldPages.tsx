import { useState } from 'react'
import { KeyRound, Lock, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { useAuth, useCurrentUser } from '@/features/auth/AuthProvider'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { formatPhone } from '@/lib/phone'
import { useFieldData } from './FieldData'
import { useFieldLock } from './FieldLock'
import { MyPerformance } from './MyPerformance'
import { PinSetupScreen } from './PinScreens'

export function FieldMePage() {
  const user = useCurrentUser()
  const { logout } = useAuth()
  const { lock } = useFieldLock()
  const { unsyncedCount } = useFieldData()
  const toast = useToast()
  const [changingPin, setChangingPin] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  useDocumentTitle('Me')

  if (changingPin) {
    return (
      <div className="fixed inset-0 z-30 overflow-y-auto bg-white">
        <PinSetupScreen
          requireCurrent
          onCancel={() => setChangingPin(false)}
          onDone={() => {
            setChangingPin(false)
            toast({
              title: 'PIN changed',
              description: 'Use your new PIN next time the app locks.',
            })
          }}
        />
      </div>
    )
  }

  return (
    <>
      <h1 className="text-xl font-semibold">
        {user.firstName} {user.lastName}
      </h1>
      <dl className="divide-rule border-rule mt-4 divide-y border-y">
        {[
          ['Staff ID', user.staffId],
          ['Branch', user.branchName ?? '—'],
          ['Phone', formatPhone(user.phone)],
          ['Email', user.email],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-3">
            <dt className="text-ink-2">{label}</dt>
            <dd className="text-right font-medium break-all">{value}</dd>
          </div>
        ))}
      </dl>

      <MyPerformance />

      <div className="mt-8 flex flex-col gap-3">
        <Button size="xl" icon={<Lock className="size-5" aria-hidden />} onClick={lock}>
          Lock app now
        </Button>
        <Button
          size="xl"
          icon={<KeyRound className="size-5" aria-hidden />}
          onClick={() => setChangingPin(true)}
        >
          Change PIN
        </Button>
        <Button
          size="xl"
          variant="ghost"
          icon={<LogOut className="size-5" aria-hidden />}
          onClick={() => (unsyncedCount > 0 ? setConfirmSignOut(true) : void logout())}
        >
          Sign out
        </Button>
      </div>

      <ConfirmDialog
        open={confirmSignOut}
        onClose={() => setConfirmSignOut(false)}
        title="Sign out with collections not synced?"
        confirmLabel="Sign out anyway"
        tone="danger"
        onConfirm={() => logout()}
      >
        <p>
          {unsyncedCount} {unsyncedCount === 1 ? 'collection has' : 'collections have'} not reached
          the office. They stay on this phone and upload the next time you sign in here. Don't sign
          in on a different phone until they have synced.
        </p>
      </ConfirmDialog>
    </>
  )
}
