import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { staffAdminApi } from '@/api/admin'
import { isApiError } from '@/api/client'
import { staffKeys } from '@/api/staff'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Panel } from '@/components/ui/display'
import { useToast } from '@/components/ui/Toast'
import { PERMISSION_GROUPS, PERMISSION_LABELS, roleWithArticle } from '@/lib/permissionCatalogue'
import type { Permission, Staff } from '@/types'
import { PermissionPicker } from './PermissionPicker'

/** What this person can do, grouped by area. */
export function PermissionsPanel({ staff, onEdit }: { staff: Staff; onEdit?: () => void }) {
  const groups = PERMISSION_GROUPS.map((g) => ({
    ...g,
    permissions: g.permissions.filter((p) => staff.permissions.includes(p)),
  })).filter((g) => g.permissions.length > 0)
  return (
    <Panel
      title={`Permissions (${staff.permissions.length})`}
      actions={
        onEdit && (
          <Button size="sm" onClick={onEdit}>
            Edit permissions
          </Button>
        )
      }
    >
      {staff.role === 'md' && (
        <p className="text-ink-2 mb-3 text-sm">
          The managing director always has every permission.
        </p>
      )}
      {groups.length === 0 ? (
        <p className="text-ink-2 text-sm">
          No permissions. {staff.firstName} can sign in but can’t do anything.
        </p>
      ) : (
        <dl className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.title}>
              <dt className="text-ink-2 text-xs font-semibold tracking-wide uppercase">
                {g.title}
              </dt>
              <dd>
                <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                  {g.permissions.map((p) => (
                    <li key={p}>{PERMISSION_LABELS[p]}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  )
}

export function PermissionsDialog({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const [value, setValue] = useState<Permission[]>(staff.permissions)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await staffAdminApi.update(staff.id, { permissions: value })
      await queryClient.invalidateQueries({ queryKey: staffKeys.all })
      toast({
        title: 'Permissions saved',
        description: `${staff.firstName} gets them the next time the app loads.`,
      })
      onClose()
    } catch (e) {
      setError(
        isApiError(e)
          ? [...e.formErrors, ...Object.values(e.fieldErrors).flat()].join(' ') || e.message
          : 'Not saved. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      title={`${staff.firstName} ${staff.lastName}’s permissions`}
      description={`Choose from what ${roleWithArticle(staff.role)} can have. Every change is recorded in the audit log.`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            Save permissions
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <PermissionPicker role={staff.role} value={value} onChange={setValue} />
    </Dialog>
  )
}
