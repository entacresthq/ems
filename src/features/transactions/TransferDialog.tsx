import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { accountKeys, accountsApi } from '@/api/accounts'
import { adminKeys, settingsApi } from '@/api/admin'
import { isApiError } from '@/api/client'
import { transfersApi } from '@/api/transfers'
import { MoneyInput } from '@/components/form/MoneyInput'
import { Select, TextInput } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Money } from '@/components/ui/display'
import { SegmentedControl } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { looksLikeAccountNumber } from '@/lib/accountNumber'
import { formatNaira, kobo, type Kobo } from '@/lib/money'
import { ACCOUNT_TYPE_LABELS, approvesOwnRequests, type Account } from '@/types'

const FROM_TYPES: Account['type'][] = ['savings', 'target', 'thrift']
const TO_TYPES: Account['type'][] = ['savings', 'target', 'thrift', 'loan']

const cleanNumber = (v: string) => v.replace(/[^A-Za-z0-9-]/g, '').toUpperCase()

/**
 * Move money between accounts: the customer's own, or another customer's.
 * Paying into a loan account counts as a repayment. Large transfers wait for a
 * manager, like large withdrawals. The server checks everything again.
 */
export function TransferDialog({
  open,
  onClose,
  from: preset,
}: {
  open: boolean
  onClose: () => void
  from?: Account
}) {
  return open ? <TransferForm onClose={onClose} preset={preset} /> : null
}

