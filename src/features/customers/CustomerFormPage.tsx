import { useEffect, useState, type ReactNode } from 'react'
import { useFieldArray, useForm, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { applyServerErrors } from '@/api/forms'
import { customerKeys, customersApi } from '@/api/customers'
import { ImageUpload } from '@/components/form/ImageUpload'
import { Select, TextInput } from '@/components/form/inputs'
import { ErrorState, LoadingState } from '@/components/states'
import { Alert } from '@/components/ui/Alert'
import { Button, ButtonLink } from '@/components/ui/Button'
import { BackLink } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { useBranchScope } from '@/features/organisation/BranchScope'
import { useOfficers } from '@/features/shared/lookups'
import type { Customer } from '@/types'
import {
  CUSTOMER_FIELDS,
  customerSchema,
  emptyGuarantor,
  toFormValues,
  toInput,
  type CustomerFormValues,
} from './customerSchema'

export function CustomerFormPage() {
  const { id } = useParams()
  const query = useQuery({
    queryKey: customerKeys.detail(id ?? ''),
    queryFn: () => customersApi.get(id!),
    enabled: Boolean(id),
  })
  if (id && query.isPending) return <LoadingState label="Loading customer…" />
  if (id && query.isError)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  return <CustomerForm customer={query.data ?? null} />
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="border-rule grid gap-4 border-b py-6 first:pt-0 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-ink-2 mt-1 text-sm">{description}</p>}
      </div>
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function CustomerForm({ customer }: { customer: Customer | null }) {
  const editing = customer !== null
  const user = useCurrentUser()
  const scope = useBranchScope()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [signature, setSignature] = useState<Blob | null>(null)
  // Guarantor images, keyed by the form row so they stay with the right person if a row is removed.
  const [guarantorImages, setGuarantorImages] = useState<
    Record<string, { photo?: Blob | null; signature?: Blob | null }>
  >({})
  const setGuarantorImage = (rowKey: string, kind: 'photo' | 'signature', blob: Blob | null) =>
    setGuarantorImages((all) => ({ ...all, [rowKey]: { ...all[rowKey], [kind]: blob } }))
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: toFormValues(customer, {
      branchId: scope.branchId ?? user.branchId ?? '',
      officerId: '',
    }),
  })
  const guarantors = useFieldArray({ control, name: 'guarantors', keyName: 'rowKey' })
  const branchId = watch('branchId')
  const officers = useOfficers(branchId || null, Boolean(branchId))
  const areas = scope.branches.find((b) => b.id === branchId)?.areas ?? []

  // Changing branch clears choices that belonged to the old branch.
  useEffect(() => {
    if (editing) return
    const officerId = watch('officerId')
    if (officerId && officers.data && !officers.data.some((o) => o.id === officerId))
      setValue('officerId', '')
  }, [officers.data, editing, setValue, watch])

  const save = useMutation({
    mutationFn: async (values: CustomerFormValues) => {
      const input = toInput(values)
      const saved = editing
        ? await customersApi.update(customer.id, input)
        : await customersApi.create(input)
      // Uploads happen after the record exists. A failed upload doesn't lose the customer.
      const failed: string[] = []
      if (photo) await customersApi.uploadPhoto(saved.id, photo).catch(() => failed.push('photo'))
      if (signature)
        await customersApi
          .uploadSignature(saved.id, signature)
          .catch(() => failed.push('signature'))
      // The saved guarantors come back in the order they were sent.
      for (const [i, row] of guarantors.fields.entries()) {
        const images = guarantorImages[row.rowKey]
        const savedGuarantor = saved.guarantors[i]
        if (!images || !savedGuarantor) continue
        const who = values.guarantors[i]?.fullName || `guarantor ${i + 1}`
        if (images.photo)
          await customersApi
            .uploadGuarantorPhoto(saved.id, savedGuarantor.id, images.photo)
            .catch(() => failed.push(`photo of ${who}`))
        if (images.signature)
          await customersApi
            .uploadGuarantorSignature(saved.id, savedGuarantor.id, images.signature)
            .catch(() => failed.push(`signature of ${who}`))
      }
      return { saved, failed }
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const { saved, failed } = await save.mutateAsync(values)
      await queryClient.invalidateQueries({ queryKey: customerKeys.all })
      toast({
        tone: failed.length ? 'danger' : 'success',
        title: editing ? 'Customer updated' : `${saved.firstName} ${saved.lastName} added`,
        description: failed.length
          ? `Saved, but the ${failed.join(' and ')} did not upload. Open the customer and try again.`
          : editing
            ? undefined
            : `Customer number ${saved.customerNumber}. Open a savings, target savings or thrift account next.`,
      })
      navigate(`/customers/${saved.id}`)
    } catch (error) {
      setFormError(
        applyServerErrors(
          error,
          setError,
          CUSTOMER_FIELDS as unknown as Path<CustomerFormValues>[],
        ),
      )
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  })

  const err = (path: string) => {
    const parts = path.split('.')
    let node: unknown = errors
    for (const p of parts) node = (node as Record<string, unknown> | undefined)?.[p]
    return (node as { message?: string } | undefined)?.message
  }

  return (
    <>
      <BackLink to={editing ? `/customers/${customer.id}` : '/customers'}>
        {editing ? 'Back to customer' : 'Customers'}
      </BackLink>
      <PageHeader
        title={editing ? `Edit ${customer.firstName} ${customer.lastName}` : 'Add a customer'}
        description={
          editing
            ? `Customer ${customer.customerNumber}`
            : 'Required fields have no "(optional)" label.'
        }
      />
      <form onSubmit={onSubmit} noValidate>
        {formError && (
          <Alert tone="danger" className="mb-6" title="The customer was not saved">
            {formError}
          </Alert>
        )}
        {Object.keys(errors).length > 0 && !formError && (
          <Alert tone="danger" className="mb-6">
            Some details need fixing. Check the fields marked in red.
          </Alert>
        )}

        <Section title="Personal details">
          <TextInput
            label="First name"
            autoComplete="off"
            error={err('firstName')}
            {...register('firstName')}
          />
          <TextInput
            label="Last name"
            autoComplete="off"
            error={err('lastName')}
            {...register('lastName')}
          />
          <TextInput
            label="Other names"
            optional
            error={err('otherNames')}
            {...register('otherNames')}
          />
          <Select label="Gender" error={err('gender')} {...register('gender')}>
            <option value="">Choose…</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
          <TextInput
            label="Date of birth"
            type="date"
            optional
            error={err('dateOfBirth')}
            {...register('dateOfBirth')}
          />
          <TextInput
            label="Occupation"
            placeholder="e.g. Foodstuff trader"
            error={err('occupation')}
            {...register('occupation')}
          />
        </Section>

        <Section
          title="Contact and identity"
          description="The phone number receives SMS receipts for every collection."
        >
          <TextInput
            label="Phone number"
            type="tel"
            inputMode="tel"
            placeholder="0803 123 4567"
            error={err('phone')}
            {...register('phone')}
          />
          <TextInput
            label="Other phone number"
            optional
            type="tel"
            inputMode="tel"
            error={err('altPhone')}
            {...register('altPhone')}
          />
          <TextInput
            label="Email address"
            optional
            type="email"
            error={err('email')}
            {...register('email')}
          />
          <TextInput
            label="BVN"
            optional
            inputMode="numeric"
            maxLength={11}
            hint="11 digits. Needed before the customer can take a loan."
            className="font-mono"
            error={err('bvn')}
            {...register('bvn')}
          />
        </Section>

        <Section
          title="Address and assignment"
          description="The area decides where the customer appears on the officer's daily route."
        >
          <TextInput
            label="Home or shop address"
            containerClassName="sm:col-span-2"
            error={err('address')}
            {...register('address')}
          />
          {scope.canSwitch && !editing ? (
            <Select
              label="Branch"
              error={err('branchId')}
              {...register('branchId', { onChange: () => setValue('area', '') })}
            >
              <option value="">Choose…</option>
              {scope.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          ) : (
            <TextInput
              label="Branch"
              value={
                scope.branches.find((b) => b.id === branchId)?.name ??
                customer?.branchName ??
                user.branchName ??
                ''
              }
              disabled
              readOnly
            />
          )}
          <Select
            label="Collection area"
            error={err('area')}
            disabled={!branchId}
            {...register('area')}
          >
            <option value="">{branchId ? 'Choose…' : 'Choose a branch first'}</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
          {editing ? (
            <TextInput
              label="Account officer"
              value={customer.officerName}
              disabled
              readOnly
              hint="Use “Reassign officer” on the customer page to change this."
            />
          ) : (
            <Select
              label="Account officer"
              error={err('officerId')}
              disabled={!branchId || officers.isPending}
              {...register('officerId')}
            >
              <option value="">{officers.isPending ? 'Loading officers…' : 'Choose…'}</option>
              {officers.data
                ?.filter((o) => o.status === 'active')
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </Select>
          )}
        </Section>

        <Section title="Next of kin" description="Optional, but needed before a loan.">
          <TextInput
            label="Full name"
            optional
            error={err('nextOfKin.fullName')}
            {...register('nextOfKin.fullName')}
          />
          <TextInput
            label="Relationship"
            optional
            placeholder="e.g. Spouse"
            error={err('nextOfKin.relationship')}
            {...register('nextOfKin.relationship')}
          />
          <TextInput
            label="Phone number"
            optional
            type="tel"
            inputMode="tel"
            error={err('nextOfKin.phone')}
            {...register('nextOfKin.phone')}
          />
          <TextInput
            label="Address"
            optional
            error={err('nextOfKin.address')}
            {...register('nextOfKin.address')}
          />
        </Section>

        <Section
          title="Guarantors"
          description="People who agree to repay if the customer can't. Up to three."
        >
          <div className="flex flex-col gap-4 sm:col-span-2">
            {guarantors.fields.length === 0 && (
              <p className="text-ink-2 text-sm">No guarantors yet.</p>
            )}
            {guarantors.fields.map((field, i) => (
              <fieldset
                key={field.rowKey}
                className="border-rule bg-surface grid gap-4 rounded border p-4 sm:grid-cols-2"
              >
                <legend className="px-1 text-sm font-semibold">Guarantor {i + 1}</legend>
                <TextInput
                  label="Full name"
                  error={err(`guarantors.${i}.fullName`)}
                  {...register(`guarantors.${i}.fullName`)}
                />
                <TextInput
                  label="Phone number"
                  type="tel"
                  inputMode="tel"
                  error={err(`guarantors.${i}.phone`)}
                  {...register(`guarantors.${i}.phone`)}
                />
                <TextInput
                  label="Address"
                  containerClassName="sm:col-span-2"
                  error={err(`guarantors.${i}.address`)}
                  {...register(`guarantors.${i}.address`)}
                />
                <TextInput
                  label="Relationship to customer"
                  optional
                  {...register(`guarantors.${i}.relationship`)}
                />
                <TextInput
                  label="Occupation"
                  optional
                  {...register(`guarantors.${i}.occupation`)}
                />
                <TextInput
                  label="BVN"
                  optional
                  inputMode="numeric"
                  maxLength={11}
                  className="font-mono"
                  error={err(`guarantors.${i}.bvn`)}
                  {...register(`guarantors.${i}.bvn`)}
                />
                <ImageUpload
                  label="Guarantor photo"
                  hint="Face clearly visible."
                  value={guarantorImages[field.rowKey]?.photo ?? null}
                  onChange={(b) => setGuarantorImage(field.rowKey, 'photo', b)}
                  currentUrl={customer?.guarantors.find((g) => g.id === field.id)?.photoUrl}
                />
                <ImageUpload
                  label="Guarantor signature or thumbprint"
                  shape="wide"
                  value={guarantorImages[field.rowKey]?.signature ?? null}
                  onChange={(b) => setGuarantorImage(field.rowKey, 'signature', b)}
                  currentUrl={customer?.guarantors.find((g) => g.id === field.id)?.signatureUrl}
                />
                <div className="flex items-end justify-end sm:col-span-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-brick"
                    icon={<Trash2 className="size-4" aria-hidden />}
                    onClick={() => guarantors.remove(i)}
                  >
                    Remove guarantor {i + 1}
                  </Button>
                </div>
              </fieldset>
            ))}
            {guarantors.fields.length < 3 && (
              <Button
                className="self-start"
                icon={<Plus className="size-4" aria-hidden />}
                onClick={() => guarantors.append(emptyGuarantor)}
              >
                Add guarantor
              </Button>
            )}
          </div>
        </Section>

        <Section
          title="Photo and signature"
          description="Photos are shrunk on this device before upload."
        >
          <ImageUpload
            label="Passport photo"
            value={photo}
            onChange={setPhoto}
            currentUrl={customer?.photoUrl}
            hint="Face clearly visible, plain background."
          />
          <ImageUpload
            label="Signature or thumbprint"
            shape="wide"
            value={signature}
            onChange={setSignature}
            currentUrl={customer?.signatureUrl}
          />
        </Section>

        <div className="border-rule bg-paper/95 sticky bottom-0 -mx-4 mt-6 flex justify-end gap-2 border-t px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <ButtonLink to={editing ? `/customers/${customer.id}` : '/customers'}>Cancel</ButtonLink>
          <Button
            type="submit"
            variant="primary"
            loading={isSubmitting}
            loadingLabel="Saving…"
            disabled={
              editing &&
              !isDirty &&
              !photo &&
              !signature &&
              !Object.values(guarantorImages).some((i) => i.photo || i.signature)
            }
          >
            {editing ? 'Save changes' : 'Add customer'}
          </Button>
        </div>
      </form>
    </>
  )
}
