#!/usr/bin/env node
// Entacrest licence tool for EMS desktop. Run from the repo:
//
//   npm run licence -- keygen                      one-off: make the signing key pair
//   npm run licence -- issue --licensee "Ayo Thrift Society" --months 12 --branches 5
//   npm run licence -- issue --licensee "..." --machine 7F3A-91C2-0B4E-D5A8
//   npm run licence -- verify EMS-....
//
// The private key signs licences. Keep it off GitHub and back it up: without it
// you can't issue codes that existing installs accept. It lives in
// ~/.entacrest/ems-licence/ unless EMS_LICENCE_DIR says otherwise.
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_KEY = join(repo, 'src', 'server', 'licence-public-key.pem')
const VAULT = process.env.EMS_LICENCE_DIR ?? join(homedir(), '.entacrest', 'ems-licence')
const PRIVATE_KEY = join(VAULT, 'private-key.pem')
const LEDGER = join(VAULT, 'issued.csv')

function args(list) {
  const out = { _: [] }
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (a.startsWith('--')) {
      const next = list[i + 1]
      if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true
      else out[a.slice(2)] = list[++i]
    } else out._.push(a)
  }
  return out
}

function fail(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

function keygen(opts) {
  if (existsSync(PRIVATE_KEY) && !opts.force)
    fail(
      `A private key already exists at ${PRIVATE_KEY}.\n  Making a new one stops every licence you have issued from working.\n  Run again with --force if that is what you want.`,
    )
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  mkdirSync(VAULT, { recursive: true })
  writeFileSync(PRIVATE_KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  writeFileSync(PUBLIC_KEY, publicKey.export({ type: 'spki', format: 'pem' }))
  console.log(`
  Private key (keep secret, back it up): ${PRIVATE_KEY}
  Public key (built into the app):       ${PUBLIC_KEY}

  Rebuild the desktop app so it trusts the new key: npm run desktop:package
`)
}

function nextId() {
  const year = new Date().getFullYear()
  const count = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8').trim().split('\n').length - 1 : 0
  return `EMS-${year}-${String(count + 1).padStart(4, '0')}`
}

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

function issue(opts) {
  if (!existsSync(PRIVATE_KEY)) fail('No private key yet. Run: npm run licence -- keygen')
  if (!opts.licensee || opts.licensee === true)
    fail('Give the business name: --licensee "Ayo Thrift Society"')
  const today = new Date()
  let expires = null
  if (opts.expires) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.expires)) fail('--expires must look like 2027-09-30')
    expires = opts.expires
  } else if (opts.months) {
    const end = new Date(today)
    end.setMonth(end.getMonth() + Number(opts.months))
    expires = isoDate(end)
  }
  const branches = opts.branches ? Number(opts.branches) : null
  if (branches !== null && !(branches >= 1)) fail('--branches must be 1 or more')
  const licence = {
    v: 1,
    id: typeof opts.id === 'string' ? opts.id : nextId(),
    licensee: opts.licensee,
    plan: typeof opts.plan === 'string' ? opts.plan : 'standard',
    branches,
    issued: isoDate(today),
    expires,
    machine: typeof opts.machine === 'string' ? opts.machine.toUpperCase() : null,
  }
  const payload = Buffer.from(JSON.stringify(licence))
  const signature = sign(null, payload, createPrivateKey(readFileSync(PRIVATE_KEY)))
  const code = `EMS-${payload.toString('base64url')}.${signature.toString('base64url')}`
  if (!existsSync(LEDGER))
    writeFileSync(LEDGER, 'id,licensee,plan,branches,issued,expires,machine\n')
  const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  appendFileSync(
    LEDGER,
    [
      licence.id,
      licence.licensee,
      licence.plan,
      licence.branches,
      licence.issued,
      licence.expires,
      licence.machine,
    ]
      .map(csv)
      .join(',') + '\n',
  )
  console.log(`
  Licence ${licence.id} for ${licence.licensee}
  Plan ${licence.plan} · ${branches ?? 'unlimited'} branches · ${expires ? `expires ${expires}` : 'no expiry'}${licence.machine ? ` · this computer only: ${licence.machine}` : ''}

${code}
`)
}

function check(opts) {
  const code = String(opts._[1] ?? '').replace(/\s+/g, '')
  const [body = '', sig = ''] = code.replace(/^EMS-/, '').split('.')
  const payload = Buffer.from(body, 'base64url')
  const ok = verify(
    null,
    payload,
    createPublicKey(readFileSync(PUBLIC_KEY)),
    Buffer.from(sig, 'base64url'),
  )
  if (!ok) fail('Not valid for this build of EMS.')
  console.log(JSON.parse(payload.toString('utf8')))
}

const opts = args(process.argv.slice(2))
const command = opts._[0]
if (command === 'keygen') keygen(opts)
else if (command === 'issue') issue(opts)
else if (command === 'verify') check(opts)
else
  console.log(`
  EMS licence tool
    npm run licence -- keygen [--force]
    npm run licence -- issue --licensee "Name" [--months 12 | --expires 2027-09-30] [--branches 5] [--plan standard] [--machine XXXX-XXXX-XXXX-XXXX]
    npm run licence -- verify <code>
`)