function TransferForm({ onClose, preset }: { onClose: () => void; preset?: Account }) {
  const [fromNumber, setFromNumber] = useState(preset?.accountNumber ?? '')
  const [mode, setMode] = useState<'own' | 'other'>('own')
  const [ownId, setOwnId] = useState('')
  const [toNumber, setToNumber] = useState('')
  const [amount, setAmount] = useState<Kobo | null>(null)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const user = useCurrentUser()
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: settingsApi.get })

  // Where the money comes from: an account in the teller's branch.
  const fromLookup = useQuery({
    queryKey: accountKeys.list({ search: fromNumber, pageSize: 5 }),
    queryFn: () => accountsApi.list({ search: fromNumber, pageSize: 5 }),
    enabled: !preset && looksLikeAccountNumber(fromNumber),
  })
  const from = preset ?? fromLookup.data?.results.find((a) => a.accountNumber === fromNumber)

  // The customer's other accounts.
  const own = useQuery({
    queryKey: accountKeys.list({ customer: from?.customerId, pageSize: 50 }),
    queryFn: () => accountsApi.list({ customer: from!.customerId, pageSize: 50 }),
    enabled: Boolean(from),
  })
  const ownChoices = (own.data?.results ?? []).filter(
    (a) => a.id !== from?.id && a.status === 'active' && TO_TYPES.includes(a.type),
  )

  // Another customer's account, from anywhere in the business.
  const enquiry = useQuery({
    queryKey: ['transfers', 'name-enquiry', toNumber],
    queryFn: () => transfersApi.nameEnquiry(toNumber),
    enabled: mode === 'other' && looksLikeAccountNumber(toNumber),
    retry: false,
  })

  const to =
    mode === 'own'
      ? ownChoices.find((a) => a.id === ownId)
      : enquiry.data && enquiry.data.id !== from?.id
        ? enquiry.data
        : undefined
  const limit = settings.data?.largeWithdrawalThreshold ?? kobo(500_000 * 100)
  const needsApproval = amount !== null && amount >= limit && !approvesOwnRequests(user)

  const submit = async () => {
    const local: Record<string, string> = {}
    if (!from) local.fromAccountId = 'Enter the account the money comes from.'
    else if (!FROM_TYPES.includes(from.type))
      local.fromAccountId = 'Money can be sent from savings, target savings and thrift accounts.'
    if (!to) local.toAccountId = 'Choose or enter the account the money goes to.'
    if (!amount) local.amount = 'Enter an amount greater than ₦0.'
    setErrors(local)
    if (!from || !to || !amount || Object.keys(local).length) return
    setBusy(true)
    try {
      const result = await transfersApi.create({
        fromAccountId: from.id,
        toAccountId: to.id,
        amount,
        narration: note.trim(),
      })
      await Promise.all(
        ['transactions', 'accounts', 'approvals', 'loans'].map((k) =>
          queryClient.invalidateQueries({ queryKey: [k] }),
        ),
      )
      toast(
        result.status === 'posted'
          ? {
              title: 'Transfer done',
              description: `${formatNaira(amount)} to ${to.accountNumber} (${to.customerName}). ${result.debit.reference}.`,
            }
          : {
              title: 'Sent for approval',
              description: 'A manager must approve this transfer before the money moves.',
            },
      )
      onClose()
    } catch (e) {
      if (isApiError(e))
        setErrors({
          ...Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v.join(' ')])),
          form: e.formErrors.join(' '),
        })
      else setErrors({ form: 'Nothing was transferred. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title="Transfer between accounts"
      description="To another of the customer’s accounts, or to another customer. Paying into a loan counts as a repayment."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!from || !to}>
            {needsApproval ? 'Send for approval' : 'Transfer'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}

        {!preset && (
          <TextInput
            label="From account number"
            className="font-mono"
            maxLength={24}
            value={fromNumber}
            onChange={(e) => setFromNumber(cleanNumber(e.target.value))}
            error={errors.fromAccountId}
            hint={fromLookup.isFetching ? 'Looking up…' : undefined}
          />
        )}
        {from && <AccountCard label="From" account={from} showBalance />}
        {preset && errors.fromAccountId && (
          <p className="text-brick text-sm font-medium">{errors.fromAccountId}</p>
        )}

        {from && (
          <>
            <SegmentedControl
              label="Send to"
              value={mode}
              onChange={(m) => {
                setMode(m)
                setErrors({})
              }}
              options={[
                { value: 'own', label: 'Customer’s other account' },
                { value: 'other', label: 'Another customer' },
              ]}
            />
            {mode === 'own' ? (
              <Select
                label="To account"
                value={ownId}
                onChange={(e) => setOwnId(e.target.value)}
                error={errors.toAccountId}
                hint={
                  own.isSuccess && ownChoices.length === 0
                    ? 'This customer has no other active account. Open one, or send to another customer.'
                    : undefined
                }
              >
                <option value="">Choose…</option>
                {ownChoices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountNumber} · {ACCOUNT_TYPE_LABELS[a.type]}
                    {a.productName ? ` · ${a.productName}` : ''}
                  </option>
                ))}
              </Select>
            ) : (
              <>
                <TextInput
                  label="To account number"
                  className="font-mono"
                  maxLength={24}
                  value={toNumber}
                  onChange={(e) => setToNumber(cleanNumber(e.target.value))}
                  error={
                    errors.toAccountId ??
                    (enquiry.isError
                      ? 'No account with this number.'
                      : enquiry.data?.id === from.id
                        ? 'That is the account the money comes from.'
                        : undefined)
                  }
                  hint={enquiry.isFetching ? 'Checking the name…' : undefined}
                />
                {to && <AccountCard label="To" account={to} />}
              </>
            )}
          </>
        )}

        <MoneyInput label="Amount" value={amount} onChange={setAmount} error={errors.amount} />
        <TextInput
          label="Note"
          optional
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={140}
          placeholder="e.g. Rent for October"
        />
        {needsApproval && (
          <Alert tone="warning">
            Transfers of {formatNaira(limit)} or more need a manager’s approval before the money
            moves.
          </Alert>
        )}
        {from && to && amount ? (
          <p className="bg-paper border-rule rounded border px-3 py-2 text-sm">
            <Money value={amount} className="font-semibold" /> from{' '}
            <span className="font-mono">{from.accountNumber}</span> ({from.customerName}) to{' '}
            <span className="font-mono">{to.accountNumber}</span> ({to.customerName})
            {to.type === 'loan' && ', as a loan repayment'}.
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

function AccountCard({
  label,
  account: a,
  showBalance = false,
}: {
  label: string
  account: Pick<Account, 'accountNumber' | 'customerName' | 'type' | 'productName'> & {
    balance?: Kobo
    branchName?: string
  }
  showBalance?: boolean
}) {
  return (
    <div className="border-rule bg-paper rounded border px-3 py-2 text-sm">
      <p className="text-ink-2 text-xs font-semibold tracking-wide uppercase">{label}</p>
      <p className="font-semibold">{a.customerName}</p>
      <p className="text-ink-2">
        <span className="font-mono">{a.accountNumber}</span> · {ACCOUNT_TYPE_LABELS[a.type]}
        {a.productName ? ` · ${a.productName}` : ''}
        {a.branchName ? ` · ${a.branchName}` : ''}
      </p>
      {showBalance && a.balance !== undefined && (
        <p className="mt-1">
          Balance: <Money value={a.balance} className="font-medium" />
        </p>
      )}
    </div>
  )
}
