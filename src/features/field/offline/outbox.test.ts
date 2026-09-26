import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { tokenStore } from '@/api/client'
import { toLagosIso, todayIso } from '@/lib/dates'
import { naira } from '@/lib/money'
import { db, resetMockDb } from '@/mocks/db'
import { server } from '@/mocks/node'
import { api, issueAccess } from '@/mocks/utils'
import { addToOutbox, listOutbox, syncOutbox } from './outbox'
import { fieldDb, type OutboxEntry } from './store'

function officerWithThrift() {
  const officer = db().staff.find((s) => s.email === 'officer@ems.ng')!
  const account = db().accounts.find(
    (a) => a.officerId === officer.id && a.type === 'thrift' && a.status === 'active',
  )!
  return { officer, account }
}

function entry(
  overrides: Partial<OutboxEntry> & Pick<OutboxEntry, 'userId' | 'accountId'>,
): OutboxEntry {
  return {
    key: crypto.randomUUID(),
    day: todayIso(),
    customerId: 'c',
    customerName: 'Test Customer',
    accountNumber: '0000000000',
    kind: 'thrift',
    productName: 'Daily',
    amount: naira(1000),
    paymentMethod: 'cash',
    collectedAt: toLagosIso(),
    location: { lat: 6.59, lng: 3.29, accuracyM: 12 },
    status: 'pending',
    attempts: 0,
    error: null,
    syncedAt: null,
    reference: null,
    smsStatus: null,
    phoneHint: null,
    ...overrides,
  }
}

describe('field outbox', () => {
  beforeEach(async () => {
    await resetMockDb()
    await (await fieldDb()).clear('outbox')
    const { officer } = officerWithThrift()
    tokenStore.set(issueAccess(officer.id))
  })

  it('syncs a collection and records the server reference', async () => {
    const { officer, account } = officerWithThrift()
    const before = account.balance
    await addToOutbox(entry({ userId: officer.id, accountId: account.id }))

    const result = await syncOutbox(officer.id)

    expect(result).toMatchObject({ synced: 1, failed: 0, interrupted: false })
    const [saved] = await listOutbox(officer.id)
    expect(saved?.status).toBe('synced')
    expect(saved?.reference).toMatch(/^EMS\d{11}$/)
    expect(saved?.smsStatus).toBe('sent')
    expect(account.balance).toBe(before + naira(1000))
  })

  it('never records the same collection twice, even if it is sent again', async () => {
    const { officer, account } = officerWithThrift()
    const e = entry({ userId: officer.id, accountId: account.id })
    await addToOutbox(e)
    await syncOutbox(officer.id)
    // The phone lost the response and sends the same entry again.
    await addToOutbox({ ...e, status: 'pending', reference: null })
    await syncOutbox(officer.id)

    const posted = db().transactions.filter((t) => t.idempotencyKey === e.key)
    expect(posted).toHaveLength(1)
  })

  it('keeps collections pending while the network is down', async () => {
    const { officer, account } = officerWithThrift()
    server.use(http.post(api('/collections/'), () => HttpResponse.error()))
    await addToOutbox(entry({ userId: officer.id, accountId: account.id }))

    const result = await syncOutbox(officer.id)

    expect(result.interrupted).toBe(true)
    expect((await listOutbox(officer.id))[0]?.status).toBe('pending')
  })

  it('marks a collection failed, with the reason, when the office rejects it', async () => {
    const { officer, account } = officerWithThrift()
    account.status = 'frozen'
    await addToOutbox(entry({ userId: officer.id, accountId: account.id }))

    const result = await syncOutbox(officer.id)

    expect(result.failed).toBe(1)
    const [saved] = await listOutbox(officer.id)
    expect(saved?.status).toBe('failed')
    expect(saved?.error).toMatch(/frozen/)
  })
})
