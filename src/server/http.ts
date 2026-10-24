import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import type { SmsMessage } from './store'
import outboxPage from './sms-outbox.html?raw'

/**
 * Serves the web app and the EMS API from one address, for the desktop app and
 * for web deployments alike.
 */

/** What answers the API: one business's EmsServer, or a hub holding several. */
export interface ApiTarget {
  handle(request: Request): Promise<Response>
  /** The outbox of the business at the request's address. */
  listSms(limit: number, request: Request): Promise<SmsMessage[]>
  /** The operator API at /__platform/ (hub only). */
  admin?(request: Request): Promise<Response>
}

export interface HttpOptions {
  ems: ApiTarget
  /** The built web app (index.html and assets/). */
  webRoot: string
  /**
   * Who may open the SMS outbox at /__sms: anyone who can reach the server, only
   * this computer (the desktop app, even when shared on the office network, since
   * the outbox shows sign-in codes), holders of a key (web, /__sms?key=…), or nobody.
   */
  outbox:
    { access: 'open' } | { access: 'local' } | { access: 'key'; key: string } | { access: 'off' }
  /** Behind a proxy that terminates HTTPS (Render, Fly, nginx): trust X-Forwarded-Proto. */
  trustProxy: boolean
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/** Photos and ID documents travel inside JSON, so allow a generous body. */
const MAX_BODY_BYTES = 20 * 1024 * 1024

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
}

class TooLarge extends Error {}

const isLoopback = (address: string | undefined) =>
  address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new TooLarge()
    chunks.push(chunk)
  }
  return chunks.length ? Buffer.concat(chunks) : undefined
}

function sameKey(given: string | null, expected: string) {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createRequestListener(options: HttpOptions) {
  const root = normalize(options.webRoot)

  const isHttps = (req: IncomingMessage) =>
    Boolean((req.socket as { encrypted?: boolean }).encrypted) ||
    (options.trustProxy && String(req.headers['x-forwarded-proto'] ?? '').split(',')[0] === 'https')

  const originOf = (req: IncomingMessage) =>
    `${isHttps(req) ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`

  function send(
    res: ServerResponse,
    status: number,
    headers: Record<string, string | string[]>,
    body?: Buffer | string,
  ) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...headers })
    res.end(body)
  }

  async function serveApi(
    req: IncomingMessage,
    res: ServerResponse,
    answer: (request: Request) => Promise<Response>,
  ) {
    try {
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      }
      const method = req.method ?? 'GET'
      const hasBody = !['GET', 'HEAD'].includes(method)
      const response = await answer(
        new Request(originOf(req) + req.url, {
          method,
          headers,
          body: hasBody ? await readBody(req) : undefined,
        }),
      )
      const out: Record<string, string | string[]> = { 'Cache-Control': 'no-store' }
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') out[key] = value
      })
      const cookies = response.headers.getSetCookie()
      // Session cookies only travel over HTTPS when the site is served over HTTPS.
      if (cookies.length)
        out['set-cookie'] = isHttps(req) ? cookies.map((c) => `${c}; Secure`) : cookies
      send(res, response.status, out, Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      if (error instanceof TooLarge) {
        send(
          res,
          413,
          { 'Content-Type': 'application/json' },
          JSON.stringify({ detail: 'That upload is too large.', code: 'too_large' }),
        )
        return
      }
      console.error(error)
      send(
        res,
        500,
        { 'Content-Type': 'application/json' },
        JSON.stringify({
          detail:
            'Something went wrong in EMS. Try again, and contact support if it keeps happening.',
          code: 'server_error',
        }),
      )
    }
  }

  function outboxAllowed(url: URL, req: IncomingMessage) {
    const rule = options.outbox
    return (
      rule.access === 'open' ||
      (rule.access === 'local' && isLoopback(req.socket.remoteAddress)) ||
      (rule.access === 'key' && sameKey(url.searchParams.get('key'), rule.key))
    )
  }

  async function serveOutbox(url: URL, req: IncomingMessage, res: ServerResponse) {
    if (!outboxAllowed(url, req)) {
      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found')
      return
    }
    if (url.pathname === '/__sms') {
      send(
        res,
        200,
        { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        outboxPage,
      )
      return
    }
    const messages = await options.ems.listSms(30, new Request(originOf(req) + req.url))
    send(
      res,
      200,
      { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      JSON.stringify(messages),
    )
  }

  function serveFile(url: URL, res: ServerResponse) {
    let file = normalize(join(root, decodeURIComponent(url.pathname)))
    if (file !== root && !file.startsWith(root + sep)) {
      send(res, 403, {})
      return
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // Client-side routes (/customers/…, /field/today) get the app shell.
      if (extname(url.pathname)) {
        send(res, 404, {})
        return
      }
      file = join(root, 'index.html')
    }
    // Built assets have content hashes in their names, so they never change.
    const immutable = url.pathname.startsWith('/assets/')
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    createReadStream(file).pipe(res)
  }

  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    if (url.pathname.startsWith('/api/'))
      return void serveApi(req, res, (request) => options.ems.handle(request))
    const admin = options.ems.admin?.bind(options.ems)
    if (admin && url.pathname.startsWith('/__platform/')) return void serveApi(req, res, admin)
    if (url.pathname === '/__sms' || url.pathname === '/__sms.json')
      return void serveOutbox(url, req, res).catch((error) => {
        console.error(error)
        send(res, 500, {})
      })
    if (url.pathname === '/healthz') return send(res, 200, { 'Content-Type': 'text/plain' }, 'ok')
    serveFile(url, res)
  }
}
