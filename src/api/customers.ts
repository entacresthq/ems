import type { Customer, CustomerInput, CustomerListParams, Id, Paginated } from '@/types'
import { api } from './client'

export const customerKeys = {
  all: ['customers'] as const,
  list: (params: CustomerListParams = {}) => [...customerKeys.all, 'list', params] as const,
  detail: (id: Id) => [...customerKeys.all, 'detail', id] as const,
}

function upload(path: string, file: Blob) {
  const form = new FormData()
  form.append('file', file, 'upload.jpg')
  return api.post<Customer>(path, form)
}

export const customersApi = {
  list: (params: CustomerListParams = {}) =>
    api.get<Paginated<Customer>>('/customers/', { query: { ...params } }),
  get: (id: Id) => api.get<Customer>(`/customers/${id}/`),
  create: (body: CustomerInput) => api.post<Customer>('/customers/', body),
  update: (id: Id, body: Partial<CustomerInput>) => api.patch<Customer>(`/customers/${id}/`, body),
  uploadPhoto: (id: Id, file: Blob) => upload(`/customers/${id}/photo/`, file),
  uploadSignature: (id: Id, file: Blob) => upload(`/customers/${id}/signature/`, file),
  uploadGuarantorPhoto: (id: Id, guarantorId: Id, file: Blob) =>
    upload(`/customers/${id}/guarantors/${guarantorId}/photo/`, file),
  uploadGuarantorSignature: (id: Id, guarantorId: Id, file: Blob) =>
    upload(`/customers/${id}/guarantors/${guarantorId}/signature/`, file),
  reassign: (id: Id, officerId: Id) =>
    api.post<Customer>(`/customers/${id}/reassign/`, { officerId }),
}
