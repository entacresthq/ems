import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, Plus } from 'lucide-react'
import { customerKeys, customersApi } from '@/api/customers'
import { DataTable, type Column } from '@/components/data/DataTable'
import { MoneyInput } from '@/components/form/MoneyInput'
import { Checkbox, OtpInput, PasswordInput, Select, TextInput } from '@/components/form/inputs'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { ApprovalBanner } from '@/components/ui/ApprovalBanner'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { config } from '@/config'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge, StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { ApiError } from '@/api/client'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { formatDate } from '@/lib/dates'
import { formatNaira, naira, type Kobo } from '@/lib/money'
import { formatPhone } from '@/lib/phone'
import type { Customer } from '@/types'

const COLOURS = [
  {
    name: 'Ink',
    token: 'ink',
    hex: '#15201B',
    use: 'Text, field-app primary buttons, focus ring',
    fg: 'text-white',
  },
  {
    name: 'Paper',
    token: 'paper',
    hex: '#F6F4EE',
    use: 'Back-office background (field app uses white)',
    fg: 'text-ink',
  },
  {
    name: 'Ledger',
    token: 'ledger',
    hex: '#0B6B47',
    use: 'Primary action, money in, collected',
    fg: 'text-white',
  },
  {
    name: 'Ochre',
    token: 'ochre',
    hex: '#9A5300',
    use: 'Pending, arrears, awaiting approval, pending sync',
    fg: 'text-white',
  },
  {
    name: 'Brick',
    token: 'brick',
    hex: '#B3261E',
    use: 'Errors, variance, destructive, overdue',
    fg: 'text-white',
  },
  {
    name: 'Rule',
    token: 'rule',
    hex: '#D5D1C6',
    use: 'Borders, table rules, dividers',
    fg: 'text-ink',
  },
]

const SWATCH_BG: Record<string, string> = {
  ink: 'bg-ink',
  paper: 'bg-paper',
  ledger: 'bg-ledger',
  ochre: 'bg-ochre',
  brick: 'bg-brick',
  rule: 'bg-rule',
}

const TYPE_SCALE = [
  { cls: 'text-2xl font-semibold', label: '32 / semibold — page figures' },
  { cls: 'text-xl font-semibold', label: '24 / semibold — page titles' },
  { cls: 'text-lg font-semibold', label: '20 / semibold — dialog titles' },
  { cls: 'text-base', label: '16 / regular — body, inputs on mobile' },
  { cls: 'text-sm', label: '14 / regular — tables, labels, back-office body' },
  { cls: 'text-xs font-medium', label: '12 / medium — badges, table headers' },
]

