import { useState } from 'react'
import { useForm, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { fieldKeys } from '@/api/field'
import { customersApi } from '@/api/customers'
import { applyServerErrors } from '@/api/forms'
import { ImageUpload } from '@/components/form/ImageUpload'
import { Select, TextInput } from '@/components/form/inputs'
import { Alert } from '@/components/ui/Alert'
import { Button, ButtonLink } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/Tabs'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { useBranchAreas } from '@/features/field/useBranchAreas'
import { useThriftPlans } from '@/features/shared/lookups'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { isValidBvn } from '@/lib/bvn'
import { formatNaira } from '@/lib/money'
import { normalisePhone } from '@/lib/phone'

const schema = z.object({
  firstName: z.string().trim().min(1, 'Enter the first name.'),
  lastName: z.string().trim().min(1, 'Enter the last name.'),
  gender: z.enum(['female', 'male']),
  phone: z
    .string()
    .trim()
    .min(1, 'Enter a phone number.')
    .refine(
      (v) => normalisePhone(v) !== null,
      'Enter a Nigerian mobile number, like 0803 123 4567.',
    ),
  address: z.string().trim().min(1, 'Enter the shop or home address.'),
  area: z.string().min(1, 'Choose the area.'),
  occupation: z.string().trim().min(1, 'Enter what they sell or do.'),
  bvn: z
    .string()
    .trim()
    .refine((v) => v === '' || isValidBvn(v), 'BVN must be exactly 11 digits, or leave it empty.'),
  thriftPlanId: z.string().min(1, 'Choose the thrift plan.'),
})
type Values = z.infer<typeof schema>

/** Short registration for a new thrift saver. The branch approves it before collections start. */
export function RegisterCustomerPage() {
  useDocumentTitle('Register customer')
  const user = useCurrentUser()
  const online = useOnlineStatus()
  const areas = useBranchAreas()
  const plans = useThriftPlans('active')
  const queryClient = useQueryClient()
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState<{ name: string; number: string; photoFailed: boolean } | null>(
    null,
  )
  const {
    register,
    handleSubmit,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { gender: 'female', bvn: '', thriftPlanId: '', area: '' },
  })

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null)
    try {
      const customer = await customersApi.create({
        firstName: v.firstName,
        lastName: v.lastName,
        otherNames: '',
        gender: v.gender,
        dateOfBirth: null,
        phone: normalisePhone(v.phone) ?? v.phone,
        altPhone: null,
        email: null,
        bvn: v.bvn || null,
        address: v.address,
        area: v.area,
        occupation: v.occupation,
        branchId: user.branchId ?? '',
        officerId: user.id,
        nextOfKin: null,
        guarantors: [],
        thriftPlanId: v.thriftPlanId,
      })
      let photoFailed = false
      if (photo)
        await customersApi.uploadPhoto(customer.id, photo).catch(() => (photoFailed = true))
      await queryClient.invalidateQueries({ queryKey: fieldKeys.all })
      setDone({
        name: `${customer.firstName} ${customer.lastName}`,
        number: customer.customerNumber,
        photoFailed,
      })
    } catch (error) {
      setFormError(applyServerErrors(error, setError, Object.keys(schema.shape) as Path<Values>[]))
    }
  })

  if (done) {
    return (
      <div role="status">
        <section className="border-ledger bg-ledger-tint border-l-4 px-4 py-4">
          <p className="text-lg font-semibold">{done.name} is registered</p>
          <p className="mt-1">
            Customer number <span className="font-mono">{done.number}</span>. The branch must
            approve them before you can collect. You'll see them on your list once approved.
          </p>
          {done.photoFailed && (
            <p className="text-brick mt-2 font-medium">
              The photo didn't upload. The branch can add it later.
            </p>
          )}
        </section>
        <div className="mt-6 flex flex-col gap-3">
          <ButtonLink to="/field/today" variant="ink" size="xl">
            Back to today
          </ButtonLink>
          <Button size="xl" onClick={() => setDone(null)}>
            Register another customer
          </Button>
        </div>
      </div>
    )
  }

  const plan = plans.data?.find((p) => p.id === watch('thriftPlanId'))

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Register a thrift customer</h1>
      {!online && (
        <Alert tone="warning" title="You're offline">
          Registration needs network. Fill the form and send it when you have signal, or take the
          details on paper.
        </Alert>
      )}
      {formError && <Alert tone="danger">{formError}</Alert>}
      <TextInput
        fieldSize="field"
        label="First name"
        autoCapitalize="words"
        error={errors.firstName?.message}
        {...register('firstName')}
      />
      <TextInput
        fieldSize="field"
        label="Last name"
        autoCapitalize="words"
        error={errors.lastName?.message}
        {...register('lastName')}
      />
      <div>
        <p className="text-field mb-2 font-medium">Gender</p>
        <SegmentedControl
          size="xl"
          label="Gender"
          value={watch('gender')}
          onChange={(g) => setValue('gender', g)}
          options={[
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
          ]}
        />
      </div>
      <TextInput
        fieldSize="field"
        label="Phone number"
        type="tel"
        inputMode="tel"
        hint="SMS receipts go to this number."
        error={errors.phone?.message}
        {...register('phone')}
      />
      <Select fieldSize="field" label="Area" error={errors.area?.message} {...register('area')}>
        <option value="">Choose…</option>
        {areas.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </Select>
      <TextInput
        fieldSize="field"
        label="Shop or home address"
        error={errors.address?.message}
        {...register('address')}
      />
      <TextInput
        fieldSize="field"
        label="What they sell or do"
        placeholder="e.g. Pepper seller"
        error={errors.occupation?.message}
        {...register('occupation')}
      />
      <Select
        fieldSize="field"
        label="Thrift plan"
        error={errors.thriftPlanId?.message}
        {...register('thriftPlanId')}
      >
        <option value="">{plans.isPending ? 'Loading plans…' : 'Choose…'}</option>
        {plans.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      {plan && (
        <p className="text-ink-2 -mt-2 text-sm">
          {formatNaira(plan.contributionAmount, { trimZeroKobo: true })}{' '}
          {plan.frequency === 'daily' ? 'every working day' : 'every week'} for {plan.cycleLength}{' '}
          {plan.frequency === 'daily' ? 'days' : 'weeks'}.
        </p>
      )}
      <TextInput
        fieldSize="field"
        label="BVN"
        optional
        inputMode="numeric"
        maxLength={11}
        className="font-mono"
        error={errors.bvn?.message}
        {...register('bvn')}
      />
      <ImageUpload
        label="Customer photo"
        capture
        value={photo}
        onChange={setPhoto}
        hint="Optional. Face clearly visible."
      />
      <Button
        type="submit"
        variant="ink"
        size="xl"
        loading={isSubmitting}
        loadingLabel="Sending…"
        disabled={!online}
      >
        Send for approval
      </Button>
    </form>
  )
}
