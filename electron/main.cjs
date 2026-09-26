// EMS desktop app. Runs the EMS server (electron/build/server.cjs, built from
// src/server) with its data in SQLite, serves the web app next to it on
// 127.0.0.1, and shows both in app windows.
const { app, BrowserWindow, Menu, Notification, dialog, session, shell } = require('electron')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const WEB_ROOT = path.join(__dirname, '..', 'dist-desktop')
// A fixed port keeps the same origin between launches, so the field PIN and
// the officer's offline data kept in browser storage survive a restart.
const PREFERRED_PORT = 47821
const PAPER = '#F6F4EE'

const MIME = {
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

const dataDir = () => path.join(app.getPath('userData'), 'data')

let ems = null
let origin = ''
let mainWindow = null
let fieldWindow = null
let smsWindow = null

// ── Web server ──────────────────────────────────────────────────────────────

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return chunks.length ? Buffer.concat(chunks) : undefined
}

/** Hand an /api request to the EMS server and send back its answer. */
async function serveApi(req, res) {
  try {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
    }
    const hasBody = !['GET', 'HEAD'].includes(req.method ?? 'GET')
    const response = await ems.handle(
      new Request(origin + req.url, {
        method: req.method,
        headers,
        body: hasBody ? await readBody(req) : undefined,
      }),
    )
    const out = {}
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') out[key] = value
    })
    const cookies = response.headers.getSetCookie()
    if (cookies.length) out['set-cookie'] = cookies
    res.writeHead(response.status, out)
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.error(error)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        detail: 'Something went wrong in EMS. Try again, and restart EMS if it keeps happening.',
        code: 'server_error',
      }),
    )
  }
}

function serveFile(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const requested = path.normalize(path.join(WEB_ROOT, decodeURIComponent(url.pathname)))
  if (!requested.startsWith(WEB_ROOT)) {
    res.writeHead(403).end()
    return
  }
  let file = requested
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // Client-side routes (/customers/…, /field/today) get the app shell.
    if (path.extname(url.pathname)) {
      res.writeHead(404).end()
      return
    }
    file = path.join(WEB_ROOT, 'index.html')
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  })
  fs.createReadStream(file).pipe(res)
}

function serve(req, res) {
  const pathname = (req.url ?? '/').split('?')[0]
  if (pathname.startsWith('/api/')) return void serveApi(req, res)
  if (pathname === '/__sms') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    return void fs.createReadStream(path.join(__dirname, 'sms-outbox.html')).pipe(res)
  }
  if (pathname === '/__sms.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    return void res.end(JSON.stringify(ems.listSms(30)))
  }
  serveFile(req, res)
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(serve)
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function startWebServer() {
  try {
    return await listen(PREFERRED_PORT)
  } catch {
    // Something else holds the port. Run anyway; offline field data won't carry over.
    return listen(0)
  }
}

// ── Windows ─────────────────────────────────────────────────────────────────

function keepLinksInApp(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
}

function createWindow({ route, width, height, minWidth, minHeight, title }) {
  const win = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    title,
    backgroundColor: PAPER,
    show: false,
    icon: path.join(WEB_ROOT, 'pwa-192x192.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  keepLinksInApp(win)
  win.once('ready-to-show', () => win.show())
  void win.loadURL(origin + route)
  return win
}

function openBackOffice() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return
  }
  mainWindow = createWindow({
    route: '/',
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 640,
    title: 'EMS',
  })
  mainWindow.maximize()
}

/** The officer app at phone size, as it looks on an Android phone. */
function openFieldApp() {
  if (fieldWindow && !fieldWindow.isDestroyed()) {
    fieldWindow.focus()
    return
  }
  fieldWindow = createWindow({
    route: '/field/today',
    width: 412,
    height: 860,
    minWidth: 360,
    minHeight: 600,
    title: 'EMS Field',
  })
}

