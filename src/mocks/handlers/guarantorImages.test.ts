// @vitest-environment node
// Uploads are parsed by the server's own FormData, which a browser-like test
// environment replaces. Run these where the EMS server runs: plain Node.
import { getResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { keysToCamel, keysToSnake } from '@/lib/case'
import type { Customer } from '@/types'
import { db, resetMockDb } from '../db'
import { api, issueAccess } from '../utils'
import { handlers } from '.'

const PNG = new Uint8Array([137, 80, 78, 71])

async function call(
  method: string,
  path: string,
  token: string,
  body?: BodyInit,
  contentType = 'application/json',
) {
  const res = await getResponse(
    handlers,
    new Request(api(path), {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body,
    }),
  )
  if (!res) throw new Error(`No handler for ${method} ${path}`)
  return {
    status: res.status,
    body: keysToCamel(await res.json()) as Customer & Record<string, unknown>,
  }
}

/** Upload an image the way the app does: multipart form data with a "file" field. */
function upload(
  customerId: string,
  guarantorId: string,
  kind: 'photo' | 'signature',
  token: string,
  file = new Blob([PNG], { type: 'image/png' }),
) {
  const form = new FormData()
  form.append('file', file, 'upload')
  return getResponse(
    handlers,
    new Request(api(`/customers/${customerId}/guarantors/${guarantorId}/${kind}/`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }),
  ).then(async (res) => ({
    status: res!.status,
    body: keysToCamel(await res!.json()) as Customer & Record<string, unknown>,
  }))
}

function signedInAs(email: string) {
  const staff = db().staff.find((s) => s.email === email)!
  return { staff, token: issueAccess(staff.id) }
}

describe('guarantor photo and signature', () => {
  beforeEach(async () => {
    await resetMockDb()
  })

  it('gives every guarantor an id and no images to begin with', () => {
    const withGuarantor = db().customers.find((c) => c.guarantors.length > 0)!
    for (const g of withGuarantor.guarantors) {
      expect(g.id).toBeTruthy()
      expect(g.photoUrl).toBe(null)
      expect(g.signatureUrl).toBe(null)
    }
  })

  it('stores the photo and signature against the right guarantor', async () => {
    const { staff, token } = signedInAs('manager@ems.ng')
    const customer = db().customers.find(
      (c) => c.branchId === staff.branchId && c.guarantors.length > 1,
    )
    if (!customer) return
    const [first, second] = customer.guarantors
    const saved = (await upload(customer.id, second!.id, 'photo', token)).body
    expect(saved.guarantors.find((g) => g.id === second!.id)!.photoUrl).toMatch(
      /^data:image\/png;base64,/,
    )
    expect(saved.guarantors.find((g) => g.id === first!.id)!.photoUrl).toBe(null)
    const again = (await upload(customer.id, first!.id, 'signature', token)).body
    expect(again.guarantors.find((g) => g.id === first!.id)!.signatureUrl).toMatch(
      /^data:image\/png/,
    )
  })

  it('keeps the images when the guarantor’s other details are edited', async () => {
    const { staff, token } = signedInAs('manager@ems.ng')
    const customer = db().customers.find(
      (c) => c.branchId === staff.branchId && c.guarantors.length > 0,
    )!
    const g = customer.guarantors[0]!
    expect((await upload(customer.id, g.id, 'photo', token)).status).toBe(200)
    const updated = await call(
      'PATCH',
      `/customers/${customer.id}/`,
      token,
      JSON.stringify(
        keysToSnake({
          guarantors: customer.guarantors.map((x) => ({
            id: x.id,
            fullName: x.id === g.id ? 'Changed Name' : x.fullName,
            phone: x.phone,
            address: x.address,
            relationship: x.relationship,
            occupation: x.occupation,
            bvn: x.bvn,
          })),
        }),
      ),
    )
    const after = updated.body.guarantors.find((x) => x.id === g.id)!
    expect(after.fullName).toBe('Changed Name')
    expect(after.photoUrl).toMatch(/^data:image\/png/)
  })

  it('rejects a file that is not an image, and an unknown guarantor', async () => {
    const { staff, token } = signedInAs('manager@ems.ng')
    const customer = db().customers.find(
      (c) => c.branchId === staff.branchId && c.guarantors.length > 0,
    )!
    const bad = await upload(
      customer.id,
      customer.guarantors[0]!.id,
      'photo',
      token,
      new Blob(['hello'], { type: 'text/plain' }),
    )
    expect(bad.status).toBe(400)
    expect(bad.body.file).toBeDefined()
    expect((await upload(customer.id, 'no-such-guarantor', 'photo', token)).status).toBe(404)
  })
})
