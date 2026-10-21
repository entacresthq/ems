import { openDB, type IDBPDatabase } from 'idb'
import { todayIso } from '@/lib/dates'
import { generateDb, type MockDb, type StaffRecord } from './seed/generate'

/**
 * Mock database. Generated from a fixed seed, then saved to IndexedDB after
 * every change so that demo work survives a reload and is shared between tabs
 * (e.g. an officer in one tab and the accountant in another). A new day starts
 * from fresh seed data so "today" always has collections to work with.
 */

const SCHEMA_VERSION = 9
const DB_NAME = 'ems-mock'
const STORE = 'state'
const CHANNEL = 'ems-mock-changes'

interface Snapshot {
  schema: number
  day: string
  data: MockDb
}

let instance: MockDb | null = null
/** Set by the desktop server: data lives in SQLite and every change is written at once. */
let externalSave: ((data: MockDb) => void) | null = null
let idb: Promise<IDBPDatabase> | null = null
let channel: BroadcastChannel | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

const hasIndexedDb = () => typeof indexedDB !== 'undefined'

function database() {
  idb ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(STORE)
    },
  })
  return idb
}

async function load(): Promise<MockDb | null> {
  const snapshot = (await (await database()).get(STORE, 'snapshot')) as Snapshot | undefined
  return snapshot && snapshot.schema === SCHEMA_VERSION && snapshot.day === todayIso()
    ? snapshot.data
    : null
}

/** Call once before the mock worker starts. */
export async function initMockDb(): Promise<void> {
  if (!hasIndexedDb()) {
    db()
    return
  }
  try {
    instance = (await load()) ?? generateDb()
    await save()
  } catch {
    instance ??= generateDb()
  }
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = async () => {
      const fresh = await load().catch(() => null)
      if (fresh) instance = fresh
    }
  }
}

export function db(): MockDb {
  instance ??= generateDb()
  return instance
}

async function save() {
  if (!instance || !hasIndexedDb()) return
  const snapshot: Snapshot = { schema: SCHEMA_VERSION, day: todayIso(), data: instance }
  await (await database()).put(STORE, snapshot, 'snapshot')
  channel?.postMessage('changed')
}

/**
 * Serve this data instead of the seed, and save it with `save` after every change.
 * Used by the desktop app's server, which keeps the data in SQLite.
 */
export function attachStore(data: MockDb, save: (data: MockDb) => void) {
  instance = data
  externalSave = save
}

/** Persist after a change. Browser writes are batched; the desktop server writes at once. */
export function commit() {
  if (externalSave) {
    if (instance) externalSave(instance)
    return
  }
  if (!hasIndexedDb()) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void save().catch(() => undefined)
  }, 150)
}

export function updateStaff(staff: StaffRecord, changes: Partial<StaffRecord>) {
  Object.assign(staff, changes)
  commit()
}

/** Start again from the seed data (also used by tests). */
export async function resetMockDb() {
  instance = null
  if (!hasIndexedDb()) return
  try {
    await (await database()).delete(STORE, 'snapshot')
    channel?.postMessage('changed')
  } catch {
    // ignore
  }
}
