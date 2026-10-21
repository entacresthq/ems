import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { isApiError } from '@/api/client'
import { loanKeys, loansApi } from '@/api/loans'
import { transactionKeys, transactionsApi } from '@/api/transactions'
import { DataTable, type Column } from '@/components/data/DataTable'
import { TextArea, TextInput } from '@/components/form/inputs'
import { ErrorState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { Button, ButtonLink } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog } from '@/components/ui/Dialog'
import { BackLink, DescriptionList, Money, Panel, ProgressBar } from '@/components/ui/display'
import { Badge, StatusBadge, type Tone } from '@/components/ui/StatusBadge'
import { SegmentedControl } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { PendingApprovalBanner } from '@/features/approvals/ApprovalControls'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { signedAmount } from '@/features/transactions/TransactionDialog'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { formatDate, formatDateTime } from '@/lib/dates'
import { formatNaira, kobo } from '@/lib/money'
import { describeInterest } from '@/lib/loans'
import { hasPermission } from '@/lib/permissions'
import { formatPhone } from '@/lib/phone'
import {
  TRANSACTION_TYPE_LABELS,
  type LoanDetail,
  type LoanScheduleRow,
  type PaymentMethod,
  type Transaction,
} from '@/types'
import { EligibilitySnapshotPanel } from './Eligibility'
import { tenorLabel } from './LoanProductsPage'

const ROW_STATUS: Record<LoanScheduleRow['status'], { label: string; tone: Tone }> = {
  paid: { label: 'Paid', tone: 'success' },
  part_paid: { label: 'Part paid', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  due_today: { label: 'Due today', tone: 'info' },
  upcoming: { label: 'Upcoming', tone: 'neutral' },
}

export function LoanDetailPage() {
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: loanKeys.detail(id), queryFn: () => loansApi.get(id) })
  if (query.isPending) return <LoadingState label="Loading loan…" />
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        title="Couldn't load this loan"
      />
    )
  return <LoanView loan={query.data} />
}

