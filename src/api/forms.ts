import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { isApiError } from './client'

/**
 * Put DRF field errors onto the matching form fields. Returns a message for
 * everything that could not be attached to a field (show it above the form).
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (!isApiError(error)) {
    return 'Something unexpected happened. Try again, and contact support if it keeps happening.'
  }
  const unplaced: string[] = [...error.formErrors]
  let placedAny = false
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    const message = messages.join(' ')
    if ((fields as readonly string[]).includes(field)) {
      setError(field as Path<T>, { type: 'server', message })
      placedAny = true
    } else {
      unplaced.push(message)
    }
  }
  if (unplaced.length > 0) return unplaced.join(' ')
  return placedAny ? null : error.message
}
