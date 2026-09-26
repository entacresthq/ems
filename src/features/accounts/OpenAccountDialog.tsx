import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { accountKeys, accountsApi } from '@/api/accounts'
import { isApiError } from '@/api/client'
import { Select } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { SegmentedControl } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { useThriftPlans } from '@/features/shared/lookups'
import { formatNaira } from '@/lib/money'
import type { Customer } from '@/types'

export function OpenAccountDialog({
  open,
  onClose,
  customer,
}: {
  open: boolean
  onClose: () => void
  customer: Customer
}) {
  const [type, setType] = useState<'savings' | 'thrift'>('thrift')
  const [planId, setPlanId] = useState('')
  const [errors, setErrors] = useState<{ form?: string; plan?: string }>({})
  const [busy, setBusy] = useState(false)
  const plans = useThriftPlans('active')
  const queryClient = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const plan = plans.data?.find((p) => p.id === planId)

  const submit = async () => {
    if (type === 'thrift' && !planId) {
      setErrors({ plan: 'Choose the thrift plan the customer is joining.' })
      return
    }
    setBusy(true)
    setErrors({})
    try {
      const account = await accountsApi.open({
        customerId: customer.id,
        type,
        thriftPlanId: type === 'thrift' ? planId : null,
      })
      await queryClient.invalidateQueries({ queryKey: accountKeys.all })
      toast({
        title: 'Account opened',
        description: `${account.accountNumber} for ${customer.firstName} ${customer.lastName}.`,
      })
      onClose()
      navigate(`/accounts/${account.id}`)
    } catch (e) {
      if (isApiError(e)) {
        setErrors({
          plan: e.fieldErrors.thriftPlanId?.join(' '),
          form: [...e.formErrors, ...(e.fieldErrors.type ?? [])].join(' ') || undefined,
        })
      } else setErrors({ form: 'The account could not be opened. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title="Open an account"
      description={`For ${customer.firstName} ${customer.lastName}. The account number is created automatically.`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Open {type} account
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <SegmentedControl
          label="Account type"
          value={type}
          onChange={setType}
          options={[
            { value: 'thrift', label: 'Thrift' },
            { value: 'savings', label: 'Savings' },
          ]}
        />
        {type === 'thrift' ? (
          <>
            <Select
              label="Thrift plan"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              error={errors.plan}
            >
              <option value="">{plans.isPending ? 'Loading plans…' : 'Choose…'}</option>
              {plans.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.cycleLength} {p.frequency === 'daily' ? 'days' : 'weeks'}
                </option>
              ))}
            </Select>
            {plan && (
              <p className="text-ink-2 text-sm">
                The officer collects {formatNaira(plan.contributionAmount)}{' '}
                {plan.frequency === 'daily' ? 'every working day' : 'once a week'}.{' '}
                {plan.commission.type === 'first_contribution'
                  ? 'The first contribution of each cycle is the collection fee.'
                  : plan.commission.type === 'percentage'
                    ? `A ${plan.commission.percent}% fee is taken from each contribution.`
                    : `A flat fee of ${formatNaira(plan.commission.amount)} applies per cycle.`}
              </p>
            )}
          </>
        ) : (
          <p className="text-ink-2 text-sm">
            Savings take deposits and withdrawals at the counter. One savings account per customer.
          </p>
        )}
      </div>
    </Dialog>
  )
}
