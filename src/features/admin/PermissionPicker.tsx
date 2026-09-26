import { useQuery } from '@tanstack/react-query'
import { adminKeys, settingsApi } from '@/api/admin'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { cn } from '@/lib/cn'
import { PERMISSION_GROUPS, PERMISSION_LABELS, roleWithArticle } from '@/lib/permissionCatalogue'
import { grantablePermissions, REQUIRED_PERMISSIONS } from '@/lib/permissions'
import { ROLE_LABELS, type Permission, type Role } from '@/types'

/** What a role allows, and which of those the signed-in user may hand out. */
export function useRolePermissions(role: Role) {
  const me = useCurrentUser()
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: settingsApi.get })
  const available = settings.data?.rolePermissions[role] ?? []
  return {
    isPending: settings.isPending,
    available,
    grantable: grantablePermissions(me.permissions, available),
    required: REQUIRED_PERMISSIONS[role] ?? [],
  }
}

/**
 * Checklist of the permissions a role allows, grouped by area. Permissions the
 * signed-in user doesn't hold are shown but can't be changed.
 */
export function PermissionPicker({
  role,
  value,
  onChange,
  error,
}: {
  role: Role
  value: Permission[]
  onChange: (next: Permission[]) => void
  error?: string
}) {
  const { isPending, available, grantable, required } = useRolePermissions(role)
  const editable = (p: Permission) => grantable.includes(p) && !required.includes(p)
  const chosen = value.filter((p) => available.includes(p))
  const setMany = (ps: Permission[], on: boolean) => {
    const change = new Set(ps.filter(editable))
    onChange(
      on
        ? [...new Set([...value, ...change])]
        : value.filter((p) => !change.has(p) || required.includes(p)),
    )
  }

  if (isPending) return <p className="text-ink-2 text-sm">Loading permissions…</p>
  if (available.length === 0)
    return (
      <p className="text-ink-2 text-sm">
        The {ROLE_LABELS[role].toLowerCase()} role has no permissions yet. The MD can add them in
        Settings.
      </p>
    )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm" aria-live="polite">
          <span className="font-semibold tabular-nums">
            {chosen.length} of {available.length}
          </span>{' '}
          permissions {roleWithArticle(role)} can have
        </p>
        <span className="flex gap-3 text-sm">
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => setMany(available, true)}
          >
            Select all
          </button>
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => setMany(available, false)}
          >
            Clear
          </button>
        </span>
      </div>
      {error && (
        <p role="alert" className="text-brick mb-3 text-sm font-medium">
          {error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {PERMISSION_GROUPS.map((group) => {
          const ps = group.permissions.filter((p) => available.includes(p))
          if (ps.length === 0) return null
          const on = ps.filter((p) => value.includes(p)).length
          const allOn = ps.filter(editable).every((p) => value.includes(p))
          return (
            <fieldset key={group.title} className="border-rule rounded border px-3 pt-1 pb-2">
              <legend className="flex w-full items-center justify-between gap-2 px-1 text-sm font-semibold">
                <span>
                  {group.title}{' '}
                  <span className="text-ink-2 font-normal tabular-nums">
                    {on}/{ps.length}
                  </span>
                </span>
              </legend>
              {ps.filter(editable).length > 1 && (
                <button
                  type="button"
                  onClick={() => setMany(ps, !allOn)}
                  className="text-ink-2 mb-1 text-xs font-medium underline underline-offset-2"
                >
                  {allOn
                    ? `None in ${group.title.toLowerCase()}`
                    : `All in ${group.title.toLowerCase()}`}
                </button>
              )}
              <ul className="flex flex-col gap-1">
                {ps.map((p) => {
                  const locked = required.includes(p)
                  const notMine = !grantable.includes(p)
                  return (
                    <li key={p}>
                      <label
                        className={cn(
                          'flex items-start gap-2 py-0.5 text-sm',
                          editable(p) ? 'cursor-pointer' : 'text-ink-2',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="accent-ledger mt-0.5 size-4 shrink-0"
                          checked={locked || value.includes(p)}
                          disabled={!editable(p)}
                          onChange={(e) =>
                            onChange(
                              e.target.checked ? [...value, p] : value.filter((x) => x !== p),
                            )
                          }
                        />
                        <span>
                          {PERMISSION_LABELS[p]}
                          {locked && (
                            <span className="text-ink-2 block text-xs">
                              Always on for this role
                            </span>
                          )}
                          {notMine && !locked && (
                            <span className="text-ink-2 block text-xs">
                              Only someone who has this can give or remove it
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          )
        })}
      </div>
    </div>
  )
}
