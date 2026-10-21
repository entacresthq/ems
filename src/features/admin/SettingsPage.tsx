import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { adminKeys, settingsApi } from '@/api/admin'
import { isApiError } from '@/api/client'
import { MoneyInput } from '@/components/form/MoneyInput'
import { Checkbox, Select, TextArea, TextInput } from '@/components/form/inputs'
import { ErrorState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import {
  accountNumberLength,
  MAX_ACCOUNT_NUMBER_LENGTH,
  previewAccountNumber,
  validateAccountNumberFormat,
} from '@/lib/accountNumber'
import { formatDate, formatDateTime } from '@/lib/dates'
import { chargeFor, NO_CHARGES } from '@/lib/charges'
import { ACTIVITY_WINDOW_DAYS, DEFAULT_LOAN_ELIGIBILITY } from '@/lib/eligibility'
import { formatNaira, kobo, type Kobo } from '@/lib/money'
import { PERMISSION_GROUPS, PERMISSION_LABELS } from '@/lib/permissionCatalogue'
import { hasPermission } from '@/lib/permissions'
import {
  ROLE_LABELS,
  ROLES,
  TRANSACTION_EDITOR_ROLES,
  type AccountNumberFormat,
  type BusinessSettings,
  type Holiday,
  type LoanEligibilityPolicy,
  type Permission,
  type Role,
  type SettingsInput,
  type WithdrawalCharge,
} from '@/types'

type Tab = 'business' | 'calendar' | 'limits' | 'charges' | 'lending' | 'accounts' | 'sms' | 'roles'
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function SettingsPage() {
  const user = useCurrentUser()
  const [tab, setTab] = useState<Tab>('business')
  const query = useQuery({ queryKey: adminKeys.settings, queryFn: settingsApi.get })
  const tabs: { value: Tab; label: string }[] = [
    { value: 'business', label: 'Business details' },
    { value: 'calendar', label: 'Working days and holidays' },
    { value: 'limits', label: 'Limits' },
    { value: 'charges', label: 'Transaction charges' },
    { value: 'lending', label: 'Loan eligibility' },
    { value: 'accounts', label: 'Account numbers' },
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
      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start">
        <nav className="min-w-0 lg:sticky lg:top-20">
          <Tabs
            label="Settings sections"
            value={tab}
            onChange={setTab}
            items={tabs}
            orientation="vertical"
          />
        </nav>
        <div className="max-w-4xl min-w-0">
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
          ) : tab === 'charges' ? (
            <ChargesForm s={query.data} />
          ) : tab === 'lending' ? (
            <LoanEligibilityForm s={query.data} />
          ) : tab === 'accounts' ? (
            <AccountNumberForm s={query.data} />
          ) : tab === 'sms' ? (
            <SmsForm s={query.data} />
          ) : (
            <RolesForm s={query.data} />
          )}
        </div>
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

const SAVINGS_TYPES = [
  { value: 'savings', label: 'Savings' },
  { value: 'target', label: 'Target savings' },
  { value: 'thrift', label: 'Thrift' },
] as const

function LoanEligibilityForm({ s }: { s: BusinessSettings }) {
  const initial = s.loanEligibility ?? DEFAULT_LOAN_ELIGIBILITY
  const [p, setP] = useState<LoanEligibilityPolicy>(initial)
  const [minSavings, setMinSavings] = useState<Kobo | null>(initial.minSavings)
  const [multiplier, setMultiplier] = useState(
    initial.savingsMultiplier ? String(Number(initial.savingsMultiplier)) : '',
  )
  const [repayment, setRepayment] = useState(
    initial.maxRepaymentPercent ? String(Number(initial.maxRepaymentPercent)) : '',
  )
  const [membership, setMembership] = useState(String(initial.minMembershipDays))
  const [deposits, setDeposits] = useState(String(initial.minDepositsInWindow))
  const [topUpArrears, setTopUpArrears] = useState(String(initial.topUpMaxDaysInArrears))
  const [topUpRepaid, setTopUpRepaid] = useState(String(Number(initial.topUpMinRepaidPercent)))
  const { save, errors, formError, busy } = useSave()
  const set = (patch: Partial<LoanEligibilityPolicy>) => setP((x) => ({ ...x, ...patch }))
  const err = (key: keyof LoanEligibilityPolicy) => errors[`loanEligibility.${key}`]
  const off = !p.enabled
  return (
    <Panel title="Loan eligibility">
      <p className="text-ink-2 mb-4 text-sm">
        Decides who qualifies for a loan and the most they can borrow, on top of each product’s own
        amounts, tenors and guarantor rule. Staff see the result on the customer’s page and while
        applying, and it is recorded on every application for the approver. A BVN, next of kin and
        no other open loan are always required.
      </p>
      {formError && (
        <Alert tone="danger" className="mb-4">
          {formError}
        </Alert>
      )}
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Checkbox
            label="Check applications against this policy"
            checked={p.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
            className="sm:col-span-2"
          />
          <Select
            label="When an application fails"
            value={p.enforcement}
            onChange={(e) =>
              set({ enforcement: e.target.value as LoanEligibilityPolicy['enforcement'] })
            }
            error={err('enforcement')}
            disabled={off}
            hint={
              p.enforcement === 'block'
                ? 'Staff cannot send it, and cannot ask for more than the customer qualifies for.'
                : 'It can still be sent. The approver sees what failed and decides.'
            }
          >
            <option value="advise">Flag it for the approver</option>
            <option value="block">Refuse it</option>
          </Select>
        </div>

        <fieldset className="border-rule rounded border p-4" disabled={off}>
          <legend className="px-1 text-sm font-semibold">Who qualifies</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Customer for at least (days)"
              inputMode="numeric"
              value={membership}
              onChange={(e) => setMembership(e.target.value.replace(/\D/g, ''))}
              error={err('minMembershipDays')}
              hint="0 to allow new customers to borrow at once."
            />
            <TextInput
              label={`Deposits or contributions in the last ${ACTIVITY_WINDOW_DAYS} days`}
              inputMode="numeric"
              value={deposits}
              onChange={(e) => setDeposits(e.target.value.replace(/\D/g, ''))}
              error={err('minDepositsInWindow')}
              hint="Shows the customer saves regularly. 0 for no requirement."
            />
            <MoneyInput
              label="Savings of at least"
              optional
              value={minSavings}
              onChange={setMinSavings}
              error={err('minSavings')}
              hint="Leave empty for no minimum."
            />
            <Checkbox
              label="Refuse customers who have had a loan written off"
              checked={p.blockAfterWriteOff}
              onChange={(e) => set({ blockAfterWriteOff: e.target.checked })}
              className="self-center"
            />
          </div>
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">Count these balances as savings</p>
            <div className="flex flex-wrap gap-4">
              {SAVINGS_TYPES.map((t) => (
                <Checkbox
                  key={t.value}
                  label={t.label}
                  checked={p.savingsAccountTypes.includes(t.value)}
                  onChange={(e) =>
                    set({
                      savingsAccountTypes: e.target.checked
                        ? [...p.savingsAccountTypes, t.value]
                        : p.savingsAccountTypes.filter((x) => x !== t.value),
                    })
                  }
                />
              ))}
            </div>
            {err('savingsAccountTypes') && (
              <p className="text-brick mt-1 text-sm">{err('savingsAccountTypes')}</p>
            )}
          </div>
        </fieldset>

        <fieldset className="border-rule rounded border p-4" disabled={off}>
          <legend className="px-1 text-sm font-semibold">How much they qualify for</legend>
          <p className="text-ink-2 mb-3 text-sm">
            The smallest of the product’s largest amount and the limits below. Leave a limit empty
            to not use it.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Times savings"
              inputMode="decimal"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value.replace(/[^\d.]/g, ''))}
              error={err('savingsMultiplier')}
              hint={
                multiplier
                  ? `A customer with ₦100,000 saved can borrow up to ${formatNaira(kobo(Math.round(100_000_00 * Number(multiplier))), { trimZeroKobo: true })}.`
                  : 'No limit from savings.'
              }
            />
            <TextInput
              label="Repayments, as % of what they pay in each month"
              inputMode="decimal"
              value={repayment}
              onChange={(e) => setRepayment(e.target.value.replace(/[^\d.]/g, ''))}
              error={err('maxRepaymentPercent')}
              hint={
                repayment
                  ? `A customer who pays in ₦60,000 a month can take on repayments of up to ${formatNaira(kobo(Math.round((60_000_00 * Number(repayment)) / 100)), { trimZeroKobo: true })} a month.`
                  : 'No affordability limit.'
              }
            />
          </div>
        </fieldset>

        <fieldset className="border-rule rounded border p-4" disabled={off}>
          <legend className="px-1 text-sm font-semibold">Top-ups</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Current loan at most this many days in arrears"
              inputMode="numeric"
              value={topUpArrears}
              onChange={(e) => setTopUpArrears(e.target.value.replace(/\D/g, ''))}
              error={err('topUpMaxDaysInArrears')}
              hint="0 means the loan must be up to date."
            />
            <TextInput
              label="At least this % of the current loan repaid"
              inputMode="decimal"
              value={topUpRepaid}
              onChange={(e) => setTopUpRepaid(e.target.value.replace(/[^\d.]/g, ''))}
              error={err('topUpMinRepaidPercent')}
            />
          </div>
        </fieldset>
      </div>
      <SaveBar
        busy={busy}
        label="Save loan eligibility"
        onSave={() =>
          save(
            {
              loanEligibility: {
                ...p,
                minSavings: minSavings ?? kobo(0),
                savingsMultiplier: multiplier || null,
                maxRepaymentPercent: repayment || null,
                minMembershipDays: Number(membership || 0),
                minDepositsInWindow: Number(deposits || 0),
                topUpMaxDaysInArrears: Number(topUpArrears || 0),
                topUpMinRepaidPercent: topUpRepaid || '0',
              },
            },
            'Loan eligibility saved',
          )
        }
      />
    </Panel>
  )
}