const AMOUNT_SCALE = [
  { cls: 'text-amount-lg font-semibold', label: '56 — amount being collected' },
  { cls: 'text-amount font-semibold', label: '40 — totals on Today and End of day' },
  { cls: 'text-amount-sm font-semibold', label: '28 — amounts in lists' },
  { cls: 'text-field', label: '17 — field-app body' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <h2 className="border-rule border-b pb-2 text-base font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function UiKitPage() {
  const toast = useToast()
  const [amount, setAmount] = useState<Kobo | null>(naira(1_250_000))
  const [fieldAmount, setFieldAmount] = useState<Kobo | null>(naira(2_000))
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reasonOpen, setReasonOpen] = useState(false)

  return (
    <>
      <PageHeader
        title="Design system"
        description="Tokens and components used across the back office and the field app. Visible only in development and demo mode."
        actions={config.useMocks && <ResetDemoData />}
      />

      <Section title="Colour">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {COLOURS.map((c) => (
            <div
              key={c.name}
              className="border-rule bg-surface flex overflow-hidden rounded border"
            >
              <div
                className={`${SWATCH_BG[c.token]} ${c.fg} flex w-24 shrink-0 items-end p-2 font-mono text-xs`}
              >
                {c.hex}
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold">{c.name}</p>
                <p className="text-ink-2 mt-0.5 text-sm">{c.use}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-ink-2 mt-3 text-sm">
          Each colour has a tint for badge and alert backgrounds. Ink has two lighter steps for
          secondary and muted text. All text pairs meet WCAG AA.
        </p>
      </Section>

      <Section title="Type — IBM Plex Sans and IBM Plex Mono">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            {TYPE_SCALE.map((t) => (
              <div key={t.label}>
                <p className={t.cls}>Loan repayment recorded</p>
                <p className="text-ink-3 text-xs">{t.label}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            {AMOUNT_SCALE.map((t) => (
              <div key={t.label}>
                <p className={`${t.cls} tabular`}>{formatNaira(naira(125_000))}</p>
                <p className="text-ink-3 text-xs">{t.label}</p>
              </div>
            ))}
            <div>
              <p className="font-mono text-sm">0101000042 · 22123456789 · EMS26092500041</p>
              <p className="text-ink-3 text-xs">Mono — account numbers, BVN, references</p>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Approve loan</Button>
          <Button variant="secondary">Export CSV</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Reverse transaction</Button>
          <Button variant="ink">Record collection</Button>
          <Button variant="primary" loading loadingLabel="Saving…">
            Save
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="secondary" icon={<Plus className="size-4" aria-hidden />}>
            Add customer
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
        <div className="mt-3 max-w-sm">
          <Button size="xl" variant="ink">
            Record ₦2,000 thrift
          </Button>
          <p className="text-ink-3 mt-1 text-xs">Field app primary: 56px tall, full width.</p>
        </div>
      </Section>

      <Section title="Form fields">
        <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
          <TextInput label="Customer name" placeholder="e.g. Adebola Ogunleye" />
          <TextInput
            label="Phone number"
            defaultValue="0803 123"
            error="Enter a Nigerian mobile number, like 0803 123 4567 or +234 803 123 4567."
          />
          <TextInput label="Email address" optional hint="Used for statements only." />
          <Select label="Repayment frequency" defaultValue="weekly">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </Select>
          <PasswordInput label="Password" defaultValue="Demo@2026" />
          <TextInput label="Disabled" disabled defaultValue="Egbeda" />
          <MoneyInput
            label="Loan amount"
            value={amount}
            onChange={setAmount}
            hint={amount === null ? 'Enter an amount.' : `Stored as ${amount} kobo`}
          />
          <OtpInput label="Sign-in code" />
          <Checkbox label="Send SMS receipt" defaultChecked />
        </div>
        <div className="border-rule mt-6 max-w-sm rounded border bg-white p-4">
          <MoneyInput
            label="Amount collected"
            variant="amount"
            value={fieldAmount}
            onChange={setFieldAmount}
          />
        </div>
      </Section>

      <Section title="Status badges">
        <div className="flex flex-wrap gap-2">
          {[
            'active',
            'pending_approval',
            'dormant',
            'frozen',
            'closed',
            'blacklisted',
            'in_arrears',
            'pending_sync',
            'synced',
            'reversed',
          ].map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
          <Badge tone="info">Transfer</Badge>
        </div>
      </Section>

      <Section title="Alerts, approvals and confirmation">
        <div className="flex max-w-3xl flex-col gap-3">
          <Alert tone="danger" title="Cash variance of ₦4,500.00">
            Olumide Salami's cash is ₦4,500.00 less than recorded collections. Count again before
            signing off.
          </Alert>
          <Alert tone="warning">
            3 collections are waiting to sync. They'll upload when this phone is back online.
          </Alert>
          <Alert tone="success">Remittance confirmed for 6 officers.</Alert>
          <Alert tone="info">
            Holidays set in Settings are skipped when schedules are generated.
          </Alert>
          <ApprovalBanner
            state="pending"
            subject="Reversal of EMS26092500041"
            requestedBy="Ngozi Eze"
            requestedAt="2026-09-25T15:20:00+01:00"
            reason="Collection recorded twice for the same customer."
            actions={
              <>
                <Button size="sm">Reject</Button>
                <Button size="sm" variant="primary">
                  Approve reversal
                </Button>
              </>
            }
          />
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setConfirmOpen(true)}>Open confirm dialog</Button>
            <Button variant="danger" onClick={() => setReasonOpen(true)}>
              Open reversal dialog
            </Button>
            <Button
              onClick={() =>
                toast({
                  title: 'SMS receipt sent',
                  description: 'Adebola Ogunleye was sent a receipt for ₦2,000.00.',
                })
              }
            >
              Show toast
            </Button>
          </div>
        </div>
        <ConfirmDialog
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Approve this loan?"
          confirmLabel="Approve loan"
          onConfirm={() => new Promise((r) => setTimeout(r, 600))}
        >
          <p>
            ₦500,000.00 for Chioma Okafor over 12 weeks. The cashier can disburse it once you
            approve.
          </p>
        </ConfirmDialog>
        <ConfirmDialog
          open={reasonOpen}
          onClose={() => setReasonOpen(false)}
          title="Request a reversal"
          confirmLabel="Send for approval"
          tone="danger"
          reason={{ label: 'Reason for reversal', hint: 'The approver sees this. Be specific.' }}
          onConfirm={() =>
            Promise.reject(
              new ApiError(
                400,
                'This transaction is older than 7 days and cannot be reversed. Post a correcting entry instead.',
              ),
            )
          }
        >
          <p>
            EMS26092500041 · ₦2,000.00 thrift from Adebola Ogunleye. A branch manager must approve
            it.
          </p>
        </ConfirmDialog>
      </Section>

      <Section title="Loading, empty and error states">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="border-rule bg-surface rounded border">
            <LoadingState label="Loading customers…" />
          </div>
          <div className="border-rule bg-surface rounded border">
            <EmptyState
              title="No customers match these filters"
              description="Clear a filter or search for a different name, phone or account number."
              action={<Button size="sm">Clear filters</Button>}
            />
          </div>
          <div className="border-rule bg-surface rounded border">
            <ErrorState
              error={
                new ApiError(
                  0,
                  "Can't reach the server. Check your internet connection and try again.",
                )
              }
              onRetry={() => undefined}
            />
          </div>
        </div>
      </Section>

      <Section title="Data table (live from the mock API)">
        <CustomerTableDemo />
      </Section>
    </>
  )
}

function CustomerTableDemo() {
  const { branchId } = useBranchScope()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [ordering, setOrdering] = useState<string | undefined>('last_name')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const params = {
    page,
    pageSize,
    ordering,
    search: search || undefined,
    branch: branchId ?? undefined,
  }
  const query = useQuery({
    queryKey: customerKeys.list(params),
    queryFn: () => customersApi.list(params),
    placeholderData: keepPreviousData,
  })

  const columns: Column<Customer>[] = [
    {
      id: 'number',
      header: 'Customer no.',
      cell: (c) => <span className="font-mono">{c.customerNumber}</span>,
      sortKey: 'customer_number',
    },
    {
      id: 'name',
      header: 'Name',
      cell: (c) => `${c.firstName} ${c.lastName}`,
      sortKey: 'last_name',
    },
    { id: 'phone', header: 'Phone', cell: (c) => formatPhone(c.phone) },
    { id: 'area', header: 'Area', cell: (c) => c.area, sortKey: 'area' },
    { id: 'officer', header: 'Officer', cell: (c) => c.officerName, sortKey: 'officer_name' },
    { id: 'branch', header: 'Branch', cell: (c) => c.branchName, sortKey: 'branch_name' },
    { id: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
    {
      id: 'joined',
      header: 'Joined',
      cell: (c) => formatDate(c.createdAt),
      sortKey: 'created_at',
      align: 'right',
    },
  ]

  return (
    <DataTable
      caption="Customers"
      columns={columns}
      rows={query.data?.results}
      getRowId={(c) => c.id}
      isLoading={query.isPending}
      isFetching={query.isFetching}
      error={query.error}
      onRetry={() => void query.refetch()}
      empty={{
        title: 'No customers match your search',
        description: 'Check the spelling, or search by phone number or customer number instead.',
      }}
      ordering={ordering}
      onOrderingChange={(o) => {
        setOrdering(o)
        setPage(1)
      }}
      selection={{ selected, onChange: setSelected }}
      bulkActions={() => (
        <Button size="sm" icon={<Download className="size-4" aria-hidden />}>
          Export selected
        </Button>
      )}
      toolbar={
        <div className="max-w-xs">
          <TextInput
            label="Search customers"
            hideLabel
            placeholder="Search name, phone, customer no. or BVN"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
      }
      pagination={
        query.data
          ? {
              page,
              pageSize,
              count: query.data.count,
              onPageChange: setPage,
              onPageSizeChange: (s) => {
                setPageSize(s)
                setPage(1)
              },
            }
          : undefined
      }
    />
  )
}

/** Demo mode only: throw away every change and start again from the seed data. */
function ResetDemoData() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Reset demo data</Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Reset all demo data?"
        confirmLabel="Reset and reload"
        tone="danger"
        onConfirm={async () => {
          const { resetMockDb } = await import('@/mocks/db')
          await resetMockDb()
          const { fieldDb } = await import('@/features/field/offline/store')
          await (await fieldDb()).clear('outbox')
          window.location.reload()
        }}
      >
        <p>
          Customers, collections, approvals and remittances go back to the seed data. Field
          collections waiting on this browser are removed too.
        </p>
      </ConfirmDialog>
    </>
  )
}
