import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { adminKeys, settingsApi } from '@/api/admin'
import { isApiError } from '@/api/client'
import { MoneyInput } from '@/components/form/MoneyInput'
import { Checkbox, TextArea, TextInput } from '@/components/form/inputs'
import { ErrorState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { formatDate, formatDateTime } from '@/lib/dates'
import { formatNaira, type Kobo } from '@/lib/money'
import { PERMISSION_GROUPS, PERMISSION_LABELS } from '@/lib/permissionCatalogue'
import { hasPermission } from '@/lib/permissions'
import {
  ROLE_LABELS,
  ROLES,
  type BusinessSettings,
  type Holiday,
  type Permission,
  type Role,
  type SettingsInput,
} from '@/types'

type Tab = 'business' | 'calendar' | 'limits' | 'sms' | 'roles'
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function SettingsPage() {
  const user = useCurrentUser()
  const [tab, setTab] = useState<Tab>('business')
  const query = useQuery({ queryKey: adminKeys.settings, queryFn: settingsApi.get })
  const tabs: { value: Tab; label: string }[] = [
    { value: 'business', label: 'Business details' },
    { value: 'calendar', label: 'Working days and holidays' },
    { value: 'limits', label: 'Limits' },
    { value: 'sms', label: 'SMS messages' },
    ...(hasPermission(user, 'staff.permissions')
      ? [{ value: 'roles' as const, label: 'What each role allows' }]
      : []),
  ]
  return (
    <>
      <PageHeader
        title="Settings"
        description={
          query.data?.updatedByName
            ? `Last changed by ${query.data.updatedByName} on ${formatDateTime(query.data.updatedAt)}. Every change is recorded in the audit log.`
            : 'Every change is recorded in the audit log.'
        }
      />
      <Tabs label="Settings sections" value={tab} onChange={setTab} items={tabs} />
      <div className="mt-6 max-w-4xl">
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : tab === 'business' ? (
          <BusinessForm s={query.data} />
        ) : tab === 'calendar' ? (
          <CalendarForm s={query.data} />
        ) : tab === 'limits' ? (
          <LimitsForm s={query.data} />
        ) : tab === 'sms' ? (
          <SmsForm s={query.data} />
        ) : (
          <RolesForm s={query.data} />
        )}
      </div>
    </>
  )
}

/** Save one section; field errors come back keyed like the input. */
function useSave() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (input: SettingsInput, done: string) => {
    setBusy(true)
    setErrors({})
    setFormError(null)
    try {
      const saved = await settingsApi.update(input)
      queryClient.setQueryData(adminKeys.settings, saved)
      toast({ title: done })
    } catch (e) {
      if (isApiError(e)) {
        setErrors(
          Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v.join(' ')])),
        )
        setFormError(
          e.formErrors.join(' ') ||
            (Object.keys(e.fieldErrors).length ? 'Some details need fixing.' : e.message),
        )
      } else setFormError('Not saved. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return { save, errors, formError, busy }
}

function SaveBar({
  busy,
  label,
  onSave,
  dirty = true,
}: {
  busy: boolean
  label: string
  onSave: () => void
  dirty?: boolean
}) {
  return (
    <div className="mt-4 flex justify-end">
      <Button variant="primary" loading={busy} onClick={onSave} disabled={!dirty}>
        {label}
      </Button>
    </div>
  )
}