/** One withdrawal charge being edited: the rule type and its inputs. */
interface ChargeDraft {
  type: WithdrawalCharge['type']
  percent: string
  cap: Kobo | null
  amount: Kobo | null
}

const toDraft = (rule: WithdrawalCharge): ChargeDraft => ({
  type: rule.type,
  percent: rule.type === 'percentage' ? String(Number(rule.percent)) : '1',
  cap: rule.type === 'percentage' ? rule.cap : null,
  amount: rule.type === 'flat' ? rule.amount : null,
})

const fromDraft = (d: ChargeDraft): WithdrawalCharge =>
  d.type === 'flat'
    ? { type: 'flat', amount: d.amount ?? kobo(0) }
    : d.type === 'percentage'
      ? { type: 'percentage', percent: d.percent, cap: d.cap }
      : { type: 'none' }

const EXAMPLE_WITHDRAWAL = kobo(10_000 * 100)

function ChargesForm({ s }: { s: BusinessSettings }) {
  const charges = s.transactionCharges ?? NO_CHARGES
  const [savings, setSavings] = useState(() => toDraft(charges.savingsWithdrawal))
  const [target, setTarget] = useState(() => toDraft(charges.targetWithdrawal))
  const { save, errors, formError, busy } = useSave()
  return (
    <Panel title="Withdrawal charges">
      <p className="text-ink-2 mb-4 text-sm">
        Taken from the account when a customer withdraws, as a separate “Withdrawal charge” entry,
        and counted as income. The cashier sees the charge before posting. Reversing a withdrawal
        refunds its charge. Changes apply to withdrawals from now on.
      </p>
      {formError && (
        <Alert tone="danger" className="mb-4">
          {formError}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChargeEditor
          title="Savings accounts"
          value={savings}
          onChange={setSavings}
          error={errors['transactionCharges.savingsWithdrawal']}
        />
        <ChargeEditor
          title="Target savings accounts"
          value={target}
          onChange={setTarget}
          error={errors['transactionCharges.targetWithdrawal']}
        />
      </div>
      <SaveBar
        busy={busy}
        label="Save charges"
        onSave={() =>
          save(
            {
              transactionCharges: {
                savingsWithdrawal: fromDraft(savings),
                targetWithdrawal: fromDraft(target),
              },
            },
            'Charges saved',
          )
        }
      />
    </Panel>
  )
}

function ChargeEditor({
  title,
  value,
  onChange,
  error,
}: {
  title: string
  value: ChargeDraft
  onChange: (next: ChargeDraft) => void
  error?: string
}) {
  const set = (patch: Partial<ChargeDraft>) => onChange({ ...value, ...patch })
  const rule = fromDraft(value)
  const example = chargeFor(EXAMPLE_WITHDRAWAL, rule)
  const money = (k: Kobo) => formatNaira(k, { trimZeroKobo: true })
  return (
    <fieldset className="border-rule rounded border p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="flex flex-col gap-3">
        <Select
          label="Charge"
          value={value.type}
          onChange={(e) => set({ type: e.target.value as ChargeDraft['type'] })}
          error={error}
        >
          <option value="none">No charge</option>
          <option value="percentage">Percentage of the amount</option>
          <option value="flat">Flat fee per withdrawal</option>
        </Select>
        {value.type === 'percentage' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Percentage"
              inputMode="decimal"
              value={value.percent}
              onChange={(e) => set({ percent: e.target.value.replace(/[^\d.]/g, '') })}
              hint="e.g. 1 for 1%"
            />
            <MoneyInput
              label="At most"
              optional
              value={value.cap}
              onChange={(cap) => set({ cap })}
              hint="Leave empty for no limit."
            />
          </div>
        )}
        {value.type === 'flat' && (
          <MoneyInput
            label="Fee per withdrawal"
            value={value.amount}
            onChange={(amount) => set({ amount })}
          />
        )}
        <p className="text-ink-2 text-sm">
          {value.type === 'none'
            ? 'Customers withdraw without a charge.'
            : `Withdrawing ${money(EXAMPLE_WITHDRAWAL)} costs ${money(example)}, so ${money(kobo(EXAMPLE_WITHDRAWAL + example))} comes out of the account.`}
        </p>
      </div>
    </fieldset>
  )
}

function AccountNumberForm({ s }: { s: BusinessSettings }) {
  const [format, setFormat] = useState<AccountNumberFormat>(s.accountNumberFormat)
  const { save, errors, formError, busy } = useSave()
  const set = <K extends keyof AccountNumberFormat>(key: K, value: AccountNumberFormat[K]) =>
    setFormat((f) => ({ ...f, [key]: value }))
  const clean = { ...format, prefix: format.prefix.toUpperCase() }
  const problem = validateAccountNumberFormat(clean)
  const saved = JSON.stringify(s.accountNumberFormat) === JSON.stringify(clean)
  return (
    <Panel title="Account numbers">
      {(formError || errors.accountNumberFormat) && (
        <Alert tone="danger" className="mb-4">
          {errors.accountNumberFormat ?? formError}
        </Alert>
      )}
      <p className="text-ink-2 mb-4 text-sm">
        Choose how new account numbers are built. The parts always come in this order: prefix,
        branch code, product code, year, then a running serial number. Accounts that already exist
        keep their numbers.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Prefix"
          optional
          maxLength={4}
          autoCapitalize="characters"
          className="font-mono uppercase"
          value={format.prefix}
          onChange={(e) => set('prefix', e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
          hint="Up to 4 letters or digits, like EMS. Leave empty for none."
        />
        <TextInput
          label="Serial number digits"
          inputMode="numeric"
          value={String(format.serialLength)}
          onChange={(e) => set('serialLength', Number(e.target.value.replace(/\D/g, '')) || 0)}
          hint="3 to 10. The serial goes up by one for every new account."
        />
        <Select
          label="Between the parts"
          value={format.separator}
          onChange={(e) => set('separator', e.target.value as AccountNumberFormat['separator'])}
        >
          <option value="">Nothing (2110000001)</option>
          <option value="-">A dash (21-10-000001)</option>
        </Select>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-ink mb-1 text-sm font-medium">Include</legend>
          <Checkbox
            label="Branch code (2 digits)"
            checked={format.includeBranch}
            onChange={(e) => set('includeBranch', e.target.checked)}
          />
          <Checkbox
            label="Product code (2 digits)"
            checked={format.includeProduct}
            onChange={(e) => set('includeProduct', e.target.checked)}
          />
          <Checkbox
            label="Year the account is opened (2 digits)"
            checked={format.includeYear}
            onChange={(e) => set('includeYear', e.target.checked)}
          />
        </fieldset>
      </div>
      <div className="bg-paper border-rule mt-4 rounded border px-4 py-3">
        <p className="text-ink-2 text-sm">A new account would look like</p>
        {problem ? (
          <p className="text-brick mt-1 text-sm font-medium">{problem}</p>
        ) : (
          <>
            <p className="mt-1 font-mono text-xl font-semibold">{previewAccountNumber(clean)}</p>
            <p className="text-ink-2 mt-1 text-sm">
              {accountNumberLength(clean)} characters (the most allowed is{' '}
              {MAX_ACCOUNT_NUMBER_LENGTH}). Product codes: savings 10, target savings 11, and the
              code of each thrift plan or loan product.
            </p>
          </>
        )}
      </div>
      <SaveBar
        busy={busy}
        label="Save account number format"
        dirty={!problem && !saved}
        onSave={() => save({ accountNumberFormat: clean }, 'Account number format saved')}
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
    (role === 'account_officer' && p === 'field.collect') ||
    // Only the MD and general managers may ever edit posted transactions.
    (p === 'transactions.edit' && !TRANSACTION_EDITOR_ROLES.includes(role))
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
