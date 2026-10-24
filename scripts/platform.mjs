#!/usr/bin/env node
// Manage the businesses on a multi-business EMS server (EMS_MULTI_BUSINESS=true).
//
//   npm run platform -- list
//   npm run platform -- add ayo "Ayo Thrift Society" [--licence EMS-…] [--domain ems.ayothrift.ng]
//   npm run platform -- show ayo
//   npm run platform -- licence ayo EMS-…          new or renewed licence, takes effect at once
//   npm run platform -- suspend ayo                 e.g. unpaid; data is kept
//   npm run platform -- resume ayo
//   npm run platform -- rename ayo "Ayo Thrift & Credit"
//   npm run platform -- domains ayo ems.ayothrift.ng [more…]   (none: remove them all)
//
// Needs EMS_PLATFORM_URL (the server, e.g. https://ems.example.ng) and
// EMS_PLATFORM_KEY (the server's EMS_PLATFORM_KEY).

const base = (process.env.EMS_PLATFORM_URL ?? '').replace(/\/+$/, '')
const key = process.env.EMS_PLATFORM_KEY ?? ''

function fail(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

function args(list) {
  const out = { _: [], domain: [] }
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (a === '--domain') out.domain.push(list[++i])
    else if (a.startsWith('--')) out[a.slice(2)] = list[++i]
    else out._.push(a)
  }
  return out
}

async function request(method, path = '', body) {
  if (!base || !key) fail('Set EMS_PLATFORM_URL and EMS_PLATFORM_KEY first.')
  let res
  try {
    res = await fetch(`${base}/__platform/businesses${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    fail(`Can’t reach ${base}: ${error.cause?.message ?? error.message}`)
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 404 && !path)
    fail('The server refused the key, or isn’t a multi-business server.')
  if (!res.ok) {
    const lines = Object.entries(data).map(([field, v]) => `${field}: ${[].concat(v).join(' ')}`)
    fail(lines.join('\n  ') || `The server answered ${res.status}.`)
  }
  return data
}

function show(b) {
  const lic = b.licence
  const licence =
    !b.status || b.status === 'suspended'
      ? '-'
      : !lic
        ? 'none yet'
        : `${lic.status}${lic.expires ? `, until ${lic.expires}` : ''}${lic.branches ? `, ${lic.branches} branches` : ''}`
  console.log(`
  ${b.id}  ${b.name}${b.business_name && b.business_name !== b.name ? `  (set up as "${b.business_name}")` : ''}
    Status:    ${b.status}${b.onboarded === false ? ', not set up yet' : ''}
    Addresses: ${b.addresses.map((a) => `https://${a}`).join('  ') || '(none: set EMS_BASE_DOMAIN or add a domain)'}
    Licence:   ${licence}${b.licence_error ? `\n    Licence not saved: ${b.licence_error}` : ''}`)
}

const [command, ...rest] = process.argv.slice(2)
const opts = args(rest)
const [id, ...more] = opts._

switch (command) {
  case 'list': {
    const { results } = await request('GET')
    if (!results.length)
      console.log('\n  No businesses yet. Add one with: npm run platform -- add <id> "<name>"\n')
    for (const b of results)
      console.log(
        `  ${b.id.padEnd(16)} ${b.status.padEnd(10)} ${b.loaded ? 'in use  ' : '        '} ${b.name}`,
      )
    break
  }
  case 'add': {
    if (!id || !more[0]) fail('Usage: add <id> "<business name>" [--licence EMS-…] [--domain d]')
    show(
      await request('POST', '', { id, name: more[0], domains: opts.domain, licence: opts.licence }),
    )
    console.log(`
  Send the client's MD the address${opts.licence ? '' : ' and their licence code'}. They open it,
  ${opts.licence ? 'enter' : 'enter the code, then'} the business details and their own account.
`)
    break
  }
  case 'show':
    if (!id) fail('Usage: show <id>')
    show(await request('GET', `/${id}`))
    break
  case 'licence':
  case 'license':
    if (!id || !more[0]) fail('Usage: licence <id> EMS-…')
    show(await request('PATCH', `/${id}`, { licence: more.join('') }))
    break
  case 'suspend':
  case 'resume':
    if (!id) fail(`Usage: ${command} <id>`)
    show(
      await request('PATCH', `/${id}`, { status: command === 'suspend' ? 'suspended' : 'active' }),
    )
    break
  case 'rename':
    if (!id || !more[0]) fail('Usage: rename <id> "<name>"')
    show(await request('PATCH', `/${id}`, { name: more[0] }))
    break
  case 'domains':
    if (!id) fail('Usage: domains <id> [domain …]')
    show(await request('PATCH', `/${id}`, { domains: more }))
    break
  default:
    console.log(
      'Usage: npm run platform -- list | add | show | licence | suspend | resume | rename | domains\nSee the top of scripts/platform.mjs.',
    )
}