/** Text messages EMS has "sent". Stands in for an SMS provider while testing. */
function openSmsOutbox() {
  if (smsWindow && !smsWindow.isDestroyed()) {
    smsWindow.focus()
    return
  }
  smsWindow = new BrowserWindow({
    width: 440,
    height: 640,
    title: 'EMS SMS outbox',
    backgroundColor: PAPER,
    icon: path.join(WEB_ROOT, 'pwa-192x192.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  smsWindow.setMenuBarVisibility(false)
  void smsWindow.loadURL(`${origin}/__sms`)
}

// ── Menu actions ────────────────────────────────────────────────────────────

function onSms(sms) {
  if (Notification.isSupported()) {
    new Notification({ title: `SMS to ${sms.to}`, body: sms.message, silent: false }).show()
  }
}

async function backUp() {
  const stamp = new Date().toISOString().slice(0, 10)
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Back up EMS data',
    defaultPath: path.join(app.getPath('documents'), `EMS-backup-${stamp}.sqlite`),
    filters: [{ name: 'EMS backup', extensions: ['sqlite'] }],
  })
  if (canceled || !filePath) return
  try {
    fs.rmSync(filePath, { force: true })
    ems.backup(filePath)
    await dialog.showMessageBox({
      type: 'info',
      title: 'Backup saved',
      message: 'Your EMS data is backed up.',
      detail: `${filePath}\n\nKeep a copy somewhere other than this computer, such as a USB drive or cloud storage.`,
    })
  } catch (error) {
    dialog.showErrorBox('Backup failed', String(error?.message ?? error))
  }
}

async function showLicence() {
  const { licence, machineCode, businessName } = ems.status()
  const lines = licence
    ? [
        `Licence: ${licence.id ?? '—'}`,
        `Licensed to: ${licence.licensee ?? '—'}`,
        `Plan: ${licence.plan ?? '—'}`,
        `Branches: ${licence.branches ?? 'Unlimited'}`,
        `Valid until: ${licence.expires ?? 'No end date'}`,
        `Status: ${licence.status}`,
      ]
    : ['No licence entered yet.']
  await dialog.showMessageBox({
    type: 'info',
    title: 'EMS licence',
    message: businessName ?? 'EMS licence',
    detail: [...lines, '', `This computer’s code: ${machineCode}`].join('\n'),
  })
}

async function eraseInstallation() {
  const first = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Continue', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Erase EMS on this computer',
    message: 'Erase all EMS data and the licence on this computer?',
    detail:
      'Every customer, account, loan, transaction, staff member and setting is deleted, and EMS goes back to asking for a licence. Back up first if you might need the data.',
  })
  if (first.response !== 0) return
  const second = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Erase everything', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Erase EMS on this computer',
    message: 'This can’t be undone. Erase now?',
  })
  if (second.response !== 0) return
  ems.close()
  fs.rmSync(dataDir(), { recursive: true, force: true })
  await session.defaultSession.clearStorageData()
  app.relaunch()
  app.exit(0)
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Back office', accelerator: 'CmdOrCtrl+1', click: openBackOffice },
        { label: 'Field app (phone size)', accelerator: 'CmdOrCtrl+2', click: openFieldApp },
        { label: 'SMS outbox', accelerator: 'CmdOrCtrl+3', click: openSmsOutbox },
        { type: 'separator' },
        { label: 'Back up data…', click: () => void backUp() },
        { label: 'Open data folder', click: () => void shell.openPath(dataDir()) },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools', label: 'Developer tools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Licence details', click: () => void showLicence() },
        {
          label: 'About EMS',
          click: () =>
            dialog.showMessageBox({
              title: 'About EMS',
              message: `Entacrest MFB Solution (EMS) ${app.getVersion()}`,
              detail: `An Entacrest Nexus product.\n\nData: ${path.join(dataDir(), 'ems.sqlite')}`,
            }),
        },
        { type: 'separator' },
        { label: 'Erase EMS on this computer…', click: () => void eraseInstallation() },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── Start ───────────────────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  // A second copy would fight over the port and the database.
  app.quit()
} else {
  app.on('second-instance', openBackOffice)
  app.setAppUserModelId('ng.entacrest.ems')

  void app.whenReady().then(async () => {
    try {
      const { createEmsServer } = require('./build/server.cjs')
      ems = createEmsServer({ dataDir: dataDir(), onSms })
    } catch (error) {
      dialog.showErrorBox(
        'EMS couldn’t start',
        `EMS couldn’t open its data.\n\n${error?.stack ?? error}`,
      )
      app.exit(1)
      return
    }
    // Test builds before this one ran a mock service worker at the same address.
    await session.defaultSession.clearStorageData({ storages: ['serviceworkers'] })
    const port = await startWebServer()
    origin = `http://127.0.0.1:${port}`
    buildMenu()
    openBackOffice()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    try {
      ems?.close()
    } catch {
      // Already closed.
    }
  })
}