function BusinessForm({ s }: { s: BusinessSettings }) {
  const [v, setV] = useState({
    businessName: s.businessName,
    address: s.address,
    phone: s.phone,
    email: s.email,
    registrationNumber: s.registrationNumber,
    smsSenderId: s.smsSenderId,
  })
  const { save, errors, formError, busy } = useSave()
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV((x) => ({ ...x, [k]: e.target.value }))
  return (
    <Panel title="Business details">
      {formError && (
        <Alert tone="danger" className="mb-4">
          {formError}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Registered name"
          containerClassName="sm:col-span-2"
          value={v.businessName}
          onChange={set('businessName')}
          error={errors.businessName}
          hint="Shown on reports, statements and receipts."
        />
        <TextInput
          label="Head office address"
          containerClassName="sm:col-span-2"
          value={v.address}
          onChange={set('address')}
          error={errors.address}
        />
        <TextInput label="Phone" value={v.phone} onChange={set('phone')} error={errors.phone} />
        <TextInput label="Email" value={v.email} onChange={set('email')} error={errors.email} />
        <TextInput
          label="Registration number"
          optional
          value={v.registrationNumber}
          onChange={set('registrationNumber')}
          error={errors.registrationNumber}
        />
        <TextInput
          label="SMS sender ID"
          value={v.smsSenderId}
          maxLength={11}
          onChange={set('smsSenderId')}
          error={errors.smsSenderId}
          hint="The name customers see on SMS. Up to 11 letters or numbers, registered with your SMS provider."
        />
      </div>
      <SaveBar
        busy={busy}
        label="Save business details"
        onSave={() => save(v, 'Business details saved')}
      />
    </Panel>
  )
}

function CalendarForm({ s }: { s: BusinessSettings }) {
  const [days, setDays] = useState<number[]>(s.workingDays)
  const [holidays, setHolidays] = useState<Holiday[]>(s.holidays)
  const [newDate, setNewDate] = useState('')
  const [newName, setNewName] = useState('')
  const { save, errors, formError, busy } = useSave()
  const add = () => {
    if (!newDate || !newName.trim()) return
    setHolidays((h) =>
      [...h.filter((x) => x.date !== newDate), { date: newDate, name: newName.trim() }].sort(
        (a, b) => a.date.localeCompare(b.date),
      ),
    )
    setNewDate('')
    setNewName('')
  }
  return (
    <div className="flex flex-col gap-6">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Panel title="Working days">
        <p className="text-ink-2 mb-3 text-sm">
          Daily loans and thrift fall due only on working days. Weekly and monthly installments that
          land on a closed day move to the next working day.
        </p>
        <div className="flex flex-wrap gap-4">
          {DAYS.map((d, i) => (
            <Checkbox
              key={d}
              label={d}
              checked={days.includes(i)}
              onChange={(e) =>
                setDays((x) => (e.target.checked ? [...x, i].sort() : x.filter((y) => y !== i)))
              }
            />
          ))}
        </div>
        {errors.workingDays && (
          <p className="text-brick mt-2 text-sm font-medium">{errors.workingDays}</p>
        )}
      </Panel>
      <Panel title="Public holidays">
        <p className="text-ink-2 mb-3 text-sm">
          Nothing falls due on a holiday. Islamic holidays depend on the moon; confirm their dates
          when they are announced. Changes apply to new schedules and extensions, not to loans
          already paid out.
        </p>
        <ul className="divide-rule border-rule divide-y border-y">
          {holidays.map((h) => (
            <li key={h.date} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="tabular inline-block w-28">{formatDate(h.date)}</span> {h.name}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${h.name}`}
                icon={<Trash2 className="size-4" aria-hidden />}
                onClick={() => setHolidays((x) => x.filter((y) => y.date !== h.date))}
              />
            </li>
          ))}
        </ul>
        {errors.holidays && (
          <p className="text-brick mt-2 text-sm font-medium">{errors.holidays}</p>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <TextInput
            label="Date"
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
          <TextInput
            label="Holiday"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Eid-el-Fitr"
          />
          <Button
            icon={<Plus className="size-4" aria-hidden />}
            onClick={add}
            disabled={!newDate || !newName.trim()}
          >
            Add holiday
          </Button>
        </div>
      </Panel>
      <SaveBar
        busy={busy}
        label="Save working days and holidays"
        onSave={() => save({ workingDays: days, holidays }, 'Calendar saved')}
      />
    </div>
  )
}

function LimitsForm({ s }: { s: BusinessSettings }) {
  const [threshold, setThreshold] = useState<Kobo | null>(s.largeWithdrawalThreshold)
  const [window, setWindow] = useState(String(s.reversalWindowDays))
  const [syncAge, setSyncAge] = useState(String(s.fieldSyncMaxAgeDays))
  const { save, errors, formError, busy } = useSave()
  return (
    <Panel title="Limits">
      {formError && (
        <Alert tone="danger" className="mb-4">
          {formError}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyInput
          label="Withdrawals that need approval"
          value={threshold}
          onChange={setThreshold}
          error={errors.largeWithdrawalThreshold}
          hint={
            threshold
              ? `Counter withdrawals of ${formatNaira(threshold, { trimZeroKobo: true })} or more wait for a manager.`
              : undefined
          }
        />
        <TextInput
          label="Reversals allowed for (days)"
          inputMode="numeric"
          value={window}
          onChange={(e) => setWindow(e.target.value.replace(/\D/g, ''))}
          error={errors.reversalWindowDays}
          hint="Older transactions need a correcting entry instead."
        />
        <TextInput
          label="Field collections sync within (days)"
          inputMode="numeric"
          value={syncAge}
          onChange={(e) => setSyncAge(e.target.value.replace(/\D/g, ''))}
          error={errors.fieldSyncMaxAgeDays}
          hint="Collections older than this are refused and must be posted at the counter."
        />
      </div>
      <SaveBar
        busy={busy}
        label="Save limits"
        onSave={() =>
          threshold &&
          save(
            {
              largeWithdrawalThreshold: threshold,
              reversalWindowDays: Number(window),
              fieldSyncMaxAgeDays: Number(syncAge),
            },
            'Limits saved',
          )
        }
      />
    </Panel>
  )
}

const SAMPLE: Record<string, string> = {
  '{customer_name}': 'Adebola Ogunleye',
  '{amount}': '₦2,000.00',
  '{account_type}': 'thrift',
  '{account_number}': '0122000334',
  '{date}': '26 Sep 2026',
  '{balance}': '₦14,000.00',
  '{reference}': 'EMS26092600041',
  '{officer_name}': 'Olumide Salami',
  '{loan_number}': 'LN01000123',
  '{installment}': '₦5,833.34',
  '{due_date}': '3 Oct 2026',
  '{days_late}': '9',
  '{arrears}': '₦17,500.02',
  '{code}': '123456',
}

function SmsForm({ s }: { s: BusinessSettings }) {
  const [templates, setTemplates] = useState(s.smsTemplates)
  const { save, errors, formError, busy } = useSave()
  return (
    <div className="flex flex-col gap-4">
      {formError && <Alert tone="danger">{formError}</Alert>}
      {templates.map((t, i) => {
        const preview = Object.entries(SAMPLE).reduce(
          (text, [k, v]) => text.replaceAll(k, v),
          t.body,
        )
        const parts = preview.length <= 160 ? 1 : Math.ceil(preview.length / 153)
        return (
          <Panel
            key={t.key}
            title={t.label}
            actions={
              t.key !== 'login_otp' && (
                <Checkbox
                  label="Send this message"
                  checked={t.enabled}
                  onChange={(e) =>
                    setTemplates((all) =>
                      all.map((x) => (x.key === t.key ? { ...x, enabled: e.target.checked } : x)),
                    )
                  }
                />
              )
            }
          >
            <p className="text-ink-2 mb-2 text-sm">Sent when: {t.trigger}</p>
            <TextArea
              label="Message"
              rows={3}
              value={t.body}
              onChange={(e) =>
                setTemplates((all) =>
                  all.map((x) => (x.key === t.key ? { ...x, body: e.target.value } : x)),
                )
              }
              error={errors[`smsTemplates.${i}.body`]}
              hint={`You can use ${t.placeholders.join(' ')}`}
            />
            <div className="bg-paper mt-3 rounded px-3 py-2 text-sm">
              <p className="text-ink-2 text-xs font-medium">
                Preview · {preview.length} characters · {parts} SMS{' '}
                {parts > 1 ? 'parts (charged per part)' : 'part'}
              </p>
              <p className="mt-1">{preview}</p>
            </div>
          </Panel>
        )
      })}
      <SaveBar
        busy={busy}
        label="Save SMS messages"
        onSave={() => save({ smsTemplates: templates }, 'SMS messages saved')}
      />
    </div>
  )
}

function RolesForm({ s }: { s: BusinessSettings }) {
  const [matrix, setMatrix] = useState<Record<Role, Permission[]>>(s.rolePermissions)
  const { save, formError, busy } = useSave()
  const locked = (role: Role, p: Permission) =>
    role === 'md' ||
    (role === 'admin' && ['settings.manage', 'staff.manage', 'staff.view'].includes(p)) ||
    (role === 'account_officer' && p === 'field.collect')
  const toggle = (role: Role, p: Permission, on: boolean) =>
    setMatrix((m) => ({ ...m, [role]: on ? [...m[role], p] : m[role].filter((x) => x !== p) }))
  return (
    <>
      {formError && (
        <Alert tone="danger" className="mb-4">
          {formError}
        </Alert>
      )}
      <Alert tone="info" className="mb-4">
        These are the permissions each role can be given. When you add a staff member you choose
        some or all of them for that person. Taking a permission away from a role also takes it from
        everyone in that role. Adding one gives it to nobody until you assign it on each person’s
        staff page. The managing director always has every permission.
      </Alert>
      <div
        className="border-rule bg-surface overflow-auto rounded border"
        style={{ maxHeight: 'calc(100dvh - 20rem)' }}
      >
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface sticky top-0 z-10 shadow-[inset_0_-1px_0_var(--color-rule-strong)]">
            <tr>
              <th scope="col" className="text-ink-2 px-3 py-2 text-left text-xs font-semibold">
                Permission
              </th>
              {ROLES.map((r) => (
                <th
                  key={r}
                  scope="col"
                  className="text-ink-2 px-2 py-2 text-center text-xs font-semibold whitespace-nowrap"
                >
                  {ROLE_LABELS[r]}
                </th>
              ))}
            </tr>
          </thead>
          {PERMISSION_GROUPS.map((group) => (
            <tbody key={group.title}>
              <tr className="bg-paper border-rule border-b">
                <th
                  scope="colgroup"
                  colSpan={ROLES.length + 1}
                  className="px-3 py-1.5 text-left text-xs font-semibold tracking-wide uppercase"
                >
                  {group.title}
                </th>
              </tr>
              {group.permissions.map((p) => (
                <tr key={p} className="border-rule hover:bg-paper border-b last:border-0">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">
                    {PERMISSION_LABELS[p]}
                  </th>
                  {ROLES.map((r) => (
                    <td key={r} className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        className="accent-ledger size-4"
                        checked={matrix[r].includes(p)}
                        disabled={locked(r, p)}
                        onChange={(e) => toggle(r, p, e.target.checked)}
                        aria-label={`${ROLE_LABELS[r]}: ${PERMISSION_LABELS[p]}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <SaveBar
        busy={busy}
        label="Save permissions"
        onSave={() => save({ rolePermissions: matrix }, 'Permissions saved')}
      />
    </>
  )
}
