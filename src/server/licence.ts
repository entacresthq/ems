import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { cpus, hostname, platform as osPlatform } from 'node:os'
import publicKeyPem from './licence-public-key.pem?raw'

/**
 * Licences are signed by Entacrest with a private key that never leaves the
 * vendor (see scripts/licence.mjs). The app holds only the public key, so it
 * can check a code offline but can't make one.
 *
 * A code is "EMS-" + base64url(JSON details) + "." + base64url(Ed25519 signature).
 */
export interface Licence {
  v: 1
  /** Licence number, e.g. EMS-2026-0001. */
  id: string
  /** Who bought it: the business name. */
  licensee: string
  plan: string
  /** Most operational branches allowed; null for no limit. */
  branches: number | null
  /** yyyy-mm-dd */
  issued: string
  /** Last day it works, yyyy-mm-dd; null for no expiry. */
  expires: string | null
  /** Machine code it is tied to; null to work on any computer. */
  machine: string | null
}

export type LicenceCheck =
  | { status: 'valid'; licence: Licence }
  | { status: 'expired'; licence: Licence }
  | { status: 'wrong_machine'; licence: Licence }
  | { status: 'invalid'; reason: string }

const PREFIX = 'EMS-'

let entacrestKey: KeyObject | null = null
const publicKey = () => (entacrestKey ??= createPublicKey(publicKeyPem))

/** Read and check a licence code as typed or pasted (spaces and line breaks are ignored). */
export function checkLicence(
  code: string,
  machine: string,
  today: string,
  key: KeyObject = publicKey(),
): LicenceCheck {
  const compact = code.replace(/\s+/g, '')
  if (!compact.startsWith(PREFIX))
    return { status: 'invalid', reason: 'This isn’t an EMS licence code. It starts with EMS-.' }
  const [body = '', signature = ''] = compact.slice(PREFIX.length).split('.')
  let payload: Buffer
  let valid = false
  try {
    payload = Buffer.from(body, 'base64url')
    valid = verify(null, payload, key, Buffer.from(signature, 'base64url'))
  } catch {
    valid = false
    payload = Buffer.alloc(0)
  }
  if (!valid)
    return {
      status: 'invalid',
      reason: 'This licence code isn’t valid. Check you copied all of it, or contact Entacrest.',
    }
  const licence = JSON.parse(payload.toString('utf8')) as Licence
  if (licence.v !== 1)
    return {
      status: 'invalid',
      reason: 'This licence is for a newer version of EMS. Update EMS first.',
    }
  if (licence.machine && licence.machine !== machine) return { status: 'wrong_machine', licence }
  if (licence.expires && licence.expires < today) return { status: 'expired', licence }
  return { status: 'valid', licence }
}

/**
 * A code that identifies this computer, e.g. 7F3A-91C2-0B4E-D5A8. Entacrest can
 * tie a licence to it so the code works on one computer only.
 */
export function machineCode(): string {
  let id = ''
  try {
    if (osPlatform() === 'win32') {
      const out = execFileSync(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { encoding: 'utf8', windowsHide: true },
      )
      id = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out)?.[1] ?? ''
    } else if (osPlatform() === 'linux') {
      id = readFileSync('/etc/machine-id', 'utf8').trim()
    }
  } catch {
    id = ''
  }
  if (!id) id = `${hostname()}|${cpus()[0]?.model ?? ''}`
  const hex = createHash('sha256').update(`ems|${id}`).digest('hex').slice(0, 16).toUpperCase()
  return hex.match(/.{4}/g)!.join('-')
}
