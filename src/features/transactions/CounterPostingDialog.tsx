import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { accountKeys, accountsApi } from '@/api/accounts'
import { adminKeys, settingsApi } from '@/api/admin'
import { isApiError } from '@/api/client'
import { transactionsApi } from '@/api/transactions'
import { MoneyInput } from '@/components/form/MoneyInput'
import { TextInput } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Money } from '@/components/ui/display'
import { SegmentedControl } from '@/components/ui/Tabs'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { accountNumberLength, looksLikeAccountNumber } from '@/lib/accountNumber'
import { formatNaira, kobo, type Kobo } from '@/lib/money'
import {
  ACCOUNT_TYPE_LABELS,
  approvesOwnRequests,
  TRANSACTION_TYPE_LABELS,
  type Account,
  type CounterPostingRequest,
  type PaymentMethod,
} from '@/types'

const TYPES_FOR: Record<Account['type'], CounterPostingRequest['type'][]> = {
  savings: ['deposit', 'withdrawal'],
  target: ['deposit', 'withdrawal'],
  thrift: ['thrift_contribution'],
  loan: ['loan_repayment'],
}

/**
 * Walk-in deposit, withdrawal or repayment at the counter. Withdrawals of
 * ₦500,000 or more go to a manager for approval instead of posting.
 */
export function CounterPostingDialog({
  open,
  onClose,
  account: preset,
}: {
  open: boolean
  onClose: () => void
  account?: Account
}) {
  return open ? <PostingForm onClose={onClose} preset={preset} /> : null
}

function PostingForm({ onClose, preset }: { onClose: () => void; preset?: Account }) {
  const [number, setNumber] = useState(preset?.accountNumber ?? '')
  const [lookup, setLookup] = useState(preset?.accountNumber ?? '')
  const [chosenType, setType] = useState<CounterPostingRequest['type'] | null>(null)
  const [amount, setAmount] = useState<Kobo | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [narration, setNarration] = useState('')
  const [errors, setErrors] = useState<{ form?: string; amount?: string; account?: string }>({})
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: adminKeys.settings,
    queryFn: settingsApi.get,
    staleTime: 10 * 60_000,
  })
  const toast = useToast()
  const user = useCurrentUser()

  const found = useQuery({
    queryKey: accountKeys.list({ search: lookup, pageSize: 5 }),
    queryFn: () => accountsApi.list({ search: lookup, pageSize: 5 }),
    enabled: !preset && looksLikeAccountNumber(lookup),
  })
  const account = preset ?? found.data?.results.find((a) => a.accountNumber === lookup)
  // Accounts opened before a format change keep their old length, so allow for both.
  const shortestLength = Math.min(
    10,
    settings.data ? accountNumberLength(settings.data.accountNumberFormat) : 10,
  )

  // The chosen type only applies if this account can take it; otherwise use the account's default.
  const type = account
    ? chosenType && TYPES_FOR[account.type].includes(chosenType)
      ? chosenType
      : TYPES_FOR[account.type][0]!
    : null

  // The limit is set in Settings; the server checks it again.
  const limit = settings.data?.largeWithdrawalThreshold ?? kobo(500_000 * 100)
  // The MD and general managers approve these for everyone else, so theirs post straight away.
  const needsApproval =
    type === 'withdrawal' && amount !== null && amount >= limit && !approvesOwnRequests(user)

  const submit = async () => {
    const next: typeof errors = {}
    if (!account) next.account = 'Enter the account number and check the customer name.'
    if (!amount) next.amount = 'Enter an amount greater than ₦0.'
    setErrors(next)
    if (!account || !amount || !type) return
    setBusy(true)
    try {
      const result = await transactionsApi.post({
        accountId: account.id,
        type,
        amount,
        paymentMethod: method,
        narration,
      })
      await Promise.all(
        ['transactions', 'accounts', 'approvals', 'loans'].map((k) =>
          queryClient.invalidateQueries({ queryKey: [k] }),
        ),
      )
      if (result.status === 'posted') {
        toast({
          title: `${TRANSACTION_TYPE_LABELS[type]} posted`,
          description: `${formatNaira(amount)} · ${result.transaction.reference}. New balance ${formatNaira(result.transaction.balanceAfter)}.`,
        })
      } else {
        toast({
          title: 'Sent for approval',
          description: 'A branch manager must approve this withdrawal before you pay out any cash.',
        })
      }
      onClose()
    } catch (e) {
      if (isApiError(e)) {
        setErrors({
          amount: e.fieldErrors.amount?.join(' '),
          account:
            [...(e.fieldErrors.accountId ?? []), ...(e.fieldErrors.type ?? [])].join(' ') ||
            undefined,
          form: e.formErrors.join(' ') || undefined,
        })
      } else setErrors({ form: 'Nothing was posted. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title="Post a counter transaction"
      description="For walk-in customers. Field collections are recorded by officers in the field app."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!account}>
            {needsApproval
              ? 'Send for approval'
              : type
                ? `Post ${TRANSACTION_TYPE_LABELS[type].toLowerCase()}`
                : 'Post'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        {!preset && (
          <TextInput
            label="Account number"
            autoCapitalize="characters"
            maxLength={24}
            className="font-mono"
            value={number}
            error={errors.account}
            hint={
              found.isFetching
                ? 'Looking up…'
                : // Only say "not found" once the number is as long as a real one.
                  lookup.length >= shortestLength && !account && found.isSuccess
                  ? 'No account with this number in your branch.'
                  : undefined
            }
            onChange={(e) => {
              const v = e.target.value.replace(/[^A-Za-z0-9-]/g, '').toUpperCase()
              setNumber(v)
              setLookup(looksLikeAccountNumber(v) ? v : '')
            }}
          />
        )}
        {account && (
          <div className="border-rule bg-paper rounded border px-3 py-2 text-sm">
            <p className="font-semibold">{account.customerName}</p>
            <p className="text-ink-2 flex flex-wrap items-center gap-2">
              <span className="font-mono">{account.accountNumber}</span> ·{' '}
              {ACCOUNT_TYPE_LABELS[account.type]}
              {account.productName && ` · ${account.productName}`} ·{' '}
              <StatusBadge status={account.status} />
            </p>
            <p className="mt-1">
              {account.type === 'loan' ? 'Outstanding' : 'Balance'}:{' '}
              <Money value={account.balance} className="font-medium" />
            </p>
          </div>
        )}
        {account && TYPES_FOR[account.type].length > 1 && type && (
          <SegmentedControl
            label="Transaction type"
            value={type}
            onChange={setType}
            options={TYPES_FOR[account.type].map((t) => ({
              value: t,
              label: TRANSACTION_TYPE_LABELS[t],
            }))}
          />
        )}
        <MoneyInput label="Amount" value={amount} onChange={setAmount} error={errors.amount} />
        {needsApproval && (
          <Alert tone="warning">
            Withdrawals of {formatNaira(limit)} or more need a manager's approval. Don't pay out
            cash until it is approved.
          </Alert>
        )}
        <SegmentedControl
          label={type === 'withdrawal' ? 'Paid out by' : 'Paid by'}
          value={method}
          onChange={setMethod}
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'transfer', label: 'Transfer' },
          ]}
        />
        <TextInput
          label="Note"
          optional
          placeholder="e.g. Paid by her son"
          value={narration}
          onChange={(e) => setNarration(e.target.value)}
          maxLength={140}
        />
      </div>
    </Dialog>
  )
}