function LoanView({ loan: l }: { loan: LoanDetail }) {
  useDocumentTitle(`Loan ${l.loanNumber}`)
  const user = useCurrentUser()
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(user, p)
  const [dialog, setDialog] = useState<'disburse' | 'extend' | 'penalty' | null>(null)
  const active = l.status === 'active'
  const paidPct =
    l.totalRepayable + l.penaltiesCharged > 0
      ? l.amountPaid / (l.totalRepayable + l.penaltiesCharged)
      : 0

  return (
    <>
      <BackLink to="/loans">Loans</BackLink>
      <PendingApprovalBanner params={{ loan: l.id }} />
      <header className="border-rule mb-6 flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-ink-2 text-sm">
            {l.productName} · {l.kind === 'bnpl' ? 'Buy now pay later · ' : ''}
            {tenorLabel(l.installmentCount, l.frequency)} · {describeInterest(l)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold">{l.loanNumber}</h1>
            <StatusBadge status={l.status} />
            {l.arrears > 0 && <Badge tone="danger">{l.daysInArrears} days in arrears</Badge>}
            {l.extensions > 0 && <Badge tone="info">Extended {l.extensions}×</Badge>}
          </div>
          <p className="mt-1 text-sm">
            <Link
              to={`/customers/${l.customerId}`}
              className="font-medium underline underline-offset-2"
            >
              {l.customerName}
            </Link>
            {l.accountId && (
              <>
                {' · '}
                <Link
                  to={`/accounts/${l.accountId}`}
                  className="font-mono underline underline-offset-2"
                >
                  {l.accountNumber}
                </Link>
              </>
            )}
            {l.topUpOfNumber && <span className="text-ink-2"> · top-up of {l.topUpOfNumber}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {l.status === 'approved' && can('loans.disburse') && (
            <Button variant="primary" onClick={() => setDialog('disburse')}>
              {l.kind === 'bnpl' ? 'Pay supplier' : 'Pay out loan'}
            </Button>
          )}
          {active && l.penaltyAccrued > 0 && can('loans.approve') && (
            <Button onClick={() => setDialog('penalty')}>
              Charge {formatNaira(l.penaltyAccrued)} penalty
            </Button>
          )}
          {active && can('loans.apply') && (
            <Button onClick={() => setDialog('extend')}>Request extension</Button>
          )}
          {active && l.kind === 'cash' && can('loans.apply') && (
            <ButtonLink
              to={`/loans/new?customer=${l.customerId}&topUp=${l.id}`}
              variant="secondary"
            >
              Top up loan
            </ButtonLink>
          )}
        </div>
      </header>

      {l.status === 'pending_approval' && (
        <Alert tone="warning" className="mb-6">
          This application is waiting for a second person to approve it. The schedule below is a
          preview; dates are set on the day the loan is paid out.
        </Alert>
      )}
      {l.status === 'approved' && (
        <Alert tone="info" className="mb-6">
          Approved by {l.approvedByName}.{' '}
          {can('loans.disburse')
            ? 'Pay it out when the customer comes in.'
            : 'The cashier pays it out when the customer comes in.'}
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {(active || l.status === 'closed') && (
            <section className="border-rule bg-rule grid grid-cols-2 gap-px overflow-hidden rounded border lg:grid-cols-4">
              {[
                { label: 'Outstanding', value: <Money value={l.outstanding} /> },
                {
                  label: 'Arrears',
                  value: <Money value={l.arrears} className={cn(l.arrears > 0 && 'text-brick')} />,
                },
                {
                  label: 'Next installment',
                  value: l.nextDueDate ? (
                    <span className="text-base">
                      {formatNaira(l.nextDueAmount!)} on {formatDate(l.nextDueDate)}
                    </span>
                  ) : (
                    '—'
                  ),
                },
                {
                  label: 'Penalty not yet charged',
                  value: (
                    <Money
                      value={l.penaltyAccrued}
                      className={cn(l.penaltyAccrued > 0 && 'text-ochre')}
                    />
                  ),
                },
              ].map((s) => (
                <div key={s.label} className="bg-surface px-4 py-3">
                  <p className="text-ink-2 text-xs font-medium">{s.label}</p>
                  <p className="tabular mt-1 text-lg font-semibold">{s.value}</p>
                </div>
              ))}
              <div className="bg-surface col-span-full px-4 py-3">
                <div className="mb-1.5 flex justify-between text-sm">
                  <span>
                    Repaid <strong className="tabular">{formatNaira(l.amountPaid)}</strong> of{' '}
                    {formatNaira(kobo(l.totalRepayable + l.penaltiesCharged))}
                  </span>
                  <span className="tabular text-ink-2">{Math.round(paidPct * 100)}%</span>
                </div>
                <ProgressBar
                  value={l.amountPaid}
                  max={l.totalRepayable + l.penaltiesCharged}
                  label="Repaid so far"
                />
              </div>
            </section>
          )}
          <Schedule rows={l.schedule} />
          {l.accountId && <Repayments accountId={l.accountId} />}
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Terms">
            <DescriptionList
              columns={1}
              items={[
                ...(l.kind === 'bnpl'
                  ? [
                      { label: 'Item', value: l.itemDescription },
                      { label: 'Supplier', value: l.supplierName },
                    ]
                  : []),
                {
                  label: l.kind === 'bnpl' ? 'Item price' : 'Amount borrowed',
                  value: <Money value={l.principal} />,
                },
                { label: 'Interest', value: <Money value={l.interest} /> },
                { label: 'Total to repay', value: <Money value={l.totalRepayable} /> },
                {
                  label: 'Installment',
                  value: `${formatNaira(l.installmentAmount)} ${l.frequency}`,
                },
                { label: 'Processing fee', value: <Money value={l.processingFee} /> },
                { label: 'Penalties charged', value: <Money value={l.penaltiesCharged} /> },
                ...(l.kind === 'cash' ? [{ label: 'Purpose', value: l.purpose }] : []),
              ]}
            />
          </Panel>
          {l.eligibility && <EligibilitySnapshotPanel snapshot={l.eligibility} />}
          <Panel title="History">
            <DescriptionList
              columns={1}
              items={[
                { label: 'Applied', value: `${formatDateTime(l.createdAt)} by ${l.appliedByName}` },
                { label: 'Approved by', value: l.approvedByName },
                {
                  label: 'Paid out',
                  value: l.disbursedAt
                    ? `${formatDateTime(l.disbursedAt)} by ${l.disbursedByName}`
                    : null,
                },
                {
                  label: 'Final installment',
                  value: l.maturityDate ? formatDate(l.maturityDate) : null,
                },
                { label: 'Closed', value: l.closedAt ? formatDate(l.closedAt) : null },
              ]}
            />
          </Panel>
          <Panel title={`Guarantors (${l.guarantors.length})`}>
            {l.guarantors.length === 0 ? (
              <p className="text-ink-2 text-sm">None.</p>
            ) : (
              <ul className="divide-rule flex flex-col divide-y">
                {l.guarantors.map((g) => (
                  <li key={g.id} className="flex gap-3 py-2 text-sm first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{g.fullName}</p>
                      <p className="text-ink-2">
                        <a href={`tel:${g.phone}`} className="underline">
                          {formatPhone(g.phone)}
                        </a>
                        {g.relationship && ` · ${g.relationship}`}
                      </p>
                      <p className="text-ink-2">{g.address}</p>
                    </div>
                    {g.photoUrl && (
                      <img
                        src={g.photoUrl}
                        alt={`Photo of guarantor ${g.fullName}`}
                        className="border-rule h-16 w-14 shrink-0 rounded border object-cover"
                      />
                    )}
                    {g.signatureUrl && (
                      <img
                        src={g.signatureUrl}
                        alt={`Signature of guarantor ${g.fullName}`}
                        className="border-rule h-16 w-28 shrink-0 rounded border bg-white object-contain"
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Collateral">
            {l.collateral.length === 0 ? (
              <p className="text-ink-2 text-sm">None pledged.</p>
            ) : (
              <ul className="divide-rule flex flex-col divide-y">
                {l.collateral.map((c, i) => (
                  <li
                    key={i}
                    className="flex justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0"
                  >
                    <span>
                      {c.description}
                      {c.documentRef && (
                        <span className="text-ink-2 block font-mono text-xs">{c.documentRef}</span>
                      )}
                    </span>
                    <Money value={c.estimatedValue} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {dialog === 'disburse' && <DisburseDialog loan={l} onClose={() => setDialog(null)} />}
      {dialog === 'extend' && <ExtendDialog loan={l} onClose={() => setDialog(null)} />}
      {dialog === 'penalty' && <PenaltyDialog loan={l} onClose={() => setDialog(null)} />}
    </>
  )
}

function Schedule({ rows }: { rows: LoanScheduleRow[] }) {
  const columns: Column<LoanScheduleRow>[] = [
    { id: 'n', header: '#', cell: (r) => r.number },
    { id: 'due', header: 'Due', cell: (r) => formatDate(r.dueDate) },
    {
      id: 'principal',
      header: 'Principal',
      align: 'right',
      cell: (r) => <Money value={r.principal} />,
    },
    {
      id: 'interest',
      header: 'Interest',
      align: 'right',
      cell: (r) => <Money value={r.interest} />,
    },
    {
      id: 'amount',
      header: 'Installment',
      align: 'right',
      cell: (r) => <Money value={r.amount} className="font-medium" />,
    },
    {
      id: 'paid',
      header: 'Paid',
      align: 'right',
      cell: (r) => (r.paid > 0 ? <Money value={r.paid} /> : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <Badge tone={ROW_STATUS[r.status].tone}>{ROW_STATUS[r.status].label}</Badge>,
    },
  ]
  return (
    <Panel title={`Repayment schedule (${rows.length})`} flush>
      <div className="[&>div]:rounded-none [&>div]:border-0">
        <DataTable
          caption="Repayment schedule"
          columns={columns}
          rows={rows}
          getRowId={(r) => String(r.number)}
          maxHeight="28rem"
          empty={{ title: 'No schedule' }}
        />
      </div>
    </Panel>
  )
}

function Repayments({ accountId }: { accountId: string }) {
  const params = { account: accountId, pageSize: 20, ordering: '-created_at' }
  const query = useQuery({
    queryKey: transactionKeys.list(params),
    queryFn: () => transactionsApi.list(params),
  })
  const columns: Column<Transaction>[] = [
    { id: 'date', header: 'Date', cell: (t) => formatDateTime(t.createdAt) },
    { id: 'type', header: 'Type', cell: (t) => TRANSACTION_TYPE_LABELS[t.type] },
    {
      id: 'by',
      header: 'By',
      cell: (t) => t.officerName ?? (t.channel === 'counter' ? 'Counter' : 'System'),
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (t) => <Money value={signedAmount(t)} signed />,
    },
    {
      id: 'balance',
      header: 'Owed after',
      align: 'right',
      cell: (t) => <Money value={t.balanceAfter} />,
    },
  ]
  return (
    <Panel
      title="Recent activity"
      flush
      actions={
        <Link to={`/accounts/${accountId}`} className="text-sm font-medium underline">
          Full statement
        </Link>
      }
    >
      <div className="[&>div]:rounded-none [&>div]:border-0">
        <DataTable
          caption="Loan activity"
          columns={columns}
          rows={query.data?.results}
          getRowId={(t) => t.id}
          isLoading={query.isPending}
          error={query.error}
          maxHeight="none"
          empty={{
            title: 'No recent activity',
            description: 'Older repayments are on the full statement.',
          }}
        />
      </div>
    </Panel>
  )
}

function useRefreshLoan() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      ['loans', 'accounts', 'transactions', 'approvals'].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      ),
    )
}

function DisburseDialog({ loan, onClose }: { loan: LoanDetail; onClose: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>('transfer')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const refresh = useRefreshLoan()
  const bnpl = loan.kind === 'bnpl'

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { payout } = await loansApi.disburse(loan.id, method)
      await refresh()
      toast(
        bnpl
          ? {
              title: 'Supplier paid',
              description: `Pay ${loan.supplierName} ${formatNaira(payout)} by ${method} for ${loan.itemDescription}${loan.processingFee > 0 ? `, and collect the ${formatNaira(loan.processingFee)} processing fee from ${loan.customerName}` : ''}. The first installment is now scheduled.`,
            }
          : {
              title: 'Loan paid out',
              description: `Give ${loan.customerName} ${formatNaira(payout)} by ${method}. The first installment is now scheduled.`,
            },
      )
      onClose()
    } catch (e) {
      setError(isApiError(e) ? e.message : 'The loan was not paid out. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title={bnpl ? `Pay supplier for ${loan.loanNumber}` : `Pay out ${loan.loanNumber}`}
      description={
        bnpl
          ? `Buying ${loan.itemDescription} for ${loan.customerName} from ${loan.supplierName}.`
          : `To ${loan.customerName}. Check their ID before paying.`
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {bnpl ? 'Pay supplier' : 'Pay out loan'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
          <dt className="text-ink-2">{bnpl ? 'Item price' : 'Amount borrowed'}</dt>
          <dd className="text-right">
            <Money value={loan.principal} />
          </dd>
          <dt className="text-ink-2">Processing fee</dt>
          <dd className="text-right">
            {bnpl ? '' : '− '}
            <Money value={loan.processingFee} />
          </dd>
          {bnpl && (
            <>
              <dt className="font-semibold">Company pays {loan.supplierName}</dt>
              <dd className="text-right font-semibold">
                <Money value={loan.principal} />
              </dd>
              <dt className="text-ink-2">Collect from customer at handover</dt>
              <dd className="text-right">
                <Money value={loan.processingFee} />
              </dd>
            </>
          )}
          {loan.topUpOfNumber && (
            <>
              <dt className="text-ink-2">Settles {loan.topUpOfNumber}</dt>
              <dd className="text-ink-2 text-right">worked out at payout</dd>
            </>
          )}
          {!bnpl && !loan.topUpOfId && (
            <>
              <dt className="font-semibold">Customer receives</dt>
              <dd className="text-right font-semibold">
                <Money value={kobo(loan.principal - loan.processingFee)} />
              </dd>
            </>
          )}
        </dl>
        <SegmentedControl
          label={bnpl ? 'Pay supplier by' : 'Pay out by'}
          value={method}
          onChange={setMethod}
          options={[
            { value: 'transfer', label: 'Bank transfer' },
            { value: 'cash', label: 'Cash' },
          ]}
        />
        <p className="text-ink-2 text-sm">
          Repayments start from today: the schedule dates are fixed when you pay out.
        </p>
      </div>
    </Dialog>
  )
}

function ExtendDialog({ loan, onClose }: { loan: LoanDetail; onClose: () => void }) {
  const [extra, setExtra] = useState('2')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const refresh = useRefreshLoan()
  const remaining = loan.schedule.filter((r) => r.status !== 'paid').length

  const submit = async () => {
    setBusy(true)
    setErrors({})
    try {
      const approval = await loansApi.requestExtension(loan.id, Number(extra), reason.trim())
      await refresh()
      toast(
        approval.status === 'approved'
          ? { title: 'Loan extended', description: `${extra} more installments were added.` }
          : {
              title: 'Extension requested',
              description: 'A manager must approve it in Approvals.',
            },
      )
      onClose()
    } catch (e) {
      if (isApiError(e))
        setErrors({
          ...Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v.join(' ')])),
          form: e.formErrors.join(' '),
        })
      else setErrors({ form: 'Not sent. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title="Request more time"
      description={`${remaining} ${loan.frequency} installments are left. Extra installments spread the balance thinner. No extra interest is charged; penalties on current arrears still apply.`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Send for approval
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <TextInput
          label="Extra installments"
          inputMode="numeric"
          value={extra}
          onChange={(e) => setExtra(e.target.value.replace(/\D/g, ''))}
          error={errors.extraInstallments}
        />
        <TextArea
          label="Why does the customer need more time?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={errors.reason}
        />
      </div>
    </Dialog>
  )
}

function PenaltyDialog({ loan, onClose }: { loan: LoanDetail; onClose: () => void }) {
  const toast = useToast()
  const refresh = useRefreshLoan()
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Charge the late penalty?"
      confirmLabel={`Charge ${formatNaira(loan.penaltyAccrued)}`}
      tone="danger"
      onConfirm={async () => {
        await loansApi.chargePenalty(loan.id)
        await refresh()
        toast({
          title: 'Penalty charged',
          description: `${formatNaira(loan.penaltyAccrued)} added to ${loan.loanNumber}.`,
        })
      }}
    >
      <p>
        {loan.customerName} is {loan.daysInArrears} days behind with {formatNaira(loan.arrears)}{' '}
        unpaid. The product rule adds {formatNaira(loan.penaltyAccrued)}. It is added to what they
        owe and shows on their statement.
      </p>
    </ConfirmDialog>
  )
}
